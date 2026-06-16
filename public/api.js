export async function login(username, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return parseResponse(response);
}

export async function verifySignInCode(code) {
  const response = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code })
  });
  return parseResponse(response);
}

export async function resendSignInCode() {
  const response = await fetch("/api/auth/verify/resend", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  return parseResponse(response);
}

export async function setupVerificationEmail(email) {
  const response = await fetch("/api/auth/verify/setup-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  return parseResponse(response);
}

export async function touchSession() {
  const response = await fetch("/api/auth/ping", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  return parseResponse(response);
}

export async function preserveDrafts(draftCache) {
  const response = await fetch("/api/auth/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draftCache)
  });
  return parseResponse(response);
}

export async function getRecoverableDrafts() {
  const response = await fetch("/api/auth/drafts");
  return parseResponse(response);
}

export async function logout(reason = "") {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {})
  });
  return parseResponse(response);
}

export async function getCurrentUser() {
  const response = await fetch("/api/auth/me");
  return parseResponse(response);
}

export async function getData() {
  const response = await fetch("/api/data");
  return parseResponse(response);
}

export async function getPracticeBackup() {
  const response = await fetch("/api/backup");
  return parseResponse(response);
}

export async function restorePracticeBackup(backup) {
  const response = await fetch("/api/backup/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup)
  });
  return parseResponse(response);
}

export async function getAuditLog() {
  const response = await fetch("/api/audit");
  return parseResponse(response);
}

export async function getUsers() {
  const response = await fetch("/api/users");
  return parseResponse(response);
}

export async function createUser(user) {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(user)
  });
  return parseResponse(response);
}

export async function updateUser(userId, user) {
  const response = await fetch(`/api/users/${userId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(user)
  });
  return parseResponse(response);
}

export async function createAuditEvent(event) {
  const response = await fetch("/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event)
  });
  return parseResponse(response);
}

export async function createClient(profile) {
  const response = await fetch("/api/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile)
  });
  return parseResponse(response);
}

export async function updateClientProfile(clientId, profile) {
  const response = await fetch(`/api/clients/${clientId}/profile`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile)
  });
  return parseResponse(response);
}

export async function updateClientWorkflow(clientId, workflowBoard) {
  const response = await fetch(`/api/clients/${clientId}/workflow`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflowBoard })
  });
  return parseResponse(response);
}

export async function deleteClient(clientId) {
  const response = await fetch(`/api/clients/${clientId}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function uploadClientDocument(clientId, document) {
  const response = await fetch(`/api/clients/${clientId}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(document)
  });
  return parseResponse(response);
}

export async function deleteClientDocument(clientId, documentId) {
  const response = await fetch(`/api/clients/${clientId}/documents/${documentId}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function createSession(session) {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session)
  });
  return parseResponse(response);
}

export async function updateNote(sessionId, soapNote, finalized) {
  const response = await fetch(`/api/sessions/${sessionId}/note`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ soapNote, finalized })
  });
  return parseResponse(response);
}

export async function deleteSession(sessionId) {
  const response = await fetch(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function deleteSessionTargetData(sessionId, programId, targetId) {
  const response = await fetch(`/api/sessions/${sessionId}/targets/${programId}/${targetId}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function deleteSessionBehaviorData(sessionId, behaviorId) {
  const response = await fetch(`/api/sessions/${sessionId}/behaviors/${behaviorId}`, {
    method: "DELETE"
  });
  return parseResponse(response);
}

export async function updateClientPlan(clientId, plan) {
  const response = await fetch(`/api/clients/${clientId}/plan`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plan)
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    const message = payload.errors?.join(" ") || "Request failed.";
    const error = new Error(message);
    error.status = response.status;
    error.code = payload.code || "";
    error.details = payload;
    if (
      response.status === 401
      && typeof window !== "undefined"
      && ["AUTH_REQUIRED", "SESSION_TIMEOUT", "SESSION_EXPIRED", "MFA_REQUIRED", "MFA_SETUP_REQUIRED", "VERIFICATION_REQUIRED", "VERIFICATION_EMAIL_REQUIRED"].includes(payload.code || "")
    ) {
      window.dispatchEvent(new CustomEvent("aba-auth-error", { detail: payload }));
    }
    throw error;
  }
  return payload;
}
