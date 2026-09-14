import test from "node:test";
import assert from "node:assert/strict";
import { ProoflineAgent } from "../src/agent.js";
import { AmbiguousMutationError } from "../src/integrations/http.js";

class MemoryStore {
  constructor() { this.runs = new Map(); }
  async put(run) { this.runs.set(run.id, structuredClone(run)); return run; }
  async get(id) { const run = this.runs.get(id); return run ? structuredClone(run) : null; }
}

function harness({ mutateCase = false } = {}) {
  const store = new MemoryStore();
  let stripeCalls = 0;
  const caseRecord = {
    Id: "500000000000001",
    CaseNumber: "00001001",
    Status: "New",
    Description: "Refund request",
    LastModifiedDate: "2026-09-13T18:00:00.000Z",
  };
  const slack = {
    configured: () => true,
    requestApproval: async (run) => ({ channel: "C123", messageTs: "123.456", digest: run.envelope.digest }),
    checkApproval: async () => ({ approved: true, approverIds: ["U123"], count: 1 }),
    postResult: async () => ({ ok: true }),
  };
  const stripe = {
    configured: () => true,
    refund: async () => {
      stripeCalls += 1;
      throw new AmbiguousMutationError("Stripe", "lost response", { deliberatelyInjected: true });
    },
    reconcileRefund: async () => ({ id: "re_proven", status: "succeeded", amount: 4200 }),
    retrieveRefund: async () => ({ id: "re_proven", status: "succeeded", amount: 4200, payment_intent: "pi_demo" }),
  };
  const salesforce = {
    configured: () => true,
    getCase: async () => ({ ...caseRecord, LastModifiedDate: mutateCase ? "2026-09-13T18:01:00.000Z" : caseRecord.LastModifiedDate }),
    recordRefund: async (id, receipt) => ({ ...caseRecord, Id: id, Status: "Closed", Description: `receipt ${receipt.refundId}` }),
  };
  return { agent: new ProoflineAgent({ store, slack, stripe, salesforce }), store, stripeCalls: () => stripeCalls };
}

test("ambiguous Stripe mutation reconciles without a duplicate retry", async () => {
  const { agent, stripeCalls } = harness();
  const prepared = await agent.prepare({
    caseIdOrNumber: "00001001",
    paymentIntentId: "pi_demo",
    amount: 4200,
    currency: "usd",
    reason: "duplicate",
    injectStripeTimeout: true,
  });
  const completed = await agent.checkAndExecute(prepared.id);
  assert.equal(completed.state, "VERIFIED");
  assert.equal(completed.verdict.status, "PROVEN");
  assert.equal(stripeCalls(), 1);
  assert.ok(completed.events.some((item) => item.kind === "UNKNOWN"));
  assert.ok(completed.events.some((item) => item.kind === "RECONCILING"));
});

test("Salesforce revision drift blocks the approved action before Stripe", async () => {
  const { agent, stripeCalls } = harness();
  const prepared = await agent.prepare({ caseIdOrNumber: "00001001", paymentIntentId: "pi_demo", amount: 4200, currency: "usd", reason: "duplicate" });
  agent.salesforce.getCase = async () => ({
    Id: "500000000000001", CaseNumber: "00001001", Status: "Escalated", Description: "changed", LastModifiedDate: "2026-09-13T18:02:00.000Z",
  });
  const completed = await agent.checkAndExecute(prepared.id);
  assert.equal(completed.state, "BLOCKED");
  assert.equal(stripeCalls(), 0);
});

