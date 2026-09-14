# Devpost submission copy

## Project name

Proofline Strands

## Tagline

The accountability layer that lets AI act across business systems—and refuses to say done until the evidence agrees.

## Track

Professional Agents

## Elevator pitch

Support teams lose hours coordinating consequential actions across CRM, chat, and payments. A normal agent can automate the clicks, but an API timeout after a successful write creates a dangerous question: did the refund fail, or did the response fail? Proofline is an AWS Strands agent that coordinates a Salesforce case, human approval in Slack, and a Stripe Test Mode refund while keeping authority inside a deterministic safety kernel. It binds approval to the exact action, executes with a stable idempotency key, reads every system back, and exposes `UNKNOWN` instead of inventing success. Only matching evidence from all three apps can produce `PROVEN`.

## Inspiration

Agent demos usually end when a tool call returns 200. Real operations do not. Networks fail after writes, records change while approvals wait, and retries can duplicate expensive actions. We wanted an agent that could do meaningful professional work without asking people to trust its confidence.

## What it does

Proofline turns a refund request into an immutable Outcome Contract. A Strands planner extracts only supplied facts, then the operator selects from five narrow tools. The agent verifies the connected systems, creates safe test records, requests a Slack approval bound to the action digest, and continues only after independently checking both that approval and the current Salesforce revision. Stripe receives exactly one idempotent refund attempt. Proofline then reads Stripe and Salesforce back before issuing a three-system evidence verdict.

Its Reliability Lab deliberately simulates the hardest case: Stripe commits the refund, but the response disappears. Proofline moves to `UNKNOWN`, searches authoritative Stripe state by immutable run metadata, recovers the original refund without retrying, reconciles Salesforce, and proves there was exactly one mutation.

## How we built it

- AWS Strands Agents SDK for TypeScript provides structured intent extraction, reasoning, and guarded tool selection.
- Amazon Bedrock AgentCore Runtime hosts the same Node 22 HTTP agent used locally; the repository includes the deployable AgentCore CLI and CDK configuration.
- A deterministic state machine and canonical SHA-256 action digest enforce authorization and legal transitions outside the model.
- Slack supplies the human judgment point; Stripe Test Mode supplies the consequential write; Salesforce Developer Edition supplies the business record and reconciliation receipt.
- CloudWatch provides runtime logs. Eight executable tests cover tampering, stale state, illegal transitions, missing evidence, and the ambiguous-response recovery path.

## Challenges we ran into

The difficult part was not calling three APIs. It was defining what “done” means when each application can expose a different truth. We separated proposal, authorization, execution, observation, and proof; made `UNKNOWN` a first-class state; and ensured the model never receives a direct Stripe mutation tool. AgentCore CodeZip deployment also required adapting the local server to a read-only `/var/task`, writable `/tmp` evidence storage, Node 22 bundling, and the runtime health contract.

## Accomplishments that we're proud of

- One real workflow across three official test/developer environments.
- Human approval is cryptographically bound to the exact amount, payment, case revision, currency, and reason.
- A lost response after a committed write is recovered without a second mutation.
- The success claim is mechanically impossible until Slack, Stripe, and Salesforce evidence all match.
- The agent is deployed to Amazon Bedrock AgentCore and ships with reproducible infrastructure configuration.

## What we learned

Human-in-the-loop is stronger when the human approves an immutable intent rather than a vague natural-language request. We also learned that idempotency prevents duplicate writes, but it does not prove the business outcome; reliable agents need explicit observation and reconciliation after execution.

## What's next

Proofline's kernel is operation-agnostic. Next we would add policy packs for credits, invoice adjustments, subscription changes, account restoration, and procurement approvals; persist evidence in durable storage; add AgentCore Identity for managed third-party credentials; and publish reusable outcome-contract evaluators for other Strands agents.

## Testing instructions

1. Clone the public repository and run `npm install` followed by `npm run check`.
2. Copy `.env.example` to `.env` and add credentials for Slack, Stripe Test Mode, Salesforce Developer Edition, and Amazon Bedrock.
3. Run `npm start`, open `http://localhost:8787/setup.html`, verify all connections, and then open the main console.
4. Seed the official test records, prepare the refund, approve the bound message in Slack, and continue the run.
5. Enable Reliability Lab to observe `UNKNOWN -> RECONCILING -> VERIFIED` with a single Stripe mutation.

No production payment credentials are accepted; the Stripe adapter requires a Test Mode key.

## Built with

AWS Strands Agents SDK, Amazon Bedrock, Amazon Nova Lite, Amazon Bedrock AgentCore Runtime, AWS CloudWatch, TypeScript, Node.js, Slack API, Stripe Test Mode API, Salesforce REST API, Zod, esbuild, AWS CDK.

## Links

- Code: https://github.com/napsterly/proofline-strands
- Demo video: https://youtu.be/ebHoo7YhQ-w
