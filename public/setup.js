const form = document.querySelector("#setup-form");
const statusNode = document.querySelector("#setup-status");
const saveButton = document.querySelector("#save");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await request("/api/setup", { method: "POST", body: JSON.stringify(payload) });
    form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
    paint(result);
  } catch (error) {
    statusNode.textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save locally";
  }
});

function paint(result) {
  const services = Object.entries(result.configured || {}).map(([name, ready]) => `${name}: ${ready ? "ready" : "missing"}`);
  statusNode.textContent = `${result.saved ? "Saved. " : ""}${services.join(" · ")} · Salesforce OAuth: ${result.salesforceOAuth ? "ready" : "missing"}`;
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

request("/api/setup/status").then(paint).catch((error) => { statusNode.textContent = error.message; });
