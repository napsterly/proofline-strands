import { AmbiguousMutationError, fetchJson, IntegrationError } from "./http.js";

const API = "https://api.stripe.com/v1";

export class StripeAdapter {
  constructor({ secretKey }) {
    this.secretKey = secretKey;
  }

  configured() {
    return Boolean(this.secretKey?.startsWith("sk_test_"));
  }

  async verifyMode() {
    this.requireConfig();
    const { body } = await this.request("GET", "/balance");
    return { livemode: body.livemode, available: body.available || [] };
  }

  async createTestPayment({ amount = 4200, currency = "usd" } = {}) {
    this.requireConfig();
    const params = new URLSearchParams();
    params.set("amount", String(amount));
    params.set("currency", currency);
    params.set("payment_method", "pm_card_visa");
    params.set("confirm", "true");
    params.append("payment_method_types[]", "card");
    params.set("description", "Proofline hackathon test payment");
    params.set("metadata[proofline_seed]", "true");
    const { body } = await this.request("POST", "/payment_intents", params);
    return body;
  }

  async refund({ runId, paymentIntentId, amount, idempotencyKey, injectTimeout = false }) {
    this.requireConfig();
    const params = new URLSearchParams();
    params.set("payment_intent", paymentIntentId);
    params.set("amount", String(amount));
    params.set("metadata[proofline_run_id]", runId);
    params.set("metadata[proofline_action_digest]", idempotencyKey.split(":").at(-1));
    const { body } = await this.request("POST", "/refunds", params, { "Idempotency-Key": idempotencyKey });

    if (injectTimeout) {
      throw new AmbiguousMutationError("Stripe", "Connection dropped after Stripe committed the refund", {
        paymentIntentId,
        deliberatelyInjected: true,
      });
    }
    return body;
  }

  async reconcileRefund({ runId, paymentIntentId }) {
    this.requireConfig();
    const params = new URLSearchParams({ payment_intent: paymentIntentId, limit: "100" });
    const { body } = await this.request("GET", `/refunds?${params}`);
    return body.data.find((refund) => refund.metadata?.proofline_run_id === runId) || null;
  }

  async retrieveRefund(refundId) {
    this.requireConfig();
    const { body } = await this.request("GET", `/refunds/${encodeURIComponent(refundId)}`);
    return body;
  }

  async request(method, endpoint, params, extraHeaders = {}) {
    const headers = {
      Authorization: `Bearer ${this.secretKey}`,
      "Stripe-Version": "2024-06-20",
      ...extraHeaders,
    };
    const options = { method, headers };
    if (params) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.body = params.toString();
    }
    return fetchJson(`${API}${endpoint}`, options, "Stripe");
  }

  requireConfig() {
    if (!this.configured()) {
      throw new IntegrationError("Stripe", "A Test Mode STRIPE_SECRET_KEY beginning with sk_test_ is required");
    }
  }
}

