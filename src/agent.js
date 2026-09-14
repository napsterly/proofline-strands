import {
  RUN_STATES,
  addEvent,
  createRun,
  deriveVerdict,
  idempotencyKey,
  makeActionEnvelope,
  transition,
} from "./domain.js";
import { AmbiguousMutationError } from "./integrations/http.js";

export class ProoflineAgent {
  constructor({ store, slack, stripe, salesforce }) {
    this.store = store;
    this.slack = slack;
    this.stripe = stripe;
    this.salesforce = salesforce;
  }

  readiness() {
    return {
      slack: this.slack.configured(),
      stripe: this.stripe.configured(),
      salesforce: this.salesforce.configured(),
    };
  }

  async verifyIntegrations() {
    const checks = await Promise.allSettled([
      this.slack.authTest(),
      this.stripe.verifyMode(),
      this.salesforce.verifyIdentity(),
    ]);
    return Object.fromEntries(["slack", "stripe", "salesforce"].map((name, index) => {
      const result = checks[index];
      return [name, result.status === "fulfilled"
        ? { ok: true, detail: result.value }
        : { ok: false, error: publicError(result.reason) }];
    }));
  }

  async seedDemo({ amount, currency }) {
    const [payment, caseRecord] = await Promise.all([
      this.stripe.createTestPayment({ amount, currency }),
      this.salesforce.createDemoCase(),
    ]);
    return { paymentIntentId: payment.id, caseId: caseRecord.Id, caseNumber: caseRecord.CaseNumber, amount: payment.amount, currency: payment.currency };
  }

  async prepare(input) {
    const run = createRun(input);
    await this.store.put(run);
    try {
      const caseRecord = await this.salesforce.getCase(input.caseIdOrNumber);
      run.envelope = makeActionEnvelope({
        caseRecord,
        paymentIntentId: input.paymentIntentId,
        amount: Number(input.amount),
        currency: input.currency,
        reason: input.reason,
      });
      addEvent(run, "DIGEST_BOUND", "Action parameters bound to an immutable SHA-256 digest", {
        digest: run.envelope.digest,
      });
      const approvalRequest = await this.slack.requestApproval(run);
      run.approval = { ...approvalRequest, approved: false, approverIds: [] };
      run.evidence.slack = approvalRequest;
      transition(run, RUN_STATES.WAITING_APPROVAL, "Slack approval requested; waiting for a human reaction");
    } catch (error) {
      transition(run, RUN_STATES.FAILED, publicError(error));
    }
    return this.store.put(run);
  }

  async checkAndExecute(runId) {
    const run = await this.mustGet(runId);
    if (run.state !== RUN_STATES.WAITING_APPROVAL) return run;
    try {
      const result = await this.slack.checkApproval(run.approval);
      if (!result.approved) {
        addEvent(run, "APPROVAL_CHECK", "No Slack approval yet; no side effect performed");
        return this.store.put(run);
      }
      run.approval = { ...run.approval, ...result, approved: true, approvedAt: new Date().toISOString() };
      transition(run, RUN_STATES.APPROVED, "Slack approval found and matched to the action digest", {
        approverIds: result.approverIds,
      });
      return this.execute(run);
    } catch (error) {
      transition(run, RUN_STATES.FAILED, publicError(error));
      return this.store.put(run);
    }
  }

  async execute(run) {
    try {
      const freshCase = await this.salesforce.getCase(run.envelope.salesforce.caseId);
      if (freshCase.LastModifiedDate !== run.envelope.salesforce.lastModifiedDate) {
        transition(run, RUN_STATES.BLOCKED, "Salesforce changed after approval; refusing stale authorization", {
          approvedVersion: run.envelope.salesforce.lastModifiedDate,
          currentVersion: freshCase.LastModifiedDate,
        });
        return this.store.put(run);
      }

      transition(run, RUN_STATES.EXECUTING, "Executing Stripe refund with a deterministic idempotency key");
      const key = idempotencyKey(run);
      run.execution = { idempotencyKey: key, attempt: 1 };
      await this.store.put(run);
      try {
        const refund = await this.stripe.refund({
          runId: run.id,
          paymentIntentId: run.envelope.paymentIntentId,
          amount: run.envelope.amount,
          idempotencyKey: key,
          injectTimeout: Boolean(run.input.injectStripeTimeout),
        });
        run.execution.refundId = refund.id;
        transition(run, RUN_STATES.VERIFYING, "Stripe acknowledged the mutation; starting independent readback");
      } catch (error) {
        if (!(error instanceof AmbiguousMutationError)) throw error;
        transition(run, RUN_STATES.UNKNOWN, "Stripe outcome is ambiguous; success is intentionally withheld", error.details);
        await this.store.put(run);
        transition(run, RUN_STATES.RECONCILING, "Querying Stripe authoritative state instead of retrying blindly");
        const recovered = await this.stripe.reconcileRefund({ runId: run.id, paymentIntentId: run.envelope.paymentIntentId });
        if (!recovered) {
          transition(run, RUN_STATES.BLOCKED, "No matching Stripe refund could be proven during reconciliation");
          return this.store.put(run);
        }
        run.execution.refundId = recovered.id;
        run.execution.recovered = true;
        transition(run, RUN_STATES.VERIFYING, "Reconciliation found the committed refund; starting readback", {
          refundId: recovered.id,
        });
      }

      return this.verify(run);
    } catch (error) {
      if (![RUN_STATES.BLOCKED, RUN_STATES.FAILED].includes(run.state)) {
        transition(run, RUN_STATES.FAILED, publicError(error));
      }
      return this.store.put(run);
    }
  }

  async verify(run) {
    try {
      const stripeReadback = await this.stripe.retrieveRefund(run.execution.refundId);
      run.evidence.stripe = {
        refundId: stripeReadback.id,
        status: stripeReadback.status,
        amount: stripeReadback.amount,
        paymentIntentId: stripeReadback.payment_intent,
      };
      addEvent(run, "STRIPE_READBACK", "Refund independently read from Stripe", run.evidence.stripe);

      const preliminary = deriveVerdict(run);
      const salesforceReadback = await this.salesforce.recordRefund(run.envelope.salesforce.caseId, {
        runId: run.id,
        refundId: stripeReadback.id,
        evidenceDigest: preliminary.evidenceDigest,
      });
      run.evidence.salesforce = {
        caseId: salesforceReadback.Id,
        caseNumber: salesforceReadback.CaseNumber,
        status: salesforceReadback.Status,
        lastModifiedDate: salesforceReadback.LastModifiedDate,
        containsRefundId: Boolean(salesforceReadback.Description?.includes(stripeReadback.id)),
      };
      addEvent(run, "SALESFORCE_READBACK", "Case updated and independently read back from Salesforce", run.evidence.salesforce);

      run.verdict = deriveVerdict(run);
      transition(
        run,
        run.verdict.status === "PROVEN" ? RUN_STATES.VERIFIED : RUN_STATES.BLOCKED,
        run.verdict.status === "PROVEN"
          ? "Three-system evidence bundle complete; outcome proven"
          : "Evidence bundle incomplete; no success claim issued",
        run.verdict.checks,
      );
      await this.store.put(run);
      await this.slack.postResult(run);
      return this.store.put(run);
    } catch (error) {
      transition(run, RUN_STATES.FAILED, publicError(error));
      return this.store.put(run);
    }
  }

  async mustGet(runId) {
    const run = await this.store.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    return run;
  }
}

export function publicError(error) {
  return error?.details?.body?.error?.message || error?.message || "Unexpected error";
}

