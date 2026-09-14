# Security model

Proofline is a hackathon demonstration built exclusively for official test/developer environments.

- Stripe refuses any secret key that does not begin with `sk_test_`.
- Secrets stay in `.env` or gitignored session files and must never be committed.
- The Strands agent has no tool that directly calls Stripe; every consequential action crosses the deterministic safety kernel.
- The approval-request tool cannot authorize or execute its own proposal.
- Slack approval covers a canonical SHA-256 action digest.
- Salesforce revision drift blocks execution after approval.
- Stripe writes are idempotent and ambiguous outcomes reconcile before retry.
- Logs and HTTP responses do not intentionally include access tokens or secret keys.

Before production use, add a managed secret store, encrypted persistence, authenticated console access, approver allowlists, key rotation, webhook signature verification, durable queues, and formal threat modeling.
