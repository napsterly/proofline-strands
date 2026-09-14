const ui = {
  form: document.querySelector("#run-form"),
  runButton: document.querySelector("#run-button"),
  seedButton: document.querySelector("#seed-button"),
  verifyButton: document.querySelector("#verify-button"),
  planButton: document.querySelector("#plan-button"),
  empty: document.querySelector("#empty-state"),
  run: document.querySelector("#run-state"),
  state: document.querySelector("#state-title"),
  glyph: document.querySelector("#state-glyph"),
  digest: document.querySelector("#digest-value"),
  copyDigest: document.querySelector("#copy-digest"),
  approval: document.querySelector("#approval-callout"),
  approvalButton: document.querySelector("#approval-button"),
  verdict: document.querySelector("#verdict"),
  evidenceDigest: document.querySelector("#evidence-digest"),
  timeline: document.querySelector("#timeline"),
  progress: [...document.querySelectorAll("#progress-track i")],
  toast: document.querySelector("#toast"),
};

let activeRun = null;
let polling = null;

const stateProgress = {
  PREPARING: 1,
  WAITING_APPROVAL: 2,
  APPROVED: 2,
  EXECUTING: 3,
  UNKNOWN: 3,
  RECONCILING: 4,
  VERIFYING: 4,
  VERIFIED: 5,
  BLOCKED: 5,
  FAILED: 5,
};

ui.verifyButton.addEventListener("click", verifyConnections);
ui.planButton.addEventListener("click", draftPlan);
ui.seedButton.addEventListener("click", seedDemo);
ui.form.addEventListener("submit", startRun);
ui.approvalButton.addEventListener("click", checkApproval);
ui.copyDigest.addEventListener("click", async () => {
  if (!activeRun?.envelope?.digest) return;
  await navigator.clipboard.writeText(activeRun.envelope.digest);
  toast("Digest copied");
});

async function boot() {
  try {
    const health = await api("/api/health");
    paintConfigured(health.configured);
    const fromUrl = new URLSearchParams(location.search).get("run");
    if (fromUrl) renderRun(await api(`/api/runs/${encodeURIComponent(fromUrl)}`));
  } catch (error) {
    toast(error.message, true);
  }
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  void Promise.resolve(context.registerTool({
    name: "get_proofline_status",
    title: "Get Proofline status",
    description: "Read the current integration readiness and active proof run without changing external systems.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute() {
      const health = await api("/api/health");
      return { configured: health.configured, activeRun: activeRun ? { id: activeRun.id, state: activeRun.state, verdict: activeRun.verdict?.status || null } : null };
    },
  })).catch(() => {});

  void Promise.resolve(context.registerTool({
    name: "request_refund_approval",
    title: "Request bound refund approval",
    description: "Prepare a refund from a Salesforce case and Stripe PaymentIntent, bind its exact parameters to a digest, and request human approval in Slack. This does not execute the refund.",
    inputSchema: {
      type: "object",
      properties: {
        caseIdOrNumber: { type: "string", description: "Salesforce Case ID or Case Number" },
        paymentIntentId: { type: "string", pattern: "^pi_", description: "Stripe Test Mode PaymentIntent ID" },
        amount: { type: "integer", minimum: 1, description: "Refund amount in minor currency units, such as cents" },
        currency: { type: "string", enum: ["usd"] },
        reason: { type: "string", minLength: 3 },
        injectStripeTimeout: { type: "boolean", description: "Demonstrate recovery after a committed mutation loses its response" },
      },
      required: ["caseIdOrNumber", "paymentIntentId", "amount", "currency", "reason"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      const run = await api("/api/runs", { method: "POST", body: JSON.stringify(input) });
      history.replaceState({}, "", `/?run=${encodeURIComponent(run.id)}`);
      renderRun(run);
      if (run.state === "WAITING_APPROVAL") startPolling();
      return { runId: run.id, state: run.state, actionDigest: run.envelope?.digest || null, approvalRequested: run.state === "WAITING_APPROVAL" };
    },
  })).catch(() => {});
}

