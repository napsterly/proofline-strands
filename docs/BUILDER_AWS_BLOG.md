# Agents for Humans: Building Proofline Strands, an AI Agent That Refuses to Guess

Most AI-agent demos end when a tool call returns successfully. In real professional operations, that is often where the dangerous questions begin.

What happens if a payment API commits a refund but the network response disappears? Did the refund fail, or did only the response fail? Retrying may duplicate a financial action. Claiming success may mislead the customer and leave internal systems inconsistent.

I built **Proofline Strands** for the Agents for Humans hackathon to explore a stricter standard: an agent should not say “done” until independent evidence proves the requested outcome.

Proofline coordinates a consequential customer-refund workflow across Salesforce, Slack, and Stripe Test Mode. AWS Strands Agents handles structured intent and tool coordination, while a deterministic safety kernel controls authorization, execution, and proof. The same application is deployed to Amazon Bedrock AgentCore Runtime.

> **AI can propose. Proofline makes it prove.**

## The problem: completion is a claim

Support and operations teams spend hours carrying one decision across disconnected systems. A case begins in a CRM, approval happens in chat, and the financial action happens in a payment processor.

Automating those clicks is useful, but it also creates new failure modes:

- the underlying business record can change while approval is pending;
- a human can accidentally approve an action different from the one eventually executed;
- a remote API can commit a write and lose its response;
- an agent can report success before downstream systems agree.

Proofline treats completion as a claim that must be supported by evidence, not as a feeling produced by a confident model response.

## Architecture

![Proofline Strands architecture](https://raw.githubusercontent.com/napsterly/proofline-strands/main/docs/architecture.png)

The architecture deliberately separates two responsibilities.

**AWS Strands Agents** interprets the request, creates a structured proposal, and selects from five narrow tools:

1. verify the connected systems;
2. create safe records in official test environments;
3. request approval for an exact action;
4. check approval and execute through the guarded kernel;
5. inspect the accumulated evidence.

The model never receives a direct Stripe mutation tool.

The **deterministic safety kernel** owns the rules that must never depend on model judgment: canonical action digests, legal state transitions, freshness checks, idempotency keys, mutation counting, reconciliation, and the final evidence verdict.

## Binding human judgment to an exact action

Before requesting approval, Proofline freezes the intended outcome into an immutable contract containing:

- the Salesforce case and current revision;
- the Stripe payment identifier;
- amount and currency;
- refund reason;
- a unique run identifier.

It serializes those consequential fields canonically and creates a SHA-256 digest. Slack receives the action details and that digest. A human approves the precise contract rather than a vague request such as “refund the customer.”

Before execution, Proofline independently checks that the Slack approval matches and that the Salesforce revision is still current. If the record changed during the wait, the approved action is rejected as stale.

## Making `UNKNOWN` a first-class state

The most important part of the demo is an intentionally ambiguous write.

Proofline sends one idempotent refund request to Stripe Test Mode. Stripe commits the refund, but the response is deliberately discarded to simulate a connection failure at the worst possible moment.

Proofline does not retry blindly, and it does not invent success. It moves to `UNKNOWN`.

An isolated verifier queries Stripe's authoritative state using immutable run metadata. If it finds the committed refund, Proofline proves that the mutation count is exactly one, records the receipt in Salesforce, and reads Salesforce back independently.

Only when the Slack approval, Stripe refund, and Salesforce receipt all match can the workflow reach `VERIFIED` and issue the verdict `PROVEN`.

This distinction matters: idempotency helps prevent duplicate writes, but idempotency alone does not prove that the business outcome occurred.

## Deploying the agent to Amazon Bedrock AgentCore

Proofline uses the AWS Strands Agents SDK for TypeScript and an Amazon Nova Lite inference profile through Amazon Bedrock. I deployed the Node.js 22 application to Amazon Bedrock AgentCore Runtime using the CodeZip deployment path.

Adapting the local application to the managed runtime required several production-shaped changes:

- listening on AgentCore's runtime interface and port;
- implementing the `/ping` health contract;
- exposing the `/invocations` endpoint used by the runtime;
- bundling the Strands SDK and application dependencies;
- treating `/var/task` as read-only;
- moving ephemeral runtime evidence to writable `/tmp` storage;
- retaining CloudWatch logs for runtime observability.

The repository includes the AgentCore project, reproducible deployment configuration, and a deployment runbook.

## Testing the claims

Proofline includes eight executable tests for the properties that matter most:

- canonical digests are stable;
- changing any consequential field changes the digest;
- stale Salesforce state blocks execution;
- illegal state transitions fail closed;
- incomplete evidence cannot produce `PROVEN`;
- Strands can propose without authorizing execution;
- execution is exposed only through the guarded kernel;
- an ambiguous Stripe response is reconciled without a duplicate mutation.

The tests can be run with:

```bash
npm install
npm run check
```

## What I learned

The hardest part of a multi-app agent is not connecting APIs. It is deciding which component has authority, which evidence is authoritative, and what the system should say when the truth is temporarily unclear.

Three design principles emerged:

1. **Models should propose; deterministic controls should authorize.**
2. **Human approval should bind to immutable intent.**
3. **Agents need explicit observation and reconciliation after execution.**

An honest `UNKNOWN` state is more valuable than a premature success message.

## What comes next

The kernel is operation-agnostic. The same pattern could govern invoice adjustments, service credits, subscription changes, procurement approvals, and account restoration. Future work would add durable evidence storage, AgentCore Identity for managed third-party credentials, and reusable Outcome Contract evaluators for other Strands agents.

Watch the working demo: https://youtu.be/ebHoo7YhQ-w

Explore the source and setup instructions: https://github.com/napsterly/proofline-strands

#AgentsforHumans
