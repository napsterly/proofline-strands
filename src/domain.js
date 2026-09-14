import { createHash, randomUUID } from "node:crypto";

export const RUN_STATES = Object.freeze({
  PREPARING: "PREPARING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  APPROVED: "APPROVED",
  EXECUTING: "EXECUTING",
  UNKNOWN: "UNKNOWN",
  RECONCILING: "RECONCILING",
  VERIFYING: "VERIFYING",
  VERIFIED: "VERIFIED",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
});

const ALLOWED_TRANSITIONS = Object.freeze({
  PREPARING: ["WAITING_APPROVAL", "BLOCKED", "FAILED"],
  WAITING_APPROVAL: ["APPROVED", "BLOCKED", "FAILED"],
  APPROVED: ["EXECUTING", "BLOCKED", "FAILED"],
  EXECUTING: ["UNKNOWN", "VERIFYING", "FAILED"],
  UNKNOWN: ["RECONCILING", "FAILED"],
  RECONCILING: ["VERIFYING", "BLOCKED", "FAILED"],
  VERIFYING: ["VERIFIED", "BLOCKED", "FAILED"],
  VERIFIED: [],
  BLOCKED: [],
  FAILED: [],
});

export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function shortDigest(value) {
  return digest(value).slice(0, 12);
}

export function makeActionEnvelope({ caseRecord, paymentIntentId, amount, currency, reason }) {
  const envelope = {
    action: "stripe.refund",
    amount: Number(amount),
    currency: String(currency || "usd").toLowerCase(),
    paymentIntentId,
    reason,
    salesforce: {
      caseId: caseRecord.Id,
      caseNumber: caseRecord.CaseNumber,
      status: caseRecord.Status,
      lastModifiedDate: caseRecord.LastModifiedDate,
    },
  };
  return { ...envelope, digest: digest(envelope) };
}

export function createRun(input) {
  const now = new Date().toISOString();
  return {
    id: `run_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    state: RUN_STATES.PREPARING,
    createdAt: now,
    updatedAt: now,
    input,
    envelope: null,
    approval: null,
    execution: null,
    evidence: {},
    verdict: null,
    events: [event("PREPARING", "Run created; gathering authoritative state")],
  };
}

export function transition(run, nextState, detail, data = {}) {
  const allowed = ALLOWED_TRANSITIONS[run.state] || [];
  if (!allowed.includes(nextState)) {
    throw new Error(`Illegal transition ${run.state} -> ${nextState}`);
  }
  run.state = nextState;
  run.updatedAt = new Date().toISOString();
  run.events.push(event(nextState, detail, data));
  return run;
}

export function addEvent(run, kind, detail, data = {}) {
  run.updatedAt = new Date().toISOString();
  run.events.push(event(kind, detail, data));
  return run;
}

export function deriveVerdict(run) {
  const approvalBound = Boolean(
    run.approval?.approved &&
      run.approval?.digest === run.envelope?.digest &&
      run.evidence?.slack?.messageTs,
  );
  const stripeVerified = Boolean(
    run.evidence?.stripe?.refundId &&
      run.evidence?.stripe?.status === "succeeded" &&
      run.evidence?.stripe?.amount === run.envelope?.amount,
  );
  const salesforceVerified = Boolean(
    run.evidence?.salesforce?.caseId === run.envelope?.salesforce?.caseId &&
      run.evidence?.salesforce?.containsRefundId,
  );

  const checks = { approvalBound, stripeVerified, salesforceVerified };
  return {
    status: Object.values(checks).every(Boolean) ? "PROVEN" : "UNPROVEN",
    checks,
    evidenceDigest: digest({
      actionDigest: run.envelope?.digest,
      slack: run.evidence?.slack,
      stripe: run.evidence?.stripe,
      salesforce: run.evidence?.salesforce,
    }),
  };
}

export function idempotencyKey(run) {
  return `proofline:${run.id}:${run.envelope.digest.slice(0, 24)}`;
}

function event(kind, detail, data = {}) {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    detail,
    data,
  };
}

