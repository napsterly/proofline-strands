# 3-minute Agents for Humans demo script

The goal is not to tour features. It is to make one dangerous failure unforgettable, then prove that Proofline handles it correctly.

## Recording rules

- Record at 1920×1080, 60 fps; export 1080p, H.264, under five minutes.
- Use real browser captures from the official Slack workspace, Stripe Test Mode, Salesforce Developer Edition, and the Proofline console.
- Hide bookmarks, personal notifications, tokens, account IDs, and unrelated tabs.
- Use decisive cuts, 180–250 ms directional motion, restrained sound design, and burned-in captions.
- Never label a local twin as an official integration. The primary run must use all three live vendor environments.

## Shot list and voiceover

**0:00–0:12 — Cold open**

Visual: A refund is marked “sent,” then the connection drops. Freeze on `UNKNOWN`.

Voiceover: “The most dangerous agent failure is not an error. It’s an action that happened—without a response.”

**0:12–0:28 — Problem, person, stakes**

Visual: Three disconnected tabs—Salesforce, Slack, and Stripe—surround a support operator.

Voiceover: “Support teams spend their day carrying one decision across disconnected systems. Automating the clicks helps—but automating the judgment, or pretending an uncertain payment succeeded, creates a much bigger problem.”

**0:28–0:42 — Thesis**

Visual: Proofline wordmark resolves into the three-system truth contract.

Voiceover: “Proofline is a reliability layer for multi-app agents. AI can propose. Proofline makes it prove.”

**0:42–1:04 — Strands proposes; policy binds**

Visual: Type the natural-language refund request. The structured fields fill. Zoom to the digest.

Voiceover: “An AWS Strands agent turns the request into a structured proposal and selects a guarded approval tool. The model cannot touch Stripe. A deterministic kernel reads Salesforce and binds every consequential field—and its exact revision—to one cryptographic digest.”

**1:04–1:24 — Human judgment in Slack**

Visual: Match-cut from digest in Proofline to the same digest in Slack. Add ✅.

Voiceover: “The customer cannot approve a vague intention. Slack records a human approval for this exact amount, payment, case, and reason.”

**1:24–1:48 — The hard failure**

Visual: Return to Proofline. `EXECUTING` becomes amber `UNKNOWN`; connection line breaks.

Voiceover: “Stripe commits the refund—but we deliberately lose its response. Proofline does not retry. And it does not invent success. It says: unknown.”

**1:48–2:10 — Recovery, not retry**

Visual: Animated state path `UNKNOWN → RECONCILING → VERIFYING`; cut to the real Stripe refund readback.

Voiceover: “It reconciles against Stripe’s authoritative state, finds the committed refund by immutable run metadata, and proves there was exactly one mutation.”

**2:10–2:28 — Cross-system truth**

Visual: Salesforce Case closes with the refund receipt. Three evidence cards illuminate left to right.

Voiceover: “Then it writes the receipt to Salesforce, reads it back, and checks all three independent systems.”

**2:28–2:42 — Verdict**

Visual: Full-width mint `PROVEN`; evidence digest lands. Slack receives final result.

Voiceover: “Only when approval, money, and the system of record agree does Proofline say proven.”

**2:42–2:54 — Technical credibility**

Visual: Fast cuts of the Strands tools, guarded state machine, AgentCore runtime endpoints, and passing tests: `8 passed`, `Stripe calls: 1`.

Voiceover: “The claims are executable: five narrow Strands tools, guarded transitions, tamper checks, stale-revision blocking, and a one-call recovery test.”

**2:54–3:00 — Close**

Visual: Wordmark and line: `Evidence, not optimism.`

Voiceover: “Proofline. Evidence, not optimism.”
