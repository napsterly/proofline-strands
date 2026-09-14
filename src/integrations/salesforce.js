import { fetchJson, IntegrationError } from "./http.js";

export class SalesforceAdapter {
  constructor({ instanceUrl, accessToken, apiVersion = "v61.0" }) {
    this.instanceUrl = instanceUrl?.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
  }

  configured() {
    return Boolean(this.instanceUrl && this.accessToken);
  }

  async verifyIdentity() {
    this.requireConfig();
    const { body } = await fetchJson(`${this.instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    }, "Salesforce");
    return { userId: body.user_id, organizationId: body.organization_id, preferredUsername: body.preferred_username };
  }

  async createDemoCase({ subject = "Refund request — Proofline demo", description = "Created in Salesforce Developer Edition for the Proofline live demo." } = {}) {
    this.requireConfig();
    const { body } = await this.request("POST", "/sobjects/Case", {
      Subject: subject,
      Description: description,
      Status: "New",
      Origin: "Web",
    });
    return this.getCase(body.id);
  }

  async getCase(caseIdOrNumber) {
    this.requireConfig();
    const escaped = String(caseIdOrNumber).replaceAll("'", "\\'");
    const where = /^[a-zA-Z0-9]{15,18}$/.test(escaped) ? `Id='${escaped}'` : `CaseNumber='${escaped}'`;
    const query = `SELECT Id, CaseNumber, Subject, Status, Description, LastModifiedDate FROM Case WHERE ${where} LIMIT 1`;
    const { body } = await this.request("GET", `/query?q=${encodeURIComponent(query)}`);
    if (!body.records?.length) throw new IntegrationError("Salesforce", `Case ${caseIdOrNumber} was not found`);
    return body.records[0];
  }

  async recordRefund(caseId, { runId, refundId, evidenceDigest }) {
    this.requireConfig();
    const current = await this.getCase(caseId);
    const receipt = `\n\n[Proofline verified]\nrun=${runId}\nstripe_refund=${refundId}\nevidence_digest=${evidenceDigest}`;
    await this.request("PATCH", `/sobjects/Case/${encodeURIComponent(caseId)}`, {
      Status: "Closed",
      Description: `${current.Description || ""}${receipt}`.trim(),
    });
    return this.getCase(caseId);
  }

  async request(method, endpoint, payload) {
    const headers = { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" };
    const options = { method, headers };
    if (payload && method !== "GET") options.body = JSON.stringify(payload);
    return fetchJson(`${this.instanceUrl}/services/data/${this.apiVersion}${endpoint}`, options, "Salesforce");
  }

  requireConfig() {
    if (!this.configured()) throw new IntegrationError("Salesforce", "SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN are required");
  }
}

