import { createHash, randomBytes } from "node:crypto";
import { fetchJson, IntegrationError } from "./integrations/http.js";

export class SalesforceOAuth {
  constructor({ clientId, redirectUri, loginUrl = "https://login.salesforce.com" }) {
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.loginUrl = loginUrl.replace(/\/$/, "");
    this.pending = new Map();
  }

  configured() {
    return Boolean(this.clientId && this.redirectUri);
  }

  begin() {
    if (!this.configured()) throw new IntegrationError("Salesforce OAuth", "SALESFORCE_CLIENT_ID is required");
    this.prune();
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    this.pending.set(state, { verifier, createdAt: Date.now() });
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: "api refresh_token",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `${this.loginUrl}/services/oauth2/authorize?${query}`;
  }

  async complete({ code, state }) {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || Date.now() - pending.createdAt > 10 * 60_000) {
      throw new IntegrationError("Salesforce OAuth", "Invalid or expired OAuth state");
    }
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier,
    });
    const { body } = await fetchJson(`${this.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }, "Salesforce OAuth");
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      instanceUrl: body.instance_url,
      id: body.id,
      issuedAt: body.issued_at,
    };
  }

  prune() {
    for (const [state, entry] of this.pending) {
      if (Date.now() - entry.createdAt > 10 * 60_000) this.pending.delete(state);
    }
  }
}

