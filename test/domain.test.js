import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, createRun, deriveVerdict, digest, makeActionEnvelope, transition } from "../src/domain.js";

test("canonical digest is independent of object key order", () => {
  assert.equal(canonicalize({ b: 2, a: { d: 4, c: 3 } }), canonicalize({ a: { c: 3, d: 4 }, b: 2 }));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});

test("action digest changes when a consequential field changes", () => {
  const caseRecord = { Id: "500000000000001", CaseNumber: "00001001", Status: "New", LastModifiedDate: "2026-09-13T18:00:00Z" };
  const base = { caseRecord, paymentIntentId: "pi_test", amount: 4200, currency: "usd", reason: "duplicate" };
  assert.notEqual(makeActionEnvelope(base).digest, makeActionEnvelope({ ...base, amount: 4300 }).digest);
});

test("illegal state transitions fail closed", () => {
  const run = createRun({});
  assert.throws(() => transition(run, "VERIFIED", "skip everything"), /Illegal transition/);
});

test("verdict requires all three independent receipts", () => {
  const run = createRun({});
  run.envelope = { digest: "abc", amount: 4200, salesforce: { caseId: "500x" } };
  run.approval = { approved: true, digest: "abc" };
  run.evidence = {
    slack: { messageTs: "123.456" },
    stripe: { refundId: "re_123", status: "succeeded", amount: 4200 },
    salesforce: { caseId: "500x", containsRefundId: true },
  };
  assert.equal(deriveVerdict(run).status, "PROVEN");
  run.evidence.salesforce.containsRefundId = false;
  assert.equal(deriveVerdict(run).status, "UNPROVEN");
});

