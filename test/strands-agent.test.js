import test from "node:test";
import assert from "node:assert/strict";
import { StrandsProoflineAgent, createOperations } from "../src/strands-agent.js";

test("Strands planner returns a structured proposal without authorizing execution", async () => {
  const created = [];
  const proposal = {
    caseIdOrNumber: "00001001",
    paymentIntentId: "pi_demo",
    amount: 4200,
    currency: "usd",
    reason: "duplicate charge",
    riskSummary: "A financial mutation requires human approval.",
    missingFields: [],
  };
  const agentFactory = (options) => {
    created.push(options);
    return options.structuredOutputSchema
      ? { invoke: async () => ({ structuredOutput: proposal }) }
      : { invoke: async () => ({ lastMessage: { content: [{ text: "ready" }] }, stopReason: "end_turn" }) };
  };
  const kernel = { verifyIntegrations() {}, seedDemo() {}, prepare() {}, checkAndExecute() {} };
  const strands = new StrandsProoflineAgent({ kernel, store: { get() {} }, agentFactory });

  const result = await strands.plan("Refund $42 for case 00001001 on pi_demo because it was charged twice");

  assert.equal(result.source, "aws-strands");
  assert.equal(result.amount, 4200);
  assert.equal(created.length, 2);
  assert.ok(created[0].structuredOutputSchema);
  assert.equal(created[1].toolExecutor, "sequential");
  assert.deepEqual(strands.readiness().tools, [
    "verify_connections",
    "seed_official_test_records",
    "request_refund_approval",
    "check_approval_and_execute",
    "get_proof_evidence",
  ]);
});

test("Strands operations expose execution only through the guarded kernel", async () => {
  let prepared = 0;
  let checked = 0;
  const run = { id: "run_demo", state: "WAITING_APPROVAL", envelope: { digest: "abc" }, approval: null, evidence: {}, verdict: null };
  const kernel = {
    async prepare() { prepared += 1; return run; },
    async checkAndExecute() { checked += 1; return { ...run, state: "VERIFIED", verdict: { status: "PROVEN" } }; },
  };
  const operations = createOperations({ kernel, store: { async get() { return run; } } });

  const requested = await operations.requestRefundApproval({ amount: 4200 });
  assert.equal(requested.state, "WAITING_APPROVAL");
  assert.equal(prepared, 1);
  assert.equal(checked, 0);

  const completed = await operations.checkApprovalAndExecute({ runId: "run_demo" });
  assert.equal(completed.verdict.status, "PROVEN");
  assert.equal(checked, 1);
});
