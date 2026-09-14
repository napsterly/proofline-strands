import "./load-env.js";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProoflineAgent, publicError } from "./agent.js";
import { RunStore } from "./store.js";
import { SlackAdapter } from "./integrations/slack.js";
import { StripeAdapter } from "./integrations/stripe.js";
import { SalesforceAdapter } from "./integrations/salesforce.js";
import { SalesforceOAuth } from "./salesforce-oauth.js";
import { StrandsProoflineAgent } from "./strands-agent.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const salesforceSessionPath = path.join(root, "data", "salesforce-session.json");
const integrationConfigPath = path.join(root, "data", "integrations.json");
const restoredSalesforceSession = await readOptionalJson(salesforceSessionPath);
const restoredIntegrationConfig = await readOptionalJson(integrationConfigPath) || {};

const integrationConfig = {
  slackBotToken: process.env.SLACK_BOT_TOKEN || restoredIntegrationConfig.slackBotToken,
  slackChannelId: process.env.SLACK_CHANNEL_ID || restoredIntegrationConfig.slackChannelId,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || restoredIntegrationConfig.stripeSecretKey,
  salesforceClientId: process.env.SALESFORCE_CLIENT_ID || restoredIntegrationConfig.salesforceClientId,
};

const store = new RunStore(path.join(root, "data", "runs.json"));
const slack = new SlackAdapter({
  token: integrationConfig.slackBotToken,
  channel: integrationConfig.slackChannelId,
  publicBaseUrl,
});
const stripe = new StripeAdapter({ secretKey: integrationConfig.stripeSecretKey });
const salesforce = new SalesforceAdapter({
  instanceUrl: process.env.SALESFORCE_INSTANCE_URL || restoredSalesforceSession?.instanceUrl,
  accessToken: process.env.SALESFORCE_ACCESS_TOKEN || restoredSalesforceSession?.accessToken,
  apiVersion: process.env.SALESFORCE_API_VERSION || "v61.0",
});
const salesforceOAuth = new SalesforceOAuth({
  clientId: integrationConfig.salesforceClientId,
  redirectUri: `${publicBaseUrl}/api/auth/salesforce/callback`,
  loginUrl: process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com",
});
const kernel = new ProoflineAgent({
  store,
  slack,
  stripe,
  salesforce,
});
const strands = new StrandsProoflineAgent({
  kernel,
  store,
  modelId: process.env.STRANDS_MODEL_ID,
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/ping") {
      return json(response, 200, { status: "Healthy", framework: "AWS Strands Agents" });
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: true, service: "proofline-strands", time: new Date().toISOString(), configured: { ...kernel.readiness(), strands: true }, strands: strands.readiness() });
    }
    if (request.method === "GET" && url.pathname === "/api/setup/status") {
      assertLocalRequest(request);
      return json(response, 200, { configured: kernel.readiness(), salesforceOAuth: salesforceOAuth.configured() });
    }
    if (request.method === "POST" && url.pathname === "/api/setup") {
      assertLocalRequest(request);
      const body = await readJson(request);
      if (body.stripeSecretKey && !String(body.stripeSecretKey).startsWith("sk_test_")) throw new Error("Stripe key must be an official Test Mode sk_test_ key");
      for (const key of ["slackBotToken", "slackChannelId", "stripeSecretKey", "salesforceClientId"]) {
        if (body[key]) integrationConfig[key] = String(body[key]).trim();
      }
      slack.token = integrationConfig.slackBotToken;
      slack.channel = integrationConfig.slackChannelId;
      stripe.secretKey = integrationConfig.stripeSecretKey;
      salesforceOAuth.clientId = integrationConfig.salesforceClientId;
      await writePrivateJson(integrationConfigPath, integrationConfig);
      return json(response, 200, { saved: true, configured: kernel.readiness(), salesforceOAuth: salesforceOAuth.configured() });
    }
    if (request.method === "POST" && url.pathname === "/api/plan") {
      const body = await readJson(request);
      return json(response, 200, await strands.plan(body.text));
    }
    if (request.method === "POST" && ["/api/agent", "/invocations"].includes(url.pathname)) {
      const body = await readJson(request);
      return json(response, 200, await strands.invoke(body.prompt || body.input?.prompt));
    }
    if (request.method === "GET" && url.pathname === "/api/integrations/verify") {
      return json(response, 200, await kernel.verifyIntegrations());
    }
    if (request.method === "GET" && url.pathname === "/api/auth/salesforce/start") {
      response.writeHead(302, { Location: salesforceOAuth.begin(), "Cache-Control": "no-store" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/api/auth/salesforce/callback") {
      if (url.searchParams.get("error")) throw new Error(`Salesforce authorization denied: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`);
      const session = await salesforceOAuth.complete({ code: url.searchParams.get("code"), state: url.searchParams.get("state") });
      salesforce.instanceUrl = session.instanceUrl;
      salesforce.accessToken = session.accessToken;
      await writeFile(salesforceSessionPath, JSON.stringify(session, null, 2));
      response.writeHead(302, { Location: "/?salesforce=connected", "Cache-Control": "no-store" });
      return response.end();
    }
    if (request.method === "POST" && url.pathname === "/api/demo/seed") {
      const body = await readJson(request);
      return json(response, 201, await kernel.seedDemo({ amount: Number(body.amount || 4200), currency: body.currency || "usd" }));
    }
    if (request.method === "GET" && url.pathname === "/api/runs") {
      return json(response, 200, { runs: await store.list() });
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const body = await readJson(request);
      validateRunInput(body);
      return json(response, 201, await kernel.prepare(body));
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      const run = await store.get(runMatch[1]);
      return run ? json(response, 200, run) : json(response, 404, { error: "Run not found" });
    }
    const approvalMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/check-approval$/);
    if (request.method === "POST" && approvalMatch) {
      return json(response, 200, await kernel.checkAndExecute(approvalMatch[1]));
    }

    if (request.method === "GET") return serveStatic(url.pathname, response);
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return json(response, error.message?.includes("not found") ? 404 : 500, { error: publicError(error) });
  }
});

server.listen(port, host, () => {
  console.log(`Proofline Strands running at http://${host}:${port}`);
});

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const safePath = path.resolve(root, "public", requested);
  const publicRoot = path.resolve(root, "public");
  if (!safePath.startsWith(publicRoot)) return json(response, 403, { error: "Forbidden" });
  try {
    const content = await readFile(safePath);
    response.writeHead(200, { "Content-Type": contentType(safePath), "Cache-Control": "no-store" });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { error: "Not found" });
    throw error;
  }
}

function validateRunInput(body) {
  for (const field of ["caseIdOrNumber", "paymentIntentId", "amount", "reason"]) {
    if (body[field] === undefined || body[field] === "") throw new Error(`${field} is required`);
  }
  if (!Number.isInteger(Number(body.amount)) || Number(body.amount) <= 0) throw new Error("amount must be positive integer cents");
  if (!String(body.paymentIntentId).startsWith("pi_")) throw new Error("paymentIntentId must begin with pi_");
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  if (Buffer.concat(chunks).length > 1_000_000) throw new Error("Request body too large");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function contentType(filePath) {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" })[path.extname(filePath)] || "application/octet-stream";
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertLocalRequest(request) {
  const host = String(request.headers.host || "").split(":")[0];
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error("Local setup only");
  const origin = request.headers.origin;
  if (origin && !origin.startsWith("http://localhost:") && !origin.startsWith("http://127.0.0.1:")) throw new Error("Invalid setup origin");
}

async function writePrivateJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tempPath, filePath);
}
