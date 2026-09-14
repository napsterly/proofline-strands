# Integration setup

All three connections use official vendor environments. Never commit `.env`, access tokens, or secrets.

## Slack

1. Open <https://api.slack.com/apps> and choose **Create New App → From an app manifest**.
2. Select the `dash` workspace and paste [`config/slack-app-manifest.yaml`](../config/slack-app-manifest.yaml).
3. Install the app to the workspace and copy its `xoxb-…` bot token into `SLACK_BOT_TOKEN` in `.env`.
4. In Slack, invite `@Proofline` to the demo channel and copy that channel ID into `SLACK_CHANNEL_ID`.

The bot requests approval with a message whose metadata contains the exact action digest. A human approves by adding the ✅ reaction. Proofline reads that reaction through Slack's API before any refund is attempted.

## Stripe Test Mode

1. Keep the `dash sandbox` account in Test Mode.
2. Open **Developers → API keys** and place the Test Mode secret key (`sk_test_…`) in `STRIPE_SECRET_KEY`.
3. Never use a live key. Proofline rejects any key that does not begin with `sk_test_`.

The **Generate official test records** button creates a real Test Mode PaymentIntent using Stripe's documented test payment method. The refund then uses an idempotency key derived from the run ID and approved digest.

## Salesforce Developer Edition

Preferred path: an External Client App using Authorization Code + PKCE.

1. In Salesforce Setup, enable the authorization-code flow under **OAuth and OpenID Connect Settings** if required.
2. Create an **External Client App** named `Proofline` with OAuth enabled.
3. Set the callback URL to `http://localhost:8787/api/auth/salesforce/callback`.
4. Add scopes `Manage user data via APIs (api)` and `Perform requests at any time (refresh_token, offline_access)`.
5. Enable Authorization Code flow and require PKCE. For this local public client, do not require the consumer secret.
6. Put the consumer key in `SALESFORCE_CLIENT_ID`, restart Proofline, then visit <http://localhost:8787/api/auth/salesforce/start>.

For a one-session demo, `SALESFORCE_INSTANCE_URL` and `SALESFORCE_ACCESS_TOKEN` can instead be supplied directly. OAuth sessions are stored only in the gitignored `data/salesforce-session.json` file.

## Verify

Run `npm start`, open <http://localhost:8787>, and click **Verify connections**. Do not begin the recorded run until all three services say `verified`.

