export class IntegrationError extends Error {
  constructor(service, message, details = {}) {
    super(`${service}: ${message}`);
    this.name = "IntegrationError";
    this.service = service;
    this.details = details;
  }
}

export class AmbiguousMutationError extends IntegrationError {
  constructor(service, message, details = {}) {
    super(service, message, details);
    this.name = "AmbiguousMutationError";
  }
}

export async function fetchJson(url, options = {}, service = "integration") {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new IntegrationError(service, body?.error?.message || body?.message || `HTTP ${response.status}`, {
      status: response.status,
      body,
    });
  }
  return { body, response };
}