async function verifyConnections() {
  busy(ui.verifyButton, true, "Verifying…");
  try {
    const checks = await api("/api/integrations/verify");
    for (const [service, result] of Object.entries(checks)) {
      const pill = document.querySelector(`[data-service="${service}"]`);
      pill.textContent = result.ok ? "verified" : "not ready";
      pill.className = `status-pill ${result.ok ? "ok" : "bad"}`;
    }
    const count = Object.values(checks).filter((item) => item.ok).length;
    toast(`${count}/3 official integrations verified${count === 3 ? " — ready to prove." : "."}`, count !== 3);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(ui.verifyButton, false, "Verify connections");
  }
}

async function draftPlan() {
  const input = document.querySelector("#agent-input").value.trim();
  busy(ui.planButton, true, "Reading intent…");
  try {
    const plan = await api("/api/plan", { method: "POST", body: JSON.stringify({ text: input }) });
    if (plan.caseIdOrNumber) document.querySelector("#case-input").value = plan.caseIdOrNumber;
    if (plan.paymentIntentId) document.querySelector("#payment-input").value = plan.paymentIntentId;
    if (plan.amount) document.querySelector("#amount-input").value = (plan.amount / 100).toFixed(2);
    if (plan.reason) document.querySelector("#reason-input").value = plan.reason;
    const summary = document.querySelector("#risk-summary");
    summary.textContent = `${plan.riskSummary}${plan.missingFields.length ? ` Missing: ${plan.missingFields.join(", ")}.` : " Ready for deterministic checks."}`;
    summary.classList.remove("hidden");
    toast(`Strands proposal drafted with ${plan.model}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(ui.planButton, false, "Draft safe action");
  }
}

async function seedDemo() {
  busy(ui.seedButton, true, "Creating official test records…");
  try {
    const dollars = Number(document.querySelector("#amount-input").value);
    const seed = await api("/api/demo/seed", {
      method: "POST",
      body: JSON.stringify({ amount: Math.round(dollars * 100), currency: document.querySelector("#currency-input").value }),
    });
    document.querySelector("#case-input").value = seed.caseNumber;
    document.querySelector("#payment-input").value = seed.paymentIntentId;
    toast(`Created Stripe ${seed.paymentIntentId} + Salesforce case ${seed.caseNumber}`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(ui.seedButton, false, "Generate official test records");
  }
}

async function startRun(event) {
  event.preventDefault();
  busy(ui.runButton, true, "Binding action…");
  try {
    const run = await api("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        caseIdOrNumber: document.querySelector("#case-input").value.trim(),
        paymentIntentId: document.querySelector("#payment-input").value.trim(),
        amount: Math.round(Number(document.querySelector("#amount-input").value) * 100),
        currency: document.querySelector("#currency-input").value,
        reason: document.querySelector("#reason-input").value.trim(),
        injectStripeTimeout: document.querySelector("#fault-input").checked,
      }),
    });
    history.replaceState({}, "", `/?run=${encodeURIComponent(run.id)}`);
    renderRun(run);
    if (run.state === "WAITING_APPROVAL") startPolling();
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(ui.runButton, false, "Request bound approval");
  }
}

async function checkApproval() {
  if (!activeRun) return;
  busy(ui.approvalButton, true, "Checking…");
  try {
    const run = await api(`/api/runs/${encodeURIComponent(activeRun.id)}/check-approval`, { method: "POST" });
    renderRun(run);
    if (terminal(run.state)) stopPolling();
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy(ui.approvalButton, false, "Check now");
  }
}

function startPolling() {
  stopPolling();
  polling = setInterval(checkApproval, 3500);
}

function stopPolling() {
  if (polling) clearInterval(polling);
  polling = null;
}

function renderRun(run) {
  activeRun = run;
  ui.empty.classList.add("hidden");
  ui.run.classList.remove("hidden");
  ui.state.textContent = humanState(run.state);
  ui.state.style.color = stateColor(run.state);
  ui.glyph.textContent = String(stateProgress[run.state] || 1).padStart(2, "0");
  ui.digest.textContent = run.envelope?.digest || "waiting for source state…";
  ui.progress.forEach((node, index) => node.classList.toggle("on", index < (stateProgress[run.state] || 1)));
  ui.approval.classList.toggle("hidden", run.state !== "WAITING_APPROVAL");

  paintReceipt("slack", Boolean(run.approval?.approved), run.approval?.approved
    ? `${run.approval.count} human reaction · ${short(run.approval.digest)}`
    : run.approval?.messageTs ? `message ${run.approval.messageTs}` : "Not collected");
  paintReceipt("stripe", Boolean(run.evidence?.stripe?.refundId), run.evidence?.stripe?.refundId
    ? `${run.evidence.stripe.refundId} · ${run.evidence.stripe.status}`
    : run.state === "UNKNOWN" ? "Outcome unknown — reconciling" : "Not collected");
  paintReceipt("salesforce", Boolean(run.evidence?.salesforce?.containsRefundId), run.evidence?.salesforce?.caseNumber
    ? `case ${run.evidence.salesforce.caseNumber} · ${run.evidence.salesforce.status}`
    : "Not collected");

  ui.verdict.classList.toggle("hidden", run.verdict?.status !== "PROVEN");
  ui.evidenceDigest.textContent = run.verdict?.evidenceDigest || "";
  renderTimeline(run.events || []);

  if (run.state === "VERIFIED") toast("Outcome proven across Slack, Stripe, and Salesforce.");
  if (["FAILED", "BLOCKED"].includes(run.state)) toast(run.events.at(-1)?.detail || run.state, true);
}

function renderTimeline(events) {
  if (!events.length) return;
  const first = Date.parse(events[0].at);
  ui.timeline.innerHTML = events.map((item, index) => {
    const elapsed = Date.parse(item.at) - first;
    const kindClass = item.kind === "VERIFIED" ? "good" : ["UNKNOWN", "RECONCILING"].includes(item.kind) ? "warn" : ["FAILED", "BLOCKED"].includes(item.kind) ? "bad" : "";
    return `<div class="timeline-item ${kindClass} ${index === events.length - 1 ? "current" : ""}">
      <time>+${formatElapsed(elapsed)}</time><span class="timeline-node"></span>
      <div class="timeline-copy"><strong>${escapeHtml(humanState(item.kind))}</strong><p>${escapeHtml(item.detail)}</p></div>
    </div>`;
  }).join("");
  ui.timeline.scrollTop = ui.timeline.scrollHeight;
}

function paintConfigured(configured) {
  for (const [service, ready] of Object.entries(configured)) {
    const pill = document.querySelector(`[data-service="${service}"]`);
    if (!pill) continue;
    pill.textContent = ready ? "configured" : "needs key";
    pill.className = `status-pill ${ready ? "ok" : "bad"}`;
  }
}

function paintReceipt(service, verified, detail) {
  const node = document.querySelector(`#${service}-receipt`);
  node.classList.toggle("verified", verified);
  node.querySelector("b").textContent = verified ? "✓" : "—";
  node.querySelector("small").textContent = detail;
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function busy(button, value, label) {
  button.disabled = value;
  button.querySelector?.("span") ? button.querySelector("span").textContent = label : button.textContent = label;
}

function toast(message, error = false) {
  ui.toast.textContent = message;
  ui.toast.className = `toast show ${error ? "error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove("show"), 4200);
}

function terminal(state) { return ["VERIFIED", "FAILED", "BLOCKED"].includes(state); }
function short(value) { return value ? `${value.slice(0, 9)}…${value.slice(-5)}` : "—"; }
function humanState(value) { return String(value || "").replaceAll("_", " "); }
function stateColor(state) {
  if (state === "VERIFIED") return "var(--mint)";
  if (["UNKNOWN", "RECONCILING"].includes(state)) return "var(--yellow)";
  if (["FAILED", "BLOCKED"].includes(state)) return "var(--coral)";
  return "var(--mint)";
}
function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const millis = String(ms % 1000).padStart(3, "0");
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${millis}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

registerWebMcpTools();
boot();
