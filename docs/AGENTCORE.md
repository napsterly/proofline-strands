# AgentCore deployment runbook

Proofline targets Amazon Bedrock AgentCore Runtime using the managed Node.js 22 CodeZip runtime. AgentCore is optional for the hackathon, but a successful deployment provides concrete production-readiness evidence.

## Why Runtime is the right scope

- The repository already implements the required `GET /ping` and `POST /invocations` HTTP contract.
- CodeZip avoids Docker and produces the fastest deployment path.
- Runtime supplies session isolation, scaling, CloudWatch logs, and a stable invocation ARN.
- AgentCore Memory, Gateway, and Identity are intentionally deferred: they do not strengthen the core human-approval demonstration enough to justify deadline risk.

## Prerequisites

1. AWS credentials configured locally or through an IAM role.
2. Permission to use Amazon Bedrock and AgentCore Runtime.
3. Bedrock model access in the chosen region.
4. A runtime execution role and S3 deployment bucket when using direct API deployment.

Promotional credits for the event have already been disbursed, so review AWS costs and stop runtime sessions after testing.

## Build and test locally

```bash
npm ci
npm run check
npm run build:agentcore
```

Run the bundled artifact on the AgentCore port:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "8080"
node dist/agentcore.js
```

In another terminal:

```powershell
Invoke-RestMethod http://localhost:8080/ping
Invoke-RestMethod http://localhost:8080/invocations -Method Post -ContentType "application/json" -Body '{"prompt":"Verify the configured connections and explain what evidence is available."}'
```

## CodeZip contents

Package these paths at the ZIP root:

```text
dist/agentcore.js
dist/package.json
public/
data/.gitkeep
```

Configure the runtime with:

```text
runtime: NODE_22
entryPoint: dist/agentcore.js
networkMode: PUBLIC
HOST: 0.0.0.0
PORT: 8080
```

The bundle contains the Strands SDK and runtime dependencies. The additional `public/` and `data/` paths support the console and ephemeral run store; production persistence should move to a durable AWS service.

## Evidence to capture

For the repository and video, retain:

- `agentcore status` showing the runtime is ready
- a successful `agentcore invoke` response
- the AgentCore runtime ARN with the AWS account segment blurred
- one CloudWatch trace showing a Strands tool call
- cleanup or stopped-session evidence after recording

Never publish AWS keys, account identifiers, integration tokens, or raw trace fields containing customer data.
