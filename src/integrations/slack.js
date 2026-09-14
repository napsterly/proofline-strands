import { fetchJson, IntegrationError } from "./http.js";

const API = "https://slack.com/api";

export class SlackAdapter {
  constructor({ token, channel, publicBaseUrl }) {
    this.token = token;
    this.channel = channel;
    this.publicBaseUrl = publicBaseUrl;
  }

  configured() {
    return Boolean(this.token && this.channel);
  }

  async authTest() {
    const { body } = await this.call("auth.test", {});
    return { team: body.team, user: body.user, userId: body.user_id, teamId: body.team_id };
  }

  async requestApproval(run) {
    this.requireConfig();
    const amount = money(run.envelope.amount, run.envelope.currency);
    const dashboardUrl = `${this.publicBaseUrl}/?run=${encodeURIComponent(run.id)}`;
    const text = `Approval required: refund ${amount} for Salesforce case ${run.envelope.salesforce.caseNumber}. Digest ${run.envelope.digest}. React with :white_check_mark: to approve.`;
    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: "Proofline · Approval required" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Action*\nStripe refund` },
          { type: "mrkdwn", text: `*Amount*\n${amount}` },
          { type: "mrkdwn", text: `*Salesforce case*\n${run.envelope.salesforce.caseNumber}` },
          { type: "mrkdwn", text: `*Reason*\n${run.envelope.reason}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `React with :white_check_mark: to approve this exact action.\n\`${run.envelope.digest}\`` },
      },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open evidence console" }, url: dashboardUrl }],
      },
    ];
    const { body } = await this.call("chat.postMessage", {
      channel: this.channel,
      text,
      blocks,
      metadata: {
        event_type: "proofline_approval",
        event_payload: { runId: run.id, digest: run.envelope.digest },
      },
    });
    return { channel: body.channel, messageTs: body.ts, digest: run.envelope.digest };
  }

  async checkApproval({ channel, messageTs }) {
    this.requireConfig();
    const params = new URLSearchParams({ channel, timestamp: messageTs, full: "true" });
    const { body } = await fetchJson(`${API}/reactions.get?${params}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    }, "Slack");
    if (!body.ok) throw new IntegrationError("Slack", body.error || "reactions.get failed", body);
    const reaction = (body.message?.reactions || []).find((item) => item.name === "white_check_mark");
    return {
      approved: Boolean(reaction?.count),
      approverIds: reaction?.users || [],
      count: reaction?.count || 0,
    };
  }

  async postResult(run) {
    this.requireConfig();
    const proven = run.verdict?.status === "PROVEN";
    return this.call("chat.postMessage", {
      channel: this.channel,
      text: `${proven ? "PROVEN" : "BLOCKED"}: refund run ${run.id}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${proven ? "✓" : "!"} Proofline · ${run.verdict?.status || run.state}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: proven
              ? `Refund *${run.evidence.stripe.refundId}* was independently read back and Salesforce case *${run.envelope.salesforce.caseNumber}* now contains the receipt.`
              : `The workflow stopped because the evidence bundle was incomplete. No success was claimed.`,
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Evidence digest: \`${run.verdict?.evidenceDigest || "unavailable"}\`` }],
        },
      ],
    });
  }

  async call(method, payload) {
    const { body } = await fetchJson(`${API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    }, "Slack");
    if (!body.ok) throw new IntegrationError("Slack", body.error || `${method} failed`, body);
    return { body };
  }

  requireConfig() {
    if (!this.configured()) throw new IntegrationError("Slack", "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are required");
  }
}

function money(amount, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

