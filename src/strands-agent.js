import { Agent, tool } from "@strands-agents/sdk";
import { z } from "zod";

const RefundIntent = z.object({
  caseIdOrNumber: z.string().nullable().describe("Salesforce Case ID or Case Number, or null when absent"),
  paymentIntentId: z.string().nullable().describe("Stripe PaymentIntent beginning pi_, or null when absent"),
  amount: z.number().int().positive().nullable().describe("Refund amount in minor currency units such as cents, or null"),
  currency: z.literal("usd"),
  reason: z.string().nullable().describe("Customer-visible reason, or null when absent"),
  riskSummary: z.string().describe("One concise sentence explaining the consequential risk"),
  missingFields: z.array(z.enum(["caseIdOrNumber", "paymentIntentId", "amount", "reason"])),
});

const SYSTEM_PROMPT = `You are Proofline, an accountability agent for consequential business operations.

Your job is to coordinate work, never to fabricate completion. Use the supplied tools to inspect authoritative systems, request a cryptographically bound human approval, and prove outcomes with independent readbacks.

Non-negotiable policy:
- Never claim a refund succeeded unless get_proof_evidence returns VERIFIED and PROVEN.
- Never invent a case ID, PaymentIntent, amount, reason, approval, or system result.
- request_refund_approval may prepare an action but cannot authorize it.
- A refund can execute only through check_approval_and_execute; that tool independently verifies Slack approval and Salesforce freshness.
- Treat UNKNOWN as a legitimate state and explain that reconciliation is in progress.
- Keep responses concise and name the evidence supporting every completion claim.`;

export class StrandsProoflineAgent {
  constructor({ kernel, store, modelId, agentFactory = (options) => new Agent(options) }) {
    this.kernel = kernel;
    this.store = store;
    this.modelId = modelId || null;
    this.operations = createOperations({ kernel, store });
    this.tools = createTools(this.operations);

    const modelOption = this.modelId ? { model: this.modelId } : {};
    this.planner = agentFactory({
      ...modelOption,
      systemPrompt: "Extract a proposed refund action. Never invent missing values. You propose only; a deterministic safety kernel controls authorization and execution.",
      structuredOutputSchema: RefundIntent,
      printer: false,
    });
    this.operator = agentFactory({
      ...modelOption,
      systemPrompt: SYSTEM_PROMPT,
      tools: this.tools,
      toolExecutor: "sequential",
      printer: false,
    });
  }

  readiness() {
    return {
      framework: "AWS Strands Agents",
      sdk: "@strands-agents/sdk",
      model: this.modelId || "Strands default Bedrock model",
      tools: this.tools.map((item) => item.name),
    };
  }

  async plan(text) {
    if (!text || text.trim().length < 8) throw new Error("Describe the refund in one sentence");
    const result = await this.planner.invoke(text);
    if (!result.structuredOutput) throw new Error("Strands returned no structured refund proposal");
    return {
      ...result.structuredOutput,
      source: "aws-strands",
      model: this.modelId || "default-bedrock",
    };
  }

  async invoke(prompt) {
    if (!prompt || prompt.trim().length < 2) throw new Error("prompt is required");
    const result = await this.operator.invoke(prompt);
    return {
      message: extractMessageText(result.lastMessage),
      stopReason: result.stopReason,
      framework: "AWS Strands Agents",
    };
  }
}

export function createOperations({ kernel, store }) {
  return {
    async verifyConnections() {
      return kernel.verifyIntegrations();
    },
    async seedTestRecords(input) {
      return kernel.seedDemo(input);
    },
    async requestRefundApproval(input) {
      return summarizeRun(await kernel.prepare(input));
    },
    async checkApprovalAndExecute({ runId }) {
      return summarizeRun(await kernel.checkAndExecute(runId));
    },
    async getProofEvidence({ runId }) {
      const run = await store.get(runId);
      if (!run) throw new Error(`Run ${runId} not found`);
      return summarizeRun(run, true);
    },
  };
}

export function createTools(operations) {
  const verifyConnections = tool({
    name: "verify_connections",
    description: "Read-only verification of the official Slack, Stripe Test Mode, and Salesforce connections.",
    inputSchema: z.object({}),
    callback: () => operations.verifyConnections(),
  });

  const seedTestRecords = tool({
    name: "seed_official_test_records",
    description: "Create a Stripe Test Mode PaymentIntent and Salesforce Developer Edition Case for a safe demonstration.",
    inputSchema: z.object({
      amount: z.number().int().positive().describe("Amount in minor currency units, such as cents"),
      currency: z.literal("usd").default("usd"),
    }),
    callback: (input) => operations.seedTestRecords(input),
  });

  const requestRefundApproval = tool({
    name: "request_refund_approval",
    description: "Prepare an exact Stripe Test Mode refund, bind it to current Salesforce state, and request human approval in Slack. This tool cannot execute the refund.",
    inputSchema: z.object({
      caseIdOrNumber: z.string().min(1),
      paymentIntentId: z.string().startsWith("pi_"),
      amount: z.number().int().positive().describe("Amount in minor currency units, such as cents"),
      currency: z.literal("usd").default("usd"),
      reason: z.string().min(3),
      injectStripeTimeout: z.boolean().default(false),
    }),
    callback: (input) => operations.requestRefundApproval(input),
  });

  const checkApprovalAndExecute = tool({
    name: "check_approval_and_execute",
    description: "Check Slack for approval bound to a run digest. Only the deterministic kernel can execute, and only after it also proves the Salesforce record is unchanged.",
    inputSchema: z.object({ runId: z.string().startsWith("run_") }),
    callback: (input) => operations.checkApprovalAndExecute(input),
  });

  const getProofEvidence = tool({
    name: "get_proof_evidence",
    description: "Read the current state, audit events, and independent Slack, Stripe, and Salesforce evidence for a Proofline run.",
    inputSchema: z.object({ runId: z.string().startsWith("run_") }),
    callback: (input) => operations.getProofEvidence(input),
  });

  return [verifyConnections, seedTestRecords, requestRefundApproval, checkApprovalAndExecute, getProofEvidence];
}

function summarizeRun(run, includeEvents = false) {
  return {
    runId: run.id,
    state: run.state,
    actionDigest: run.envelope?.digest || null,
    approval: run.approval ? {
      approved: Boolean(run.approval.approved),
      approverCount: run.approval.approverIds?.length || 0,
    } : null,
    evidence: {
      slack: Boolean(run.evidence?.slack?.messageTs),
      stripe: run.evidence?.stripe || null,
      salesforce: run.evidence?.salesforce || null,
    },
    verdict: run.verdict || null,
    ...(includeEvents ? { events: run.events } : {}),
  };
}

function extractMessageText(message) {
  if (typeof message === "string") return message;
  const content = message?.content;
  if (!Array.isArray(content)) return JSON.stringify(message ?? "");
  return content.map((item) => item?.text || "").filter(Boolean).join("\n");
}
