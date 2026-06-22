import { createServer } from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  duplicateBehaviorIds,
  duplicateTargetIdsFromPrograms,
  removeBehaviorPointFromSession,
  removeTargetPointFromSession
} from "./public/session-utils.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const uploadsDir = join(root, "uploads");
const dbPath = process.env.DB_PATH || join(dataDir, "db.json");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const dataStore = process.env.DATA_STORE || (process.env.DB_HOST || process.env.DATABASE_URL ? "postgres" : "json");
const documentStore = process.env.DOCUMENT_STORE || (process.env.S3_BUCKET ? "s3" : "local");
const sessions = new Map();
const preservedDrafts = new Map();
const AGENCIES = ["Triumph ABA", "One Clinical Care"];
const DEFAULT_AGENCY = AGENCIES[0];

function envNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function mfaFeatureEnabled() {
  return String(process.env.MFA_ENABLED || "").trim().toLowerCase() === "true";
}

const SESSION_ABSOLUTE_TIMEOUT_SECONDS = envNumber(
  "SESSION_ABSOLUTE_TIMEOUT_SECONDS",
  envNumber("ABSOLUTE_SESSION_HOURS", 12) * 60 * 60
);
const SESSION_INACTIVITY_TIMEOUT_SECONDS = envNumber(
  "SESSION_INACTIVITY_TIMEOUT_SECONDS",
  envNumber("INACTIVITY_TIMEOUT_MINUTES", 45) * 60
);
const SESSION_MAX_AGE_SECONDS = SESSION_ABSOLUTE_TIMEOUT_SECONDS;
const MFA_PENDING_TIMEOUT_SECONDS = Number(process.env.MFA_PENDING_TIMEOUT_SECONDS || (60 * 10));
const VERIFICATION_CODE_TTL_SECONDS = Number(process.env.VERIFICATION_CODE_TTL_SECONDS || (60 * 10));
const VERIFICATION_ATTEMPT_LIMIT = Number(process.env.VERIFICATION_ATTEMPT_LIMIT || 5);
const VERIFICATION_RESEND_LIMIT = Number(process.env.VERIFICATION_RESEND_LIMIT || 3);
const VERIFICATION_CODE_LENGTH = 6;
let cachedDbCaCert = null;
let cachedDbCaCertKey = null;
let emailModulePromise = null;
let emailTransportPromise = null;
const verificationDebugDeliveries = [];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

async function readDb() {
  if (dataStore === "postgres") {
    const [{ Pool }, store] = await Promise.all([import("pg"), import("./lib/postgres-store.mjs")]);
    return store.readDbFromPostgres(postgresConfig(Pool));
  }
  const raw = await readFile(dbPath, "utf8");
  return JSON.parse(raw);
}

async function readDbWithUsers() {
  const db = await readDb();
  let changed = ensureDefaultUsers(db);
  if (ensureAgencyScoping(db)) changed = true;
  if (ensureClientNoteHistories(db)) changed = true;
  if (ensureUserSecurityDefaults(db)) changed = true;
  if (changed) await writeDb(db);
  return db;
}

async function writeDb(db) {
  if (dataStore === "postgres") {
    const [{ Pool }, store] = await Promise.all([import("pg"), import("./lib/postgres-store.mjs")]);
    await store.writeDbToPostgres(postgresConfig(Pool), db);
    return;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function decodeEnvMultiline(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

export function resolveDbCaCert() {
  const inlineCert = String(process.env.DB_CA_CERT || "").trim();
  const base64Cert = String(process.env.DB_CA_CERT_BASE64 || "").trim();
  const certPath = String(process.env.DB_CA_CERT_PATH || "").trim();
  const cacheKey = `${inlineCert}|${base64Cert}|${certPath}`;
  if (cacheKey === cachedDbCaCertKey) return cachedDbCaCert;

  let caCert = "";
  if (inlineCert) {
    caCert = decodeEnvMultiline(inlineCert);
  } else if (base64Cert) {
    caCert = Buffer.from(base64Cert, "base64").toString("utf8");
  } else if (certPath) {
    caCert = readFileSync(certPath, "utf8");
  }

  cachedDbCaCertKey = cacheKey;
  cachedDbCaCert = caCert;
  return caCert;
}

export function postgresConfig(Pool) {
  const sslEnabled = process.env.DB_SSL === "true" || (process.env.NODE_ENV === "production" && process.env.DB_SSL !== "false");
  return {
    Pool,
    databaseUrl: process.env.DATABASE_URL || "",
    host: process.env.DB_HOST || "",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    ssl: sslEnabled,
    sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    caCert: resolveDbCaCert()
  };
}

function s3Config() {
  return {
    bucket: process.env.S3_BUCKET || "",
    region: process.env.AWS_REGION || "us-east-1"
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, payload) {
  applySecurityHeaders(res);
  applyNoStoreHeaders(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("set-cookie", `aba_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`);
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("set-cookie", `aba_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function applySecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

function applyNoStoreHeaders(res) {
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("pragma", "no-cache");
  res.setHeader("expires", "0");
}

function validateSession(payload, db) {
  const errors = [];
  const client = db.clients.find((item) => item.id === payload.clientId);
  if (!client) errors.push("Client is required.");
  if (!payload.date) errors.push("Date is required.");
  if (!payload.therapist?.trim()) errors.push("Therapist is required.");
  if (!payload.providerSignature?.trim()) errors.push("Provider signature is required.");
  if (!payload.startTime || !payload.endTime) errors.push("Start and end time are required.");
  if (!payload.setting?.trim()) errors.push("Setting is required.");
  const isParentTraining = payload.serviceType === "parent-training";
  if (!isParentTraining && (!Array.isArray(payload.programs) || payload.programs.length === 0)) {
    errors.push("At least one program target is required.");
  }

  const programs = (payload.programs || []).map((program) => {
    const targets = Array.isArray(program.targets) ? program.targets : [program];
    return {
      programId: program.programId,
      targets: targets.filter((target) => target.targetId).map((target) => {
        const trials = Number(target.trials || 0);
        const correct = Number(target.correct || 0);
        const incorrect = Number(target.incorrect || 0);
        const denominator = trials || correct + incorrect;
        const independence = denominator > 0 ? Math.round((correct / denominator) * 100) : 0;
        return {
          targetId: target.targetId,
          trials,
          correct,
          incorrect,
          promptLevel: target.promptLevel,
          phase: target.phase === "baseline" ? "baseline" : "intervention",
          independence
        };
      })
    };
  }).filter((program) => program.targets.length);

  if (!isParentTraining && !programs.length) {
    errors.push("At least one target is required.");
  }

  const duplicateTargetIds = new Set(duplicateTargetIdsFromPrograms(programs));
  programs.forEach((program) => {
    const planProgram = client?.programs?.find((item) => item.id === program.programId);
    if (!planProgram) errors.push("Program is not in this client's treatment plan.");
    program.targets.forEach((target) => {
      const planTarget = planProgram?.targets?.find((item) => item.id === target.targetId);
      if (!planTarget) errors.push("Target is not in this client's treatment plan.");
      if (duplicateTargetIds.has(target.targetId)) {
        errors.push("Each target can only appear once per session.");
      }
    });
  });

  const behaviors = (payload.behaviors || [])
    .filter((behavior) => behavior.behaviorId)
    .map((behavior) => ({
      behaviorId: behavior.behaviorId,
      frequency: Number(behavior.frequency || 0),
      duration: behavior.duration?.trim() || "",
      intensity: behavior.intensity || "",
      phase: behavior.phase === "baseline" ? "baseline" : "intervention"
    }));

  behaviors.forEach((behavior) => {
    const planBehavior = client?.behaviors?.find((item) => item.id === behavior.behaviorId);
    if (!planBehavior) errors.push("Behavior is not in this client's treatment plan.");
  });

  const duplicateBehaviorIdsSet = new Set(duplicateBehaviorIds(behaviors));
  behaviors.forEach((behavior) => {
    if (duplicateBehaviorIdsSet.has(behavior.behaviorId)) {
      errors.push("Each behavior can only appear once per session.");
    }
  });

  const parentGoals = isParentTraining
    ? sanitizeParentGoals(payload.parentGoals || [])
    : [];
  if (isParentTraining && !parentGoals.length) {
    errors.push("At least one parent training goal is required.");
  }

  return {
    errors,
    session: {
      id: crypto.randomUUID(),
      clientId: payload.clientId,
      date: payload.date,
      therapist: payload.therapist.trim(),
      startTime: payload.startTime,
      endTime: payload.endTime,
      setting: payload.setting.trim(),
      caregiverPresent: Boolean(payload.caregiverPresent),
      affect: payload.affect || "neutral",
      transitions: payload.transitions || "typical",
      programs,
      behaviors,
      barriers: payload.barriers || "none",
      barrierText: payload.barrierText?.trim() || "",
      caregiverTraining: Boolean(payload.caregiverTraining),
      notes: payload.notes?.trim() || "",
      serviceType: isParentTraining ? "parent-training" : "97153",
      parentTraining: isParentTraining ? {
        caregiverName: String(payload.parentTraining?.caregiverName || "").trim(),
        trainingFocus: String(payload.parentTraining?.trainingFocus || "").trim()
      } : null,
      parentGoals,
      providerSignature: payload.providerSignature?.trim() || "",
      providerCredential: payload.providerCredential?.trim() || "",
      soapNote: payload.soapNote || "",
      finalized: false,
      agency: normalizeAgency(client?.agency),
      createdAt: new Date().toISOString()
    }
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    applySecurityHeaders(res);
    if (extname(filePath) === ".html") applyNoStoreHeaders(res);
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function serveUpload(req, res, db, user) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname.replace(/^\/uploads\/?/, ""));
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const clientId = safePath.split(/[\\/]/)[0];
  const client = (db.clients || []).find((item) => item.id === clientId);

  if (!client || !canAccessClient(user, client)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (documentStore === "s3") {
    if (!safePath || safePath.startsWith("..")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const { getS3Object } = await import("./lib/s3-storage.mjs");
      const object = await getS3Object(s3Config(), safePath);
      applySecurityHeaders(res);
      applyNoStoreHeaders(res);
      res.writeHead(200, {
        "content-type": object.ContentType || contentTypes[extname(safePath)] || "application/octet-stream"
      });
      for await (const chunk of object.Body) res.write(chunk);
      res.end();
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }

  const filePath = join(uploadsDir, safePath);

  if (!filePath.startsWith(uploadsDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    applySecurityHeaders(res);
    applyNoStoreHeaders(res);
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function ensureAgencyScoping(db) {
  let changed = false;
  db.users = Array.isArray(db.users) ? db.users : [];
  db.clients = Array.isArray(db.clients) ? db.clients : [];
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];

  db.users.forEach((user) => {
    const normalizedAgency = normalizeAgency(user.agency);
    if (user.agency !== normalizedAgency) {
      user.agency = normalizedAgency;
      changed = true;
    }
    if (typeof user.isMasterAdmin !== "boolean") {
      user.isMasterAdmin = false;
      changed = true;
    }
  });

  if (!db.users.some((user) => isMasterAdmin(user))) {
    const fallbackMaster = db.users.find((user) => user.role === "admin" && user.active !== false)
      || db.users.find((user) => user.role === "admin");
    if (fallbackMaster) {
      fallbackMaster.isMasterAdmin = true;
      changed = true;
    }
  }

  db.clients.forEach((client) => {
    const normalizedAgency = normalizeAgency(client.agency);
    if (client.agency !== normalizedAgency) {
      client.agency = normalizedAgency;
      changed = true;
    }
  });

  db.sessions.forEach((session) => {
    const client = db.clients.find((item) => item.id === session.clientId);
    const normalizedAgency = normalizeAgency(session.agency || client?.agency);
    if (session.agency !== normalizedAgency) {
      session.agency = normalizedAgency;
      changed = true;
    }
  });

  db.auditLog.forEach((entry) => {
    const client = db.clients.find((item) => item.id === entry.clientId);
    const normalizedAgency = normalizeAgency(entry.agency || client?.agency);
    if (entry.agency !== normalizedAgency) {
      entry.agency = normalizedAgency;
      changed = true;
    }
  });

  return changed;
}

export function resetRuntimeState() {
  sessions.clear();
}

export function createAppServer() {
  return createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const db = await readDbWithUsers();
      const payload = await readBody(req);
      const username = String(payload.username || "").trim().toLowerCase();
      const user = (db.users || []).find((item) => (
        item.active !== false
        && (item.username === username || normalizeEmail(item.email) === username)
      ));
      if (!user || !verifyPassword(String(payload.password || ""), user.passwordHash)) {
        logAudit(db, req, user, "failed-login", {
          details: { usernameAttempt: username }
        });
        await writeDb(db);
        authFailure(res, 401, "AUTH_INVALID", "Invalid username or password.");
        return;
      }
      const token = crypto.randomUUID();
      if (requiresMfa(user)) {
        const verificationEmail = userVerificationEmail(user);
        if (!verificationEmail) {
          const session = createSessionRecord(user.id, "pending-email-setup");
          sessions.set(token, session);
          sendAuthCookie(res, token);
          sendJson(res, 200, {
            verificationRequired: true,
            setupRequired: true,
            deliveryMethod: "email",
            user: publicUser(user),
            message: "Enter the email address you want to use for sign-in verification."
          });
          return;
        }
        try {
          const session = createSessionRecord(user.id, "pending-mfa-verify");
          const verification = await startVerificationChallenge(session, user);
          sessions.set(token, session);
          sendAuthCookie(res, token);
          logAudit(db, req, user, "verification-code-issued", {
            details: { deliveryMethod: "email" }
          });
          await writeDb(db);
          sendJson(res, 200, verification);
          return;
        } catch (error) {
          if (error?.message?.includes("No verification email") || error?.code === "VERIFICATION_DELIVERY_FAILED") {
            console.error("Verification email delivery failed", {
              code: error?.code || "UNKNOWN",
              message: error?.message || "",
              userId: user.id,
              destinationMask: maskEmail(userVerificationEmail(user))
            });
            logAudit(db, req, user, "verification-delivery-failed", {
              details: {
                deliveryMethod: "email",
                reason: error?.code || "UNKNOWN",
                destinationMask: maskEmail(userVerificationEmail(user))
              }
            });
            await writeDb(db);
            authFailure(res, 503, "VERIFICATION_UNAVAILABLE", error.message);
            return;
          }
          authServiceUnavailable(res);
          return;
        }
      }
      sessions.set(token, createSessionRecord(user.id, "authenticated", {
        mfaVerifiedAt: new Date().toISOString()
      }));
      sendAuthCookie(res, token);
      user.lastLoginAt = new Date().toISOString();
      logAudit(db, req, user, "login", { details: { mfaEnabled: false } });
      await writeDb(db);
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const db = await readDbWithUsers();
      const token = sessionToken(req);
      const payload = await readBody(req).catch(() => ({}));
      const session = token ? sessions.get(token) : null;
      const user = session ? (db.users || []).find((item) => item.id === session.userId) : null;
      if (session && user) {
        logAudit(db, req, user, payload.reason === "timeout" ? "session-timeout" : "logout", {
          details: { stage: session.stage || "authenticated" }
        });
        await writeDb(db);
      }
      if (token) sessions.delete(token);
      clearAuthCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify/setup-email") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db, { requireAuthenticatedMfa: false });
      if (state.status !== "ok" || state.session.stage !== "pending-email-setup") {
        authFailure(res, 401, "VERIFICATION_EMAIL_REQUIRED", "Sign in again to set a verification email.");
        return;
      }
      const payload = await readBody(req);
      const email = normalizeEmail(payload.email);
      if (!email || !looksLikeEmail(email)) {
        authFailure(res, 400, "VERIFICATION_EMAIL_INVALID", "Enter a valid verification email.");
        return;
      }
      const duplicateEmail = (db.users || []).some((existing) => existing.id !== state.user.id && normalizeEmail(existing.email) === email);
      if (duplicateEmail) {
        authFailure(res, 400, "VERIFICATION_EMAIL_TAKEN", "That verification email is already assigned to another user.");
        return;
      }
      state.user.email = email;
      try {
        const verification = await startVerificationChallenge(state.session, state.user);
        logAudit(db, req, state.user, "verification-email-set", {
          details: { deliveryMethod: "email" }
        });
        logAudit(db, req, state.user, "verification-code-issued", {
          details: { deliveryMethod: "email" }
        });
        await writeDb(db);
        sendJson(res, 200, verification);
      } catch (error) {
        if (error?.message?.includes("No verification email") || error?.code === "VERIFICATION_DELIVERY_FAILED") {
          console.error("Verification email delivery failed", {
            code: error?.code || "UNKNOWN",
            message: error?.message || "",
            userId: state.user.id,
            destinationMask: maskEmail(userVerificationEmail(state.user))
          });
          logAudit(db, req, state.user, "verification-delivery-failed", {
            details: {
              deliveryMethod: "email",
              reason: error?.code || "UNKNOWN",
              destinationMask: maskEmail(userVerificationEmail(state.user))
            }
          });
          await writeDb(db);
          authFailure(res, 503, "VERIFICATION_UNAVAILABLE", error.message);
          return;
        }
        authServiceUnavailable(res);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/drafts") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db);
      if (state.status !== "ok") {
        requireAuth(req, res, db, state);
        return;
      }
      const payload = await readBody(req);
      preservedDrafts.set(state.user.id, sanitizeRecoverableDrafts(payload));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/drafts") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db);
      if (state.status !== "ok") {
        requireAuth(req, res, db, state);
        return;
      }
      const drafts = preservedDrafts.get(state.user.id) || { intake: {}, session: {}, preservedAt: "" };
      preservedDrafts.delete(state.user.id);
      sendJson(res, 200, drafts);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/mfa/setup/verify") {
      authFailure(res, 410, "VERIFICATION_METHOD_CHANGED", "Authenticator setup is no longer used. Sign in again to receive an email verification code.");
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/auth/mfa/verify" || url.pathname === "/api/auth/verify")) {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db, { requireAuthenticatedMfa: false });
      if (state.status !== "ok" || state.session.stage !== "pending-mfa-verify") {
        authFailure(res, 401, "VERIFICATION_REQUIRED", "Sign in again to complete verification.");
        return;
      }
      const payload = await readBody(req);
      if (Date.now() > Number(state.session.verificationCodeExpiresAt || 0)) {
        logAudit(db, req, state.user, "verification-code-expired", {
          details: { deliveryMethod: "email" }
        });
        await writeDb(db);
        authFailure(res, 401, "VERIFICATION_CODE_EXPIRED", "That verification code has expired. Request a new one.");
        return;
      }
      if (Number(state.session.verificationAttemptCount || 0) >= VERIFICATION_ATTEMPT_LIMIT) {
        logAudit(db, req, state.user, "verification-code-rate-limited", {
          details: { deliveryMethod: "email" }
        });
        await writeDb(db);
        authFailure(res, 429, "VERIFICATION_RATE_LIMITED", "Too many incorrect verification attempts. Sign in again to request a new code.");
        return;
      }
      const code = String(payload.code || "").trim();
      const valid = code && verifyPassword(code, state.session.verificationCodeHash || "");
      if (!valid) {
        state.session.verificationAttemptCount = Number(state.session.verificationAttemptCount || 0) + 1;
        logAudit(db, req, state.user, "verification-challenge-failed", {
          details: { deliveryMethod: "email", attempts: state.session.verificationAttemptCount }
        });
        await writeDb(db);
        authFailure(res, 401, "VERIFICATION_CODE_INVALID", "That verification code is not valid.");
        return;
      }
      state.user.lastLoginAt = new Date().toISOString();
      const nextToken = crypto.randomUUID();
      sessions.delete(state.token);
      sessions.set(nextToken, createSessionRecord(state.user.id, "authenticated", {
        verifiedAt: new Date().toISOString()
      }));
      sendAuthCookie(res, nextToken);
      logAudit(db, req, state.user, "login", {
        details: { verificationMethod: "email" }
      });
      await writeDb(db);
      sendJson(res, 200, { user: publicUser(state.user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify/resend") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db, { requireAuthenticatedMfa: false });
      if (state.status !== "ok" || state.session.stage !== "pending-mfa-verify") {
        authFailure(res, 401, "VERIFICATION_REQUIRED", "Sign in again to request a new verification code.");
        return;
      }
      try {
        const payload = await startVerificationChallenge(state.session, state.user, { isResend: true });
        logAudit(db, req, state.user, "verification-code-resent", {
          details: { deliveryMethod: "email", resendCount: state.session.verificationResendCount }
        });
        await writeDb(db);
        sendJson(res, 200, payload);
      } catch (error) {
        if (error.code === "VERIFICATION_RESEND_LIMIT") {
          authFailure(res, 429, "VERIFICATION_RESEND_LIMIT", error.message);
          return;
        }
        if (error?.message?.includes("No verification email") || error?.code === "VERIFICATION_DELIVERY_FAILED") {
          console.error("Verification email delivery failed", {
            code: error?.code || "UNKNOWN",
            message: error?.message || "",
            userId: state.user.id,
            destinationMask: maskEmail(userVerificationEmail(state.user))
          });
          logAudit(db, req, state.user, "verification-delivery-failed", {
            details: {
              deliveryMethod: "email",
              reason: error?.code || "UNKNOWN",
              destinationMask: maskEmail(userVerificationEmail(state.user))
            }
          });
          await writeDb(db);
          authFailure(res, 503, "VERIFICATION_UNAVAILABLE", error.message);
          return;
        }
        authServiceUnavailable(res);
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db);
      if (state.status === "expired") {
        logAudit(db, req, state.user, "session-timeout", {
          details: { reason: state.reason }
        });
        await writeDb(db);
        authFailure(res, 401, state.reason === "inactive" ? "SESSION_TIMEOUT" : "SESSION_EXPIRED", "Session expired. Please sign in again.");
        return;
      }
      if (state.status === "mfa-setup-required") {
        authFailure(res, 401, "VERIFICATION_EMAIL_REQUIRED", "A verification email is required before accessing clinical data.", {
          verificationRequired: true,
          setupRequired: true,
          deliveryMethod: "email",
          user: publicUser(state.user)
        });
        return;
      }
      if (state.status === "mfa-required") {
        authFailure(res, 401, "VERIFICATION_REQUIRED", "Email verification is required before accessing clinical data.", {
          mfaRequired: true,
          setupRequired: false,
          verificationRequired: true,
          deliveryMethod: "email",
          destinationMask: state.session.verificationEmailMasked || maskEmail(userVerificationEmail(state.user)),
          expiresInSeconds: Math.max(0, Math.ceil((Number(state.session.verificationCodeExpiresAt || 0) - Date.now()) / 1000)),
          user: publicUser(state.user)
        });
        return;
      }
      if (state.status !== "ok") {
        authFailure(res, 401, "AUTH_REQUIRED", "Not signed in.");
        return;
      }
      sendJson(res, 200, { user: publicUser(state.user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/ping") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db);
      if (state.status !== "ok") {
        requireAuth(req, res, db, state);
        return;
      }
      sendJson(res, 200, {
        ok: true,
        inactivityTimeoutSeconds: SESSION_INACTIVITY_TIMEOUT_SECONDS,
        absoluteTimeoutSeconds: SESSION_ABSOLUTE_TIMEOUT_SECONDS
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/data") {
      const db = await readDbWithUsers();
      const state = sessionStatus(req, db);
      if (state.status !== "ok") {
        requireAuth(req, res, db, state);
        return;
      }
      const user = state.user;
      logAudit(db, req, user, "clinical-data-accessed", {
        details: { clientsVisible: visibleClients(db, user).length }
      });
      await writeDb(db);
      sendJson(res, 200, redactDb(db, user));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/backup") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const user = currentUser(req, db);
      if (!isMasterAdmin(user)) {
        sendJson(res, 403, { errors: ["Master admin access is required."] });
        return;
      }
      logAudit(db, req, user, "practice-backup-exported", {
        details: {
          clients: (db.clients || []).length,
          sessions: (db.sessions || []).length,
          auditEntries: (db.auditLog || []).length
        }
      });
      await writeDb(db);
      sendJson(res, 200, practiceBackupPayload(db));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/backup/restore") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const user = currentUser(req, db);
      if (!isMasterAdmin(user)) {
        sendJson(res, 403, { errors: ["Master admin access is required."] });
        return;
      }
      const payload = await readBody(req);
      let restoredDb;
      try {
        restoredDb = restorePracticeBackup(db, payload);
      } catch (error) {
        sendJson(res, 400, { errors: [error.message] });
        return;
      }
      logAudit(restoredDb, req, user, "practice-backup-restored", {
        details: {
          clients: (restoredDb.clients || []).length,
          sessions: (restoredDb.sessions || []).length,
          sourceExportedAt: payload.exportedAt || ""
        }
      });
      await writeDb(restoredDb);
      sendJson(res, 200, redactDb(restoredDb, user));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      sendJson(res, 200, { auditLog: visibleAuditLog(db, currentUser(req, db)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      sendJson(res, 200, { users: visibleUsers(db, currentUser(req, db)).map(publicUser) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const user = createUserRecord(payload, db.users || [], actor);
      db.users.push(user);
      logAudit(db, req, actor, "user-created", {
        details: { username: user.username, role: user.role, agency: user.agency, isMasterAdmin: user.isMasterAdmin }
      });
      await writeDb(db);
      sendJson(res, 201, publicUser(user));
      return;
    }

    const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (req.method === "PUT" && userMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const targetUser = (db.users || []).find((item) => item.id === userMatch[1]);
      if (!targetUser) {
        sendJson(res, 404, { errors: ["User not found."] });
        return;
      }
      if (!isMasterAdmin(actor) && (isMasterAdmin(targetUser) || userAgency(targetUser) !== userAgency(actor))) {
        sendJson(res, 403, { errors: ["You can only manage users in your agency."] });
        return;
      }
      const before = userAuditSnapshot(targetUser);
      updateUserRecord(targetUser, payload, actor, db.users || []);
      logAudit(db, req, actor, payload.password ? "user-password-reset" : "user-updated", {
        details: {
          username: targetUser.username,
          before,
          after: userAuditSnapshot(targetUser),
          passwordReset: Boolean(payload.password)
        }
      });
      await writeDb(db);
      sendJson(res, 200, publicUser(targetUser));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/audit") {
      const db = await readDbWithUsers();
      const user = currentUser(req, db);
      if (!user) {
        sendJson(res, 401, { errors: ["Not signed in."] });
        return;
      }
      const payload = await readBody(req);
      if (payload.clientId) {
        const client = db.clients.find((item) => item.id === payload.clientId);
        if (!client || !canAccessClient(user, client)) {
          sendJson(res, 403, { errors: ["You cannot record events for this client."] });
          return;
        }
      }
      logAudit(db, req, user, payload.action || "event-recorded", {
        clientId: payload.clientId,
        details: payload.details || {}
      });
      await writeDb(db);
      sendJson(res, 201, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba", "read-only"])) return;
      await serveUpload(req, res, db, currentUser(req, db));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/clients") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const name = String(payload.name || "").trim();
      if (!name) {
        sendJson(res, 400, { errors: ["Client name is required."] });
        return;
      }
      const client = createClientRecord(payload, db.clients || [], actor);
      db.clients.push(client);
      logAudit(db, req, actor, "client-created", {
        clientId: client.id,
        details: { name: client.name, agency: client.agency }
      });
      await writeDb(db);
      sendJson(res, 201, client);
      return;
    }

    const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
    if (req.method === "DELETE" && clientMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const actor = currentUser(req, db);
      const client = db.clients.find((item) => item.id === clientMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      if (!canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }

      for (const document of client.profile?.documents || []) {
        if (document.s3Key && documentStore === "s3") {
          const { deleteS3Object } = await import("./lib/s3-storage.mjs");
          await deleteS3Object(s3Config(), document.s3Key).catch(() => {});
        } else if (document.relativePath) {
          await unlink(join(root, document.relativePath)).catch(() => {});
        }
      }

      const removedSessions = db.sessions.filter((session) => session.clientId === client.id).length;
      db.sessions = db.sessions.filter((session) => session.clientId !== client.id);
      db.clients = db.clients.filter((item) => item.id !== client.id);
      db.auditLog = (db.auditLog || []).filter((entry) => entry.clientId !== client.id && entry.clientName !== client.name);
      logAudit(db, req, actor, "client-deleted", {
        details: {
          clientName: client.name,
          sessionsDeleted: removedSessions,
          documentsDeleted: (client.profile?.documents || []).length
        }
      });
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }

    const profileMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/profile$/);
    if (req.method === "PUT" && profileMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const client = db.clients.find((item) => item.id === profileMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      if (!canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      const name = String(payload.name || "").trim();
      if (!name) {
        sendJson(res, 400, { errors: ["Client name is required."] });
        return;
      }
      const before = clientProfileAuditSnapshot(client);
      updateClientRecord(client, payload, actor);
      const after = clientProfileAuditSnapshot(client);
      logAudit(db, req, actor, "client-profile-updated", {
        clientId: client.id,
        details: {
          before,
          after,
          changes: diffObjects(before, after)
        }
      });
      await writeDb(db);
      sendJson(res, 200, client);
      return;
    }

    const workflowMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/workflow$/);
    if (req.method === "PUT" && workflowMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const client = db.clients.find((item) => item.id === workflowMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      if (!canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      client.workflowBoard = sanitizeWorkflowBoard(payload.workflowBoard || client.workflowBoard || defaultClinicalWorkflowBoard());
      client.updatedAt = new Date().toISOString();
      logAudit(db, req, actor, "workflow-board-updated", {
        clientId: client.id,
        details: {
          cards: client.workflowBoard.length,
          done: client.workflowBoard.filter((card) => card.status === "done").length
        }
      });
      await writeDb(db);
      sendJson(res, 200, client);
      return;
    }

    const documentCollectionMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/documents$/);
    if (req.method === "POST" && documentCollectionMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const client = db.clients.find((item) => item.id === documentCollectionMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      if (!canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      const document = await saveClientDocument(client, payload);
      logAudit(db, req, actor, "document-uploaded", {
        clientId: client.id,
        details: { type: document.type, fileName: document.fileName }
      });
      await writeDb(db);
      sendJson(res, 201, document);
      return;
    }

    const documentMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/documents\/([^/]+)$/);
    if (req.method === "DELETE" && documentMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const actor = currentUser(req, db);
      const client = db.clients.find((item) => item.id === documentMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      if (!canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      const documents = client.profile?.documents || [];
      const document = documents.find((item) => item.id === documentMatch[2]);
      if (!document) {
        sendJson(res, 404, { errors: ["Document not found."] });
        return;
      }
      client.profile.documents = documents.filter((item) => item.id !== document.id);
      if (document.s3Key && documentStore === "s3") {
        const { deleteS3Object } = await import("./lib/s3-storage.mjs");
        await deleteS3Object(s3Config(), document.s3Key).catch(() => {});
      } else if (document.relativePath) {
        await unlink(join(root, document.relativePath)).catch(() => {});
      }
      client.updatedAt = new Date().toISOString();
      logAudit(db, req, actor, "document-deleted", {
        clientId: client.id,
        details: { before: documentAuditSnapshot(document) }
      });
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }

    const planMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/plan$/);
    if (req.method === "PUT" && planMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const client = db.clients.find((item) => item.id === planMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      if (!canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      const before = treatmentPlanAuditSnapshot(client);
      client.domains = sanitizeDomains(payload.domains || client.domains || []);
      client.programs = sanitizePrograms(payload.programs || client.programs || []);
      client.behaviors = sanitizeBehaviors(payload.behaviors || client.behaviors || []);
      client.rbtPerformanceAreas = sanitizeRbtPerformanceAreas(payload.rbtPerformanceAreas || client.rbtPerformanceAreas || []);
      client.planChangeLog = sanitizePlanChangeLog(payload.planChangeLog || client.planChangeLog || []);
      const note97151History = sanitizeNoteHistoryEntries(payload.note97151History ?? client.note97151History ?? [], "97151");
      const note97155History = sanitizeNoteHistoryEntries(payload.note97155History ?? client.note97155History ?? [], "97155");
      const rawNote97151 = String(payload.note97151 ?? client.note97151 ?? "").trim();
      const rawNote97155 = String(payload.note97155 ?? client.note97155 ?? "").trim();
      if (rawNote97151 && !note97151History.length) {
        note97151History.unshift(createNoteHistoryEntry("97151", rawNote97151, {
          date: client.profile?.assessment?.date || client.planUpdatedAt || client.updatedAt || client.createdAt
        }));
      }
      if (rawNote97155 && !note97155History.length) {
        note97155History.unshift(createNoteHistoryEntry("97155", rawNote97155, {
          date: client.planUpdatedAt || client.updatedAt || client.createdAt
        }));
      }
      client.note97151History = note97151History;
      client.note97155History = note97155History;
      client.note97151 = note97151History[0]?.note || rawNote97151;
      client.note97155 = note97155History[0]?.note || rawNote97155;
      client.planUpdatedAt = new Date().toISOString();
      const after = treatmentPlanAuditSnapshot(client);
      logAudit(db, req, actor, "treatment-plan-updated", {
        clientId: client.id,
        details: {
          before: before.summary,
          after: after.summary,
          changes: treatmentPlanChanges(before, after)
        }
      });
      await writeDb(db);
      sendJson(res, 200, client);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const db = await readDbWithUsers();
      const user = currentUser(req, db);
      if (!user) {
        sendJson(res, 401, { errors: ["Not signed in."] });
        return;
      }
      const payload = await readBody(req);
      if (!["admin", "bcba", "rbt"].includes(user.role)) {
        sendJson(res, 403, { errors: ["Your role cannot create sessions."] });
        return;
      }
      if (user.role === "rbt" && payload.serviceType === "parent-training") {
        sendJson(res, 403, { errors: ["RBT users can only enter 97153 sessions."] });
        return;
      }
      const client = db.clients.find((item) => item.id === payload.clientId);
      if (!client || !canAccessClient(user, client)) {
        sendJson(res, 403, { errors: ["You cannot create sessions for this client."] });
        return;
      }
      const { errors, session } = validateSession(payload, db);
      if (errors.length) {
        sendJson(res, 400, { errors });
        return;
      }
      db.sessions.unshift(session);
      logAudit(db, req, user, "session-created", {
        clientId: session.clientId,
        details: { serviceType: session.serviceType, date: session.date }
      });
      await writeDb(db);
      sendJson(res, 201, session);
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === "DELETE" && sessionMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      const actor = currentUser(req, db);
      const session = db.sessions.find((item) => item.id === sessionMatch[1]);
      if (session && !canAccessAgency(actor, session.agency)) {
        sendJson(res, 403, { errors: ["You cannot access this session."] });
        return;
      }
      const originalLength = db.sessions.length;
      db.sessions = db.sessions.filter((item) => item.id !== sessionMatch[1]);
      if (db.sessions.length === originalLength) {
        sendJson(res, 404, { errors: ["Session not found."] });
        return;
      }
      logAudit(db, req, actor, "session-deleted", {
        clientId: session?.clientId,
        details: { serviceType: session?.serviceType || "97153", date: session?.date || "" }
      });
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }

    const targetPointMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/targets\/([^/]+)\/([^/]+)$/);
    if (req.method === "DELETE" && targetPointMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba", "rbt"])) return;
      const actor = currentUser(req, db);
      const session = db.sessions.find((item) => item.id === targetPointMatch[1]);
      if (!session) {
        sendJson(res, 404, { errors: ["Session not found."] });
        return;
      }
      if (!canAccessAgency(actor, session.agency)) {
        sendJson(res, 403, { errors: ["You cannot access this session."] });
        return;
      }
      const client = db.clients.find((item) => item.id === session.clientId);
      if (!client || !canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      const [, sessionId, programId, targetId] = targetPointMatch;
      const result = removeTargetPointFromSession(session, programId, targetId);
      if (!result.removed) {
        sendJson(res, 404, { errors: ["Target data point not found."] });
        return;
      }
      Object.assign(session, result.session, { updatedAt: new Date().toISOString() });
      logAudit(db, req, actor, "session-target-data-deleted", {
        clientId: session.clientId,
        details: { sessionId, programId, targetId, date: session.date, serviceType: session.serviceType || "97153" }
      });
      await writeDb(db);
      sendJson(res, 200, session);
      return;
    }

    const behaviorPointMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/behaviors\/([^/]+)$/);
    if (req.method === "DELETE" && behaviorPointMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba", "rbt"])) return;
      const actor = currentUser(req, db);
      const session = db.sessions.find((item) => item.id === behaviorPointMatch[1]);
      if (!session) {
        sendJson(res, 404, { errors: ["Session not found."] });
        return;
      }
      if (!canAccessAgency(actor, session.agency)) {
        sendJson(res, 403, { errors: ["You cannot access this session."] });
        return;
      }
      const client = db.clients.find((item) => item.id === session.clientId);
      if (!client || !canAccessClient(actor, client)) {
        sendJson(res, 403, { errors: ["You cannot access this client."] });
        return;
      }
      const [, sessionId, behaviorId] = behaviorPointMatch;
      const result = removeBehaviorPointFromSession(session, behaviorId);
      if (!result.removed) {
        sendJson(res, 404, { errors: ["Behavior data point not found."] });
        return;
      }
      Object.assign(session, result.session, { updatedAt: new Date().toISOString() });
      logAudit(db, req, actor, "session-behavior-data-deleted", {
        clientId: session.clientId,
        details: { sessionId, behaviorId, date: session.date, serviceType: session.serviceType || "97153" }
      });
      await writeDb(db);
      sendJson(res, 200, session);
      return;
    }

    const noteMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/note$/);
    if (req.method === "PUT" && noteMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba", "rbt"])) return;
      const payload = await readBody(req);
      const actor = currentUser(req, db);
      const session = db.sessions.find((item) => item.id === noteMatch[1]);
      if (!session) {
        sendJson(res, 404, { errors: ["Session not found."] });
        return;
      }
      if (!canAccessAgency(actor, session.agency)) {
        sendJson(res, 403, { errors: ["You cannot access this session."] });
        return;
      }
      const before = soapNoteAuditSnapshot(session);
      session.soapNote = String(payload.soapNote || "");
      session.finalized = Boolean(payload.finalized);
      session.updatedAt = new Date().toISOString();
      logAudit(db, req, actor, session.finalized ? "soap-note-finalized" : "soap-note-updated", {
        clientId: session.clientId,
        details: {
          sessionId: session.id,
          date: session.date,
          serviceType: session.serviceType || "97153",
          before,
          after: soapNoteAuditSnapshot(session)
        }
      });
      await writeDb(db);
      sendJson(res, 200, session);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    if (isDatabaseTlsError(error)) {
      console.error("Database TLS configuration error", { code: error?.code || null });
      sendJson(res, 503, {
        code: "DATABASE_UNAVAILABLE",
        errors: ["Secure database connection is temporarily unavailable. Please contact your administrator if this continues."]
      });
      return;
    }
    sendJson(res, 500, { errors: [error.message || "Unexpected server error."] });
  }
  });
}

const shouldAutostartServer = process.env.ABA_DISABLE_AUTOSTART !== "1";
if (shouldAutostartServer) {
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`ABA practice MVP running at http://localhost:${port}`);
  });
}

function ensureDefaultUsers(db) {
  if (Array.isArray(db.users) && db.users.length) return false;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_STARTER_USERS !== "true") {
    throw new Error("No production users found. Migrate or create admin users before starting with NODE_ENV=production.");
  }
  db.users = [
    defaultUser("admin", "Admin User", "admin", "admin123"),
    defaultUser("bcba", "BCBA User", "bcba", "bcba123"),
    defaultUser("rbt", "RBT User", "rbt", "rbt123"),
    defaultUser("readonly", "Read Only User", "read-only", "readonly123")
  ];
  return true;
}

function defaultUser(username, name, role, password) {
  const email = looksLikeEmail(username) ? normalizeEmail(username) : `${username}@local.test`;
  return {
    id: `user-${username}`,
    username,
    email,
    name,
    role,
    agency: DEFAULT_AGENCY,
    isMasterAdmin: role === "admin",
    passwordHash: hashPassword(password),
    active: true,
    mfaEnabled: false,
    mfaSecretEncrypted: "",
    mfaRecoveryCodeHashes: [],
    mfaEnrolledAt: "",
    lastLoginAt: "",
    createdAt: new Date().toISOString()
  };
}

function createUserRecord(payload, existingUsers, actor = null) {
  const username = String(payload.username || "").trim().toLowerCase();
  const email = normalizeEmail(payload.email);
  const name = text(payload.name);
  const password = String(payload.password || "");
  const role = validRole(payload.role);
  const agency = isMasterAdmin(actor)
    ? normalizeAgency(payload.agency, actor?.agency)
    : normalizeAgency(actor?.agency || payload.agency);
  const allowMasterAdmin = isMasterAdmin(actor) && role === "admin" && Boolean(payload.isMasterAdmin);
  if (!username) throw new Error("Username is required.");
  if (!name) throw new Error("Name is required.");
  if (!email) throw new Error("Verification email is required.");
  if (!looksLikeEmail(email)) throw new Error("Verification email must be a valid email address.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (existingUsers.some((user) => user.username === username)) {
    throw new Error("That username already exists.");
  }
  if (existingUsers.some((existing) => normalizeEmail(existing.email) === email)) {
    throw new Error("That verification email is already assigned to another user.");
  }
  return {
    id: `user-${uniqueSlug(username, "user", existingUsers.map((user) => user.id))}`,
    username,
    email,
    name,
    role,
    agency,
    isMasterAdmin: allowMasterAdmin,
    passwordHash: hashPassword(password),
    active: true,
    mfaEnabled: false,
    mfaSecretEncrypted: "",
    mfaRecoveryCodeHashes: [],
    mfaEnrolledAt: "",
    lastLoginAt: "",
    createdAt: new Date().toISOString()
  };
}

function updateUserRecord(user, payload, actor, existingUsers = []) {
  const name = text(payload.name);
  const email = normalizeEmail(payload.email);
  if (!name) throw new Error("Name is required.");
  if (!email) throw new Error("Verification email is required.");
  if (!looksLikeEmail(email)) throw new Error("Verification email must be a valid email address.");
  if (existingUsers.some((existing) => existing.id !== user.id && normalizeEmail(existing.email) === email)) {
    throw new Error("That verification email is already assigned to another user.");
  }
  user.name = name;
  user.email = email;
  user.role = validRole(payload.role);
  user.agency = isMasterAdmin(actor)
    ? normalizeAgency(payload.agency, user.agency)
    : normalizeAgency(actor?.agency || user.agency);
  user.isMasterAdmin = user.role === "admin" && isMasterAdmin(actor) ? Boolean(payload.isMasterAdmin) : false;
  user.active = Boolean(payload.active);
  if (!existingUsers.some((item) => item.id !== user.id && item.role === "admin" && item.active !== false && item.isMasterAdmin)
    && !(user.role === "admin" && user.active !== false && user.isMasterAdmin)) {
    throw new Error("At least one active master admin is required.");
  }
  if (payload.password) {
    const password = String(payload.password);
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
    user.passwordHash = hashPassword(password);
    user.passwordUpdatedAt = new Date().toISOString();
  }
  user.updatedAt = new Date().toISOString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validRole(role) {
  return ["admin", "bcba", "rbt", "read-only"].includes(role) ? role : "rbt";
}

function normalizeAgency(value, fallback = DEFAULT_AGENCY) {
  const agency = text(value);
  return AGENCIES.includes(agency) ? agency : fallback;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

function requiresMfa(user) {
  return mfaFeatureEnabled() && ["admin", "bcba", "rbt", "read-only"].includes(user?.role);
}

function userVerificationEmail(user) {
  const directEmail = normalizeEmail(user?.email);
  if (directEmail) return directEmail;
  return looksLikeEmail(user?.username) ? normalizeEmail(user.username) : "";
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [localPart, domain = ""] = normalized.split("@");
  if (!localPart || !domain) return "";
  const prefix = localPart.length <= 2 ? localPart[0] || "*" : localPart.slice(0, 2);
  return `${prefix}${"*".repeat(Math.max(localPart.length - prefix.length, 1))}@${domain}`;
}

function newVerificationCode() {
  const min = 10 ** (VERIFICATION_CODE_LENGTH - 1);
  const max = (10 ** VERIFICATION_CODE_LENGTH) - 1;
  return String(crypto.randomInt(min, max + 1));
}

function verificationEmailConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASSWORD || "").trim();
  const from = String(process.env.SMTP_FROM || "").trim();
  if (host && port && user && pass && from) {
    return {
      mode: "smtp",
      host,
      port,
      secure: String(process.env.SMTP_SECURE || "").trim() === "true" || port === 465,
      user,
      pass,
      from
    };
  }
  if (isVerificationDebugEnabled()) {
    return { mode: "debug", from: "debug@local.test" };
  }
  return null;
}

function isVerificationDebugEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  const explicitSetting = String(process.env.EMAIL_VERIFICATION_DEBUG_CODES || "").trim().toLowerCase();
  if (explicitSetting === "true") return true;
  if (explicitSetting === "false") return false;
  return true;
}

async function loadEmailModule() {
  if (!emailModulePromise) {
    emailModulePromise = import("nodemailer").catch((error) => {
      console.error("Email dependency unavailable", { message: error?.message || String(error) });
      emailModulePromise = null;
      throw error;
    });
  }
  return emailModulePromise;
}

async function emailTransport() {
  const config = verificationEmailConfig();
  if (!config || config.mode !== "smtp") {
    throw new Error("Verification email is not configured.");
  }
  if (!emailTransportPromise) {
    emailTransportPromise = loadEmailModule().then((module) => module.default.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    }));
  }
  return emailTransportPromise;
}

export function acceptedVerificationDelivery(info, email) {
  const target = normalizeEmail(email);
  const accepted = Array.isArray(info?.accepted)
    ? info.accepted.map((entry) => normalizeEmail(entry)).filter(Boolean)
    : [];
  const rejected = Array.isArray(info?.rejected)
    ? info.rejected.map((entry) => normalizeEmail(entry)).filter(Boolean)
    : [];
  if (!accepted.length) return false;
  if (target && rejected.includes(target)) return false;
  if (!target) return accepted.length > 0;
  return accepted.includes(target) || accepted.length > 0;
}

export function drainVerificationDebugDeliveries() {
  const deliveries = [...verificationDebugDeliveries];
  verificationDebugDeliveries.length = 0;
  return deliveries;
}

async function deliverVerificationCode(user, email, code) {
  const config = verificationEmailConfig();
  if (!config) {
    throw new Error("Verification email is not configured.");
  }
  if (config.mode === "debug") {
    verificationDebugDeliveries.push({
      username: user.username,
      email,
      code
    });
    return { debugCode: code };
  }
  const transport = await emailTransport();
  const info = await transport.sendMail({
    from: config.from,
    to: email,
    subject: "Your Triumph Workspace verification code",
    text: `Your verification code is ${code}. It expires in ${Math.round(VERIFICATION_CODE_TTL_SECONDS / 60)} minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in ${Math.round(VERIFICATION_CODE_TTL_SECONDS / 60)} minutes.</p>`
  });
  if (!acceptedVerificationDelivery(info, email)) {
    const error = new Error("We couldn't deliver a verification email to this address. Please check the email address or contact support.");
    error.code = "VERIFICATION_DELIVERY_FAILED";
    error.deliveryInfo = {
      acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : 0,
      rejectedCount: Array.isArray(info?.rejected) ? info.rejected.length : 0
    };
    throw error;
  }
  return {
    messageId: info?.messageId || "",
    acceptedCount: Array.isArray(info?.accepted) ? info.accepted.length : 0
  };
}

function ensureUserSecurityDefaults(db) {
  let changed = false;
  db.users = Array.isArray(db.users) ? db.users : [];
  db.users.forEach((user) => {
    if (typeof user.email !== "string") {
      user.email = looksLikeEmail(user.username) ? normalizeEmail(user.username) : "";
      changed = true;
    }
    if (typeof user.mfaEnabled !== "boolean") {
      user.mfaEnabled = false;
      changed = true;
    }
    if (!Array.isArray(user.mfaRecoveryCodeHashes)) {
      user.mfaRecoveryCodeHashes = [];
      changed = true;
    }
    if (typeof user.mfaSecretEncrypted !== "string") {
      user.mfaSecretEncrypted = "";
      changed = true;
    }
    if (typeof user.mfaEnrolledAt !== "string") {
      user.mfaEnrolledAt = "";
      changed = true;
    }
    if (typeof user.lastLoginAt !== "string") {
      user.lastLoginAt = "";
      changed = true;
    }
  });
  return changed;
}

function authFailure(res, status, code, message, extra = {}) {
  if (status === 401) clearAuthCookie(res);
  sendJson(res, status, { code, errors: [message], ...extra });
}

function authServiceUnavailable(res) {
  sendJson(res, 503, {
    code: "AUTH_UNAVAILABLE",
    errors: ["Authentication is temporarily unavailable. Please try again shortly or contact support."]
  });
}

async function startVerificationChallenge(session, user, { isResend = false } = {}) {
  const email = userVerificationEmail(user);
  if (!email) {
    throw new Error("No verification email is configured for this account. Please contact your administrator.");
  }
  if (isResend && Number(session.verificationResendCount || 0) >= VERIFICATION_RESEND_LIMIT) {
    const error = new Error("Too many verification code requests. Please sign in again.");
    error.code = "VERIFICATION_RESEND_LIMIT";
    throw error;
  }
  const code = newVerificationCode();
  session.stage = "pending-mfa-verify";
  session.verificationEmail = email;
  session.verificationEmailMasked = maskEmail(email);
  session.verificationCodeHash = hashPassword(code);
  session.verificationCodeExpiresAt = Date.now() + (VERIFICATION_CODE_TTL_SECONDS * 1000);
  session.verificationAttemptCount = 0;
  session.verificationResendCount = isResend
    ? Number(session.verificationResendCount || 0) + 1
    : 0;
  const delivery = await deliverVerificationCode(user, email, code);
  return {
    mfaRequired: true,
    verificationRequired: true,
    setupRequired: false,
    deliveryMethod: "email",
    destinationMask: session.verificationEmailMasked,
    expiresInSeconds: VERIFICATION_CODE_TTL_SECONDS,
    user: publicUser(user),
    message: `We sent a verification code to ${session.verificationEmailMasked}.`
      + (isVerificationDebugEnabled() && delivery.debugCode ? ` Development code: ${delivery.debugCode}` : "")
  };
}

function isDatabaseTlsError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("self-signed certificate in certificate chain")
    || message.includes("unable to verify the first certificate")
    || message.includes("unable to get local issuer certificate")
    || message.includes("certificate has expired");
}

function createSessionRecord(userId, stage, extra = {}) {
  const now = Date.now();
  return {
    userId,
    createdAt: now,
    lastSeenAt: now,
    stage,
    ...extra
  };
}

function sanitizeRecoverableDrafts(payload = {}) {
  const intake = typeof payload.intake === "object" && payload.intake ? payload.intake : {};
  const session = typeof payload.session === "object" && payload.session ? payload.session : {};
  return {
    intake: structuredClone(intake),
    session: structuredClone(session),
    preservedAt: new Date().toISOString()
  };
}

function sessionStatus(req, db, { requireAuthenticatedMfa = true, touch = true } = {}) {
  const token = sessionToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session) return { status: "missing" };
  const user = (db.users || []).find((item) => item.id === session.userId && item.active !== false);
  if (!user) {
    sessions.delete(token);
    return { status: "invalid-user" };
  }
  const now = Date.now();
  const maxAgeSeconds = session.stage === "authenticated" ? SESSION_ABSOLUTE_TIMEOUT_SECONDS : MFA_PENDING_TIMEOUT_SECONDS;
  if (now - Number(session.createdAt || 0) > maxAgeSeconds * 1000) {
    sessions.delete(token);
    return { status: "expired", reason: "absolute", user };
  }
  if (session.stage === "authenticated" && now - Number(session.lastSeenAt || 0) > SESSION_INACTIVITY_TIMEOUT_SECONDS * 1000) {
    sessions.delete(token);
    return { status: "expired", reason: "inactive", user };
  }
  if (!mfaFeatureEnabled() && session.stage !== "authenticated") {
    session.stage = "authenticated";
    session.verifiedAt = session.verifiedAt || new Date().toISOString();
  }
  if (touch) session.lastSeenAt = now;
  if (!requireAuthenticatedMfa) {
    return { status: "ok", token, session, user };
  }
  if (session.stage === "pending-email-setup") {
    return { status: "mfa-setup-required", token, session, user };
  }
  if (session.stage === "pending-mfa-setup") {
    return { status: "mfa-setup-required", token, session, user };
  }
  if (session.stage !== "authenticated") {
    return { status: "mfa-required", token, session, user };
  }
  return { status: "ok", token, session, user };
}

function currentUser(req, db) {
  const state = sessionStatus(req, db);
  return state.status === "ok" ? state.user : null;
}

function isMasterAdmin(user) {
  return user?.role === "admin" && user?.isMasterAdmin === true;
}

function userAgency(user) {
  return normalizeAgency(user?.agency);
}

function sessionToken(req) {
  return parseCookies(req.headers.cookie || "").aba_session || "";
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [key, ...value] = part.trim().split("=");
    if (key) cookies[key] = decodeURIComponent(value.join("=") || "");
    return cookies;
  }, {});
}

function requireAuth(req, res, db, state = null) {
  state = state || sessionStatus(req, db);
  if (state.status === "ok") return true;
  if (state.status === "expired") {
    authFailure(res, 401, state.reason === "inactive" ? "SESSION_TIMEOUT" : "SESSION_EXPIRED", "Session expired. Please sign in again.");
    return false;
  }
  if (state.status === "mfa-setup-required") {
    authFailure(res, 401, "VERIFICATION_REQUIRED", "Email verification is required before accessing clinical data.");
    return false;
  }
  if (state.status === "mfa-required") {
    authFailure(res, 401, "VERIFICATION_REQUIRED", "Email verification is required before accessing clinical data.");
    return false;
  }
  authFailure(res, 401, "AUTH_REQUIRED", "Not signed in.");
  return false;
}

function requireRole(req, res, db, roles) {
  const state = sessionStatus(req, db);
  const user = state.status === "ok" ? state.user : null;
  if (!user) return requireAuth(req, res, db);
  if (!roles.includes(user.role)) {
    sendJson(res, 403, { errors: ["Your role cannot perform this action."] });
    return false;
  }
  return true;
}

function canAccessAgency(user, agency) {
  return Boolean(user) && (isMasterAdmin(user) || userAgency(user) === normalizeAgency(agency));
}

function canAccessClient(user, client) {
  return Boolean(client) && canAccessAgency(user, client.agency);
}

function visibleClients(db, user) {
  return isMasterAdmin(user)
    ? (db.clients || [])
    : (db.clients || []).filter((client) => canAccessClient(user, client));
}

function visibleSessions(db, user) {
  const clientIds = new Set(visibleClients(db, user).map((client) => client.id));
  return (db.sessions || []).filter((session) => clientIds.has(session.clientId));
}

function visibleUsers(db, user) {
  return isMasterAdmin(user)
    ? (db.users || [])
    : (db.users || []).filter((candidate) => !isMasterAdmin(candidate) && userAgency(candidate) === userAgency(user));
}

function visibleAuditLog(db, user) {
  if (isMasterAdmin(user)) return db.auditLog || [];
  const clientIds = new Set(visibleClients(db, user).map((client) => client.id));
  return (db.auditLog || []).filter((entry) => {
    if (entry.clientId) return clientIds.has(entry.clientId);
    return normalizeAgency(entry.agency) === userAgency(user);
  });
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: userVerificationEmail(user),
    name: user.name,
    role: user.role,
    agency: normalizeAgency(user.agency),
    isMasterAdmin: isMasterAdmin(user),
    active: user.active !== false,
    verificationMethod: "email",
    verificationRequired: requiresMfa(user),
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    passwordUpdatedAt: user.passwordUpdatedAt || "",
    lastLoginAt: user.lastLoginAt || ""
  };
}

function redactDb(db, user) {
  const { users, auditLog, ...publicDb } = db;
  return {
    ...publicDb,
    clients: visibleClients(db, user),
    sessions: visibleSessions(db, user)
  };
}

function practiceBackupPayload(db) {
  return {
    exportedAt: new Date().toISOString(),
    app: "ABA Practice MVP",
    version: 1,
    note: "This backup includes practice data and uploaded document metadata. Uploaded file contents remain in the local uploads folder; run npm run backup for a full local file backup.",
    data: {
      clients: db.clients || [],
      sessions: db.sessions || [],
      auditLog: db.auditLog || [],
      users: (db.users || []).map(publicUser)
    }
  };
}

function restorePracticeBackup(currentDb, backup) {
  if (!backup || backup.app !== "ABA Practice MVP" || !backup.data) {
    throw new Error("That file is not a valid ABA Practice MVP backup.");
  }
  const { clients, sessions, auditLog } = backup.data;
  if (!Array.isArray(clients) || !Array.isArray(sessions)) {
    throw new Error("Backup must include clients and sessions.");
  }
  return {
    ...currentDb,
    clients,
    sessions,
    auditLog: Array.isArray(auditLog) ? auditLog : [],
    users: currentDb.users || []
  };
}

function logAudit(db, req, user, action, options = {}) {
  db.auditLog = db.auditLog || [];
  const client = (db.clients || []).find((item) => item.id === options.clientId);
  db.auditLog.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId: user?.id || "",
    username: user?.username || "",
    userName: user?.name || "",
    role: user?.role || "",
    action: String(action || "event-recorded"),
    clientId: options.clientId || "",
    clientName: client?.name || "",
    agency: normalizeAgency(options.agency || client?.agency || user?.agency),
    details: cleanAuditDetails(options.details || {}),
    ip: req.socket.remoteAddress || ""
  });
  db.auditLog = db.auditLog.slice(0, 5000);
}

function cleanAuditDetails(details) {
  return Object.entries(details).reduce((clean, [key, value]) => {
    if (value === undefined || value === null) return clean;
    clean[key] = redactAuditValue(key, value);
    return clean;
  }, {});
}

function redactAuditValue(key, value) {
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(key, item));
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((nested, [nestedKey, nestedValue]) => {
      nested[nestedKey] = redactAuditValue(nestedKey, nestedValue);
      return nested;
    }, {});
  }
  if (/(note|soap|summary|recommendation|background|observation|medical)/i.test(String(key))) {
    return typeof value === "string" ? `[REDACTED ${String(value).length} chars]` : "[REDACTED]";
  }
  return value;
}

function userAuditSnapshot(user) {
  return {
    name: user.name || "",
    username: user.username || "",
    role: user.role || "",
    agency: normalizeAgency(user.agency),
    isMasterAdmin: isMasterAdmin(user),
    active: user.active !== false
  };
}

function clientProfileAuditSnapshot(client) {
  return {
    name: client.name || "",
    agency: normalizeAgency(client.agency),
    dob: client.dob || "",
    defaultSetting: client.defaultSetting || "",
    status: client.status || "active",
    caregivers: client.profile?.caregivers || "",
    school: client.profile?.school || "",
    diagnosis: client.profile?.diagnosis || "",
    communication: client.profile?.communication || "",
    notes: client.profile?.notes || "",
    authorization: {
      number: client.profile?.authorization?.number || "",
      funder: client.profile?.authorization?.funder || "",
      startDate: client.profile?.authorization?.startDate || "",
      endDate: client.profile?.authorization?.endDate || "",
      services: client.profile?.authorization?.services || {}
    },
    assessment: {
      type: client.profile?.assessment?.type || "",
      date: client.profile?.assessment?.date || "",
      conductedBy: client.profile?.assessment?.conductedBy || "",
      fileName: client.profile?.assessment?.fileName || ""
    }
  };
}

function documentAuditSnapshot(document) {
  return {
    id: document.id || "",
    type: document.type || "",
    date: document.date || "",
    fileName: document.fileName || "",
    notes: document.notes || "",
    url: document.url || ""
  };
}

function diffObjects(before, after, prefix = "") {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].flatMap((key) => {
    const beforeValue = before?.[key];
    const afterValue = after?.[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
      return diffObjects(beforeValue, afterValue, path);
    }
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return [];
    return [`${path}: ${auditScalar(beforeValue)} -> ${auditScalar(afterValue)}`];
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function auditScalar(value) {
  if (value === undefined || value === null || value === "") return "blank";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function soapNoteAuditSnapshot(session) {
  return {
    finalized: Boolean(session.finalized),
    noteLength: String(session.soapNote || "").length
  };
}

function treatmentPlanAuditSnapshot(client) {
  const programs = client.programs || [];
  const behaviors = client.behaviors || [];
  return {
    summary: {
      domains: (client.domains || []).length,
      programs: programs.length,
      targets: programs.reduce((sum, program) => sum + (program.targets || []).length, 0),
      behaviors: behaviors.length
    },
    programs: programs.map((program) => ({
      id: program.id,
      name: program.name,
      domain: program.domain,
      status: program.status || "active",
      objective: program.objective || "",
      targets: (program.targets || []).map((target) => ({
        id: target.id,
        name: target.name,
        status: target.status,
        maintenanceDate: target.maintenanceDate || ""
      }))
    })),
    behaviors: behaviors.map((behavior) => ({
      id: behavior.id,
      name: behavior.name,
      status: behavior.status
    }))
  };
}

function treatmentPlanChanges(before, after) {
  return {
    programsAdded: addedById(before.programs, after.programs).map((program) => program.name),
    programsRemoved: addedById(after.programs, before.programs).map((program) => program.name),
    programStatusChanges: programStatusChanges(before.programs, after.programs),
    targetsAdded: addedTargets(before.programs, after.programs),
    targetsRemoved: addedTargets(after.programs, before.programs),
    targetStatusChanges: targetStatusChanges(before.programs, after.programs),
    objectivesChanged: objectivesChanged(before.programs, after.programs),
    behaviorsAdded: addedById(before.behaviors, after.behaviors).map((behavior) => behavior.name),
    behaviorsRemoved: addedById(after.behaviors, before.behaviors).map((behavior) => behavior.name)
  };
}

function addedById(before, after) {
  const existing = new Set(before.map((item) => item.id));
  return after.filter((item) => !existing.has(item.id));
}

function addedTargets(beforePrograms, afterPrograms) {
  return afterPrograms.flatMap((afterProgram) => {
    const beforeProgram = beforePrograms.find((program) => program.id === afterProgram.id);
    const beforeTargets = beforeProgram?.targets || [];
    return addedById(beforeTargets, afterProgram.targets || []).map((target) => `${afterProgram.name}: ${target.name}`);
  });
}

function programStatusChanges(beforePrograms, afterPrograms) {
  return afterPrograms.flatMap((afterProgram) => {
    const beforeProgram = beforePrograms.find((program) => program.id === afterProgram.id);
    if (!beforeProgram || beforeProgram.status === afterProgram.status) return [];
    return [`${afterProgram.name} ${beforeProgram.status || "active"} -> ${afterProgram.status || "active"}`];
  });
}

function targetStatusChanges(beforePrograms, afterPrograms) {
  return afterPrograms.flatMap((afterProgram) => {
    const beforeProgram = beforePrograms.find((program) => program.id === afterProgram.id);
    if (!beforeProgram) return [];
    return (afterProgram.targets || []).flatMap((target) => {
      const beforeTarget = (beforeProgram.targets || []).find((item) => item.id === target.id);
      if (!beforeTarget || beforeTarget.status === target.status) return [];
      return [`${afterProgram.name}: ${target.name} ${beforeTarget.status} -> ${target.status}`];
    });
  });
}

function objectivesChanged(beforePrograms, afterPrograms) {
  return afterPrograms.flatMap((afterProgram) => {
    const beforeProgram = beforePrograms.find((program) => program.id === afterProgram.id);
    if (!beforeProgram || beforeProgram.objective === afterProgram.objective) return [];
    return [afterProgram.name];
  });
}

function createClientRecord(payload, existingClients, actor = null) {
  const name = text(payload.name);
  return {
    id: uniqueSlug(name, "client", existingClients.map((client) => client.id)),
    name,
    agency: isMasterAdmin(actor)
      ? normalizeAgency(payload.agency, actor?.agency)
      : normalizeAgency(actor?.agency || payload.agency),
    dob: text(payload.dob),
    defaultSetting: text(payload.defaultSetting) || "Clinic",
    status: "active",
    profile: sanitizeClientProfile(payload),
    domains: [
      "Functional Communication",
      "Visual Perceptual Skills",
      "Transition Tolerance",
      "Listener Responding"
    ],
    programs: [],
    behaviors: [],
    workflowBoard: defaultClinicalWorkflowBoard(),
    planChangeLog: [],
    note97151: "",
    note97155: "",
    note97151History: [],
    note97155History: [],
    rbtPerformanceAreas: [],
    createdAt: new Date().toISOString(),
    planUpdatedAt: ""
  };
}

function updateClientRecord(client, payload, actor = null) {
  client.name = text(payload.name);
  client.agency = canEditClientAgency(actor)
    ? normalizeAgency(payload.agency, client.agency)
    : normalizeAgency(client.agency);
  client.dob = text(payload.dob);
  client.defaultSetting = text(payload.defaultSetting) || "Clinic";
  client.status = payload.status === "archived" ? "archived" : "active";
  client.profile = {
    ...sanitizeClientProfile(payload),
    documents: client.profile?.documents || []
  };
  client.updatedAt = new Date().toISOString();
}

function canEditClientAgency(user) {
  return user?.role === "admin";
}

function sanitizeClientProfile(payload) {
  return {
    caregivers: text(payload.caregivers),
    school: text(payload.school),
    diagnosis: text(payload.diagnosis) || "Autism Spectrum Disorder",
    communication: text(payload.communication),
    notes: text(payload.profileNotes || payload.notes),
    authorization: {
      number: text(payload.authorizationNumber),
      funder: text(payload.funder),
      startDate: text(payload.authorizationStart),
      endDate: text(payload.authorizationEnd),
      notes: text(payload.authorizationNotes),
      services: {
        "97153": authorizationService(payload.auth97153Hours, payload.auth97153Units),
        "97155": authorizationService(payload.auth97155Hours, payload.auth97155Units),
        "97156": authorizationService(payload.auth97156Hours, payload.auth97156Units),
        "97151": authorizationService(payload.auth97151Hours, payload.auth97151Units)
      }
    },
    assessment: {
      type: text(payload.assessmentType),
      date: text(payload.assessmentDate),
      conductedBy: text(payload.assessmentConductedBy),
      fileName: text(payload.assessmentFileName),
      notes: text(payload.assessmentNotes)
    },
    funderReport: sanitizeFunderReport(payload.funderReport || {}),
    masteryCriteria: {
      thresholdPercent: sanitizeNumber(payload.masteryThresholdPercent, 90, 1, 100),
      consecutiveSessions: sanitizeNumber(payload.masteryConsecutiveSessions, 2, 1, 10),
      stagnantConsecutiveSessions: sanitizeNumber(payload.stagnantConsecutiveSessions, 3, 2, 10),
      stagnantMinimumGain: sanitizeNumber(payload.stagnantMinimumGain, 5, 1, 50)
    },
    parentTrainingGoals: sanitizeParentGoals(payload.parentTrainingGoals || []),
    intakeInterview: sanitizeIntakeInterview(payload.intakeInterview || {}),
    documents: Array.isArray(payload.documents) ? payload.documents : []
  };
}

function sanitizeFunderReport(payload) {
  const textField = (key) => text(payload[key]);
  const stringArray = (values) => Array.isArray(values) ? values.map((value) => text(value)).filter(Boolean) : [];
  const booleanMap = (values) => {
    if (!values || typeof values !== "object" || Array.isArray(values)) return {};
    return Object.entries(values).reduce((result, [key, value]) => {
      if (!key) return result;
      result[text(key)] = Boolean(value);
      return result;
    }, {});
  };
  const assessmentDocuments = (() => {
    const normalizeList = (values) => Array.isArray(values) ? values.reduce((result, item) => {
      const fileId = text(item?.fileId || item?.id);
      if (!fileId) return result;
      result.push({
        fileId,
        originalFileName: text(item?.originalFileName || item?.fileName),
        uploadedAt: text(item?.uploadedAt || item?.createdAt),
        fileSize: Number.isFinite(Number(item?.fileSize)) ? Math.max(0, Number(item.fileSize)) : 0,
        contentType: text(item?.contentType || item?.mimeType),
        storagePath: text(item?.storagePath || item?.relativePath || item?.s3Key),
        objectKey: text(item?.objectKey || item?.s3Key),
        clientId: text(item?.clientId),
        documentType: text(item?.documentType || item?.type)
      });
      return result;
    }, []) : [];
    return {
      assessmentGrid: normalizeList(payload.assessmentDocuments?.assessmentGrid),
      standardizedAssessmentGrid: normalizeList(payload.assessmentDocuments?.standardizedAssessmentGrid)
    };
  })();
  const customPhaseLines = (() => {
    const source = payload.customPhaseLines;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    return Object.entries(source).reduce((result, [graphKey, values]) => {
      const key = text(graphKey);
      if (!key || !Array.isArray(values)) return result;
      const lines = values.reduce((entries, line) => {
        const date = text(line?.date);
        const label = text(line?.label);
        if (!date || !label) return entries;
        entries.push({
          id: text(line?.id) || `${key}:${date}:${label.toLowerCase()}`,
          date,
          label,
          lineStyle: text(line?.lineStyle) === "solid" ? "solid" : "dashed",
          note: text(line?.note),
          phaseType: "environmentalChange"
        });
        return entries;
      }, []);
      if (lines.length) result[key] = lines;
      return result;
    }, {});
  })();
  return {
    metadata: {
      clientId: text(payload.metadata?.clientId || payload.clientId),
      reportingPeriod: {
        startDate: text(payload.metadata?.reportingPeriod?.startDate || payload.startDate),
        endDate: text(payload.metadata?.reportingPeriod?.endDate || payload.endDate)
      },
      draftStatus: text(payload.metadata?.draftStatus || "draft") || "draft",
      createdAt: text(payload.metadata?.createdAt),
      updatedAt: text(payload.metadata?.updatedAt),
      lastSavedAt: text(payload.metadata?.lastSavedAt)
    },
    startDate: textField("startDate"),
    endDate: textField("endDate"),
    preparedBy: textField("preparedBy"),
    credential: textField("credential"),
    background: textField("background"),
    medicalConcerns: textField("medicalConcerns"),
    reasonReferral: textField("reasonReferral"),
    impactBehaviors: textField("impactBehaviors"),
    familyStrengths: textField("familyStrengths"),
    initialObservations: textField("initialObservations"),
    indirectAssessmentType: textField("indirectAssessmentType"),
    assessmentConductedBy: textField("assessmentConductedBy"),
    assessmentDate: textField("assessmentDate"),
    behaviorSupportPlan: textField("behaviorSupportPlan"),
    standardizedAssessmentType: textField("standardizedAssessmentType"),
    standardizedConductedBy: textField("standardizedConductedBy"),
    standardizedAssessmentDate: textField("standardizedAssessmentDate"),
    progressSummary: textField("progressSummary"),
    parentTrainingSummary: textField("parentTrainingSummary"),
    parentTrainingRecommendations: textField("parentTrainingRecommendations"),
    instructionalGoalsInfo: textField("instructionalGoalsInfo"),
    generalizationMaintenance: textField("generalizationMaintenance"),
    barriersToTreatmentSummary: textField("barriersToTreatmentSummary"),
    dischargeCriteria: textField("dischargeCriteria"),
    dischargeMaladaptiveBehaviors: textField("dischargeMaladaptiveBehaviors"),
    dischargeCommunication: textField("dischargeCommunication"),
    dischargeSocialization: textField("dischargeSocialization"),
    dischargeAdaptive: textField("dischargeAdaptive"),
    dischargeExecutive: textField("dischargeExecutive"),
    recommendations: textField("recommendations"),
    medicalNecessity: textField("medicalNecessity"),
    includedContent: {
      programIds: stringArray(payload.includedContent?.programIds),
      targetIds: stringArray(payload.includedContent?.targetIds),
      behaviorIds: stringArray(payload.includedContent?.behaviorIds),
      parentTrainingGoalIds: stringArray(payload.includedContent?.parentTrainingGoalIds)
    },
    settings: {
      graphPreferences: booleanMap(payload.settings?.graphPreferences),
      displaySettings: {
        compactGraphAnalysis: payload.settings?.displaySettings?.compactGraphAnalysis !== false
      }
    },
    assessmentDocuments,
    customPhaseLines,
    editedGraphAnalysis: (() => {
      const source = payload.editedGraphAnalysis;
      if (!source || typeof source !== "object" || Array.isArray(source)) return {};
      return Object.entries(source).reduce((result, [key, value]) => {
        if (!key) return result;
        result[text(key)] = text(value);
        return result;
      }, {});
    })(),
    fadePlanRows: Array.isArray(payload.fadePlanRows) ? payload.fadePlanRows.map((row) => ({
      phase: text(row.phase),
      actionStep: text(row.actionStep),
      criteria: text(row.criteria),
      timeFrame: text(row.timeFrame),
      bcbaReduction: text(row.bcbaReduction),
      rbtReduction: text(row.rbtReduction)
    })) : [],
    serviceHours: Array.isArray(payload.serviceHours) ? payload.serviceHours.map((row) => ({
      serviceCode: text(row.serviceCode),
      provider: text(row.provider),
      hours: text(row.hours),
      setting: text(row.setting)
    })) : []
  };
}

function defaultClinicalWorkflowBoard() {
  return [
    workflowCard("initial-assessment", "Conduct initial assessment", "1 week", "Completed assessment", ["97151"], [
      "Conduct and document the initial assessment"
    ]),
    workflowCard("week-1-2", "Assessment setup and curriculum probing", "Week 1-2", "Integrity checklist, programs on Rethink", ["97155"], [
      "Establish rapport",
      "Select and administer developmental curriculum (VB-MAPP, ABLLS-R, AFLS)",
      "Probe and write skill acquisition programs",
      "Collect ABC data for behaviors identified during assessment"
    ]),
    workflowCard("week-3-4", "Early implementation and behavior plan drafting", "Week 3-4", "Integrity checklist, behavior plan draft", ["97155"], [
      "Continue implementing skill acquisition programs",
      "Complete grid of developmental curriculum",
      "Probe behavior reduction strategies appropriate to client's skills"
    ]),
    workflowCard("week-5-6", "Caregiver presentation and plan drafting", "Week 5-6", "Integrity checklist, behavior plan draft", ["97155", "97156"], [
      "Complete all items of session task list",
      "Present developmental curriculum grid to caregivers",
      "Draft and complete behavior reduction plan"
    ]),
    workflowCard("week-7", "Review behavior plan with caregivers", "Week 7", "Integrity checklist, behavior plan draft", ["97155", "97156"], [
      "Complete all items of session task list",
      "Meet with caregivers to review behavior plan and collect feedback"
    ]),
    workflowCard("week-8-9", "Finalize signed behavior plan", "Week 8-9", "Signed behavior plan", ["97155", "97156"], [
      "Complete all items of session task list",
      "Finalize behavior plan and present final draft to caregiver",
      "Collect caregiver signature"
    ]),
    workflowCard("week-10-17", "Ongoing integrity checks", "Week 10-17", "Integrity checklists", ["97155"], [
      "Complete all items of session task list"
    ]),
    workflowCard("week-18-20", "Prepare for 6-month reassessment", "Week 18-20", "Integrity checklists", ["97155", "97156"], [
      "Complete all items of session task list",
      "Send standardized curriculums to caregivers in preparation for 6 month reassessment"
    ]),
    workflowCard("week-20-22", "Complete reassessment", "Week 20-22", "Completed reassessment", ["97151"], [
      "Complete and submit reassessment"
    ])
  ];
}

function workflowCard(id, title, timeline, deliverable, cptCodes, checklist) {
  return {
    id,
    title,
    timeline,
    deliverable,
    cptCodes,
    status: "todo",
    notes: "",
    checklist: checklist.map((label, index) => ({
      id: `${id}-item-${index + 1}`,
      label,
      done: false
    }))
  };
}

function sanitizeWorkflowBoard(board) {
  return (Array.isArray(board) && board.length ? board : defaultClinicalWorkflowBoard()).map((card, cardIndex) => ({
    id: text(card.id) || `workflow-card-${cardIndex + 1}`,
    title: text(card.title) || "Workflow task",
    timeline: text(card.timeline),
    deliverable: text(card.deliverable),
    cptCodes: (Array.isArray(card.cptCodes) ? card.cptCodes : [])
      .map((code) => text(code))
      .filter(Boolean),
    status: ["todo", "in-progress", "done"].includes(card.status) ? card.status : "todo",
    notes: text(card.notes),
    checklist: (Array.isArray(card.checklist) ? card.checklist : []).map((item, itemIndex) => ({
      id: text(item.id) || `${text(card.id) || `workflow-card-${cardIndex + 1}`}-item-${itemIndex + 1}`,
      label: text(item.label) || `Checklist item ${itemIndex + 1}`,
      done: Boolean(item.done)
    }))
  }));
}

function authorizationService(hours, units) {
  return {
    hours: text(hours),
    units: text(units)
  };
}

function sanitizeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function sanitizeIntakeInterview(interview) {
  return {
    interviewDate: text(interview.interviewDate),
    interviewedBy: text(interview.interviewedBy),
    autismDiagnosis: text(interview.autismDiagnosis),
    diagnosisSourceDate: text(interview.diagnosisSourceDate),
    priorEvaluations: text(interview.priorEvaluations),
    recentCdeDate: text(interview.recentCdeDate),
    vbMappLevel: text(interview.vbMappLevel),
    caregiversPresent: text(interview.caregiversPresent),
    householdMembers: text(interview.householdMembers),
    primaryCaregivers: text(interview.primaryCaregivers),
    pregnancyBirthComplications: text(interview.pregnancyBirthComplications),
    milestones: text(interview.milestones),
    earlyDevelopmentNotes: text(interview.earlyDevelopmentNotes),
    communicationMethod: text(interview.communicationMethod),
    strengths: text(interview.strengths),
    concerningBehaviors: text(interview.concerningBehaviors),
    behaviorDescription: text(interview.behaviorDescription),
    behaviorWhen: text(interview.behaviorWhen),
    behaviorTriggers: text(interview.behaviorTriggers),
    behaviorAfter: text(interview.behaviorAfter),
    behaviorResponse: text(interview.behaviorResponse),
    topPriorityBehavior: text(interview.topPriorityBehavior),
    currentServices: text(interview.currentServices),
    serviceFrequency: text(interview.serviceFrequency),
    serviceProgress: text(interview.serviceProgress),
    schoolAttendance: text(interview.schoolAttendance),
    schoolSetting: text(interview.schoolSetting),
    teacherConcerns: text(interview.teacherConcerns),
    peerInteraction: text(interview.peerInteraction),
    schoolChallenges: text(interview.schoolChallenges),
    previousAba: text(interview.previousAba),
    previousAbaDetails: text(interview.previousAbaDetails),
    previousAbaFocus: text(interview.previousAbaFocus),
    previousAbaEnded: text(interview.previousAbaEnded),
    medicalHistory: text(interview.medicalHistory),
    seizuresAllergiesMedications: text(interview.seizuresAllergiesMedications),
    sleepQuality: text(interview.sleepQuality),
    feedingConcerns: text(interview.feedingConcerns),
    painTolerance: text(interview.painTolerance),
    level1Manding: text(interview.level1Manding),
    level1Listener: text(interview.level1Listener),
    level1Imitation: text(interview.level1Imitation),
    level1Play: text(interview.level1Play),
    level1Social: text(interview.level1Social),
    level2Manding: text(interview.level2Manding),
    level2Tacting: text(interview.level2Tacting),
    level2Listener: text(interview.level2Listener),
    level2Intraverbals: text(interview.level2Intraverbals),
    level2Play: text(interview.level2Play),
    level2Social: text(interview.level2Social),
    level3Manding: text(interview.level3Manding),
    level3Tacting: text(interview.level3Tacting),
    level3Intraverbals: text(interview.level3Intraverbals),
    level3Listener: text(interview.level3Listener),
    level3PlaySocial: text(interview.level3PlaySocial),
    level3SchoolReadiness: text(interview.level3SchoolReadiness),
    preferredInterests: text(interview.preferredInterests),
    interviewNotes: text(interview.interviewNotes)
  };
}

async function saveClientDocument(client, payload) {
  const fileName = text(payload.fileName);
  const dataUrl = text(payload.dataUrl);
  if (!fileName || !dataUrl) {
    throw new Error("Document file is required.");
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Document upload could not be read.");
  }
  const id = crypto.randomUUID();
  const type = documentType(payload.documentType);
  const extension = safeExtension(fileName);
  const storedName = `${id}${extension}`;
  const body = Buffer.from(match[2], "base64");
  const mimeType = text(payload.mimeType) || match[1];
  const fileSize = Number.isFinite(Number(payload.fileSize)) ? Math.max(0, Number(payload.fileSize)) : body.length;
  const key = `${client.id}/${type}/${storedName}`;
  let relativePath = join("uploads", client.id, type, storedName);
  let s3Key = "";

  if (documentStore === "s3") {
    const { putS3Object } = await import("./lib/s3-storage.mjs");
    await putS3Object(s3Config(), {
      key,
      body,
      contentType: mimeType
    });
    relativePath = "";
    s3Key = key;
  } else {
    const clientDir = join(uploadsDir, client.id, type);
    await mkdir(clientDir, { recursive: true });
    await writeFile(join(clientDir, storedName), body);
  }

  client.profile = client.profile || {};
  client.profile.documents = client.profile.documents || [];
  const document = {
    id,
    type,
    date: text(payload.documentDate),
    notes: text(payload.notes),
    fileName,
    mimeType,
    contentType: mimeType,
    fileSize,
    relativePath,
    s3Key,
    storage: documentStore,
    url: `/uploads/${key.split("/").map(encodeURIComponent).join("/")}`,
    createdAt: new Date().toISOString(),
    uploadedAt: new Date().toISOString()
  };
  client.profile.documents.unshift(document);
  client.updatedAt = new Date().toISOString();
  return document;
}

function documentType(type) {
  return [
    "authorization",
    "standardized-assessment",
    "fba-assessment",
    "behavior-support-plan",
    "funder-report",
    "other"
  ].includes(type) ? type : "other";
}

function safeExtension(fileName) {
  const extension = extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension || ".bin";
}

function uniqueSlug(value, fallback, existingIds) {
  const base = text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
  let candidate = base;
  let index = 2;
  while (existingIds.includes(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function text(value) {
  return String(value || "").trim();
}

function sanitizePrograms(programs) {
  return programs.map((program) => ({
    id: String(program.id),
    name: String(program.name || "Program"),
    domain: String(program.domain || "General"),
    status: ["active", "maintenance", "mastered", "paused"].includes(program.status) ? program.status : "active",
    objective: String(program.objective || ""),
    targets: (program.targets || []).map((target) => ({
      id: String(target.id),
      name: String(target.name || "Target"),
      status: ["active", "maintenance", "mastered", "paused"].includes(target.status) ? target.status : "active",
      dateAdded: target.dateAdded || "",
      maintenanceDate: target.maintenanceDate || "",
      note: target.note || ""
    }))
  }));
}

function sanitizeDomains(domains) {
  return [...new Set(domains.map((domain) => String(domain || "").trim()).filter(Boolean))];
}

function sanitizeBehaviors(behaviors) {
  return behaviors.map((behavior) => ({
    id: String(behavior.id),
    name: String(behavior.name || "Behavior"),
    status: behavior.status === "inactive" ? "inactive" : "active"
  }));
}

function sanitizeParentGoals(goals) {
  return goals
    .map((goal) => {
      const opportunities = Number(goal.opportunities || 0);
      const independent = Number(goal.independent || 0);
      const prompted = Number(goal.prompted || 0);
      const denominator = opportunities || independent + prompted;
      return {
        goalName: String(goal.goalName || "").trim(),
        targetName: String(goal.targetName || "").trim(),
        opportunities,
        independent,
        prompted,
        promptLevel: String(goal.promptLevel || "verbal"),
        fidelity: denominator > 0 ? Math.round((independent / denominator) * 100) : 0
      };
    })
    .filter((goal) => goal.goalName && goal.targetName);
}

function sanitizeRbtPerformanceAreas(areas) {
  return areas
    .map((area) => ({
      id: String(area.id || crypto.randomUUID()),
      label: String(area.label || "").trim()
    }))
    .filter((area) => area.label);
}

function sanitizePlanChangeLog(changes) {
  return changes.map((change) => ({
    id: String(change.id || crypto.randomUUID()),
    date: String(change.date || new Date().toISOString().slice(0, 10)),
    timestamp: String(change.timestamp || new Date().toISOString()),
    type: String(change.type || "plan-updated"),
    domain: String(change.domain || ""),
    programId: String(change.programId || ""),
    programName: String(change.programName || ""),
    targetId: String(change.targetId || ""),
    targetName: String(change.targetName || ""),
    fromStatus: String(change.fromStatus || ""),
    toStatus: String(change.toStatus || "")
  }));
}

function sanitizeNoteHistoryEntries(entries, serviceCode) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id || crypto.randomUUID()),
      serviceCode,
      note: String(entry.note || "").trim(),
      date: String(entry.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      createdAt: String(entry.createdAt || new Date().toISOString()),
      updatedAt: String(entry.updatedAt || entry.createdAt || new Date().toISOString()),
      providerSignature: String(entry.providerSignature || ""),
      providerCredential: String(entry.providerCredential || ""),
      startTime: String(entry.startTime || ""),
      endTime: String(entry.endTime || ""),
      setting: String(entry.setting || ""),
      activityLabel: String(entry.activityLabel || "")
    }))
    .filter((entry) => entry.note)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function createNoteHistoryEntry(serviceCode, note, metadata = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    serviceCode,
    note: String(note || "").trim(),
    date: String(metadata.date || now.slice(0, 10)).slice(0, 10),
    createdAt: String(metadata.createdAt || now),
    updatedAt: String(metadata.updatedAt || now),
    providerSignature: String(metadata.providerSignature || ""),
    providerCredential: String(metadata.providerCredential || ""),
    startTime: String(metadata.startTime || ""),
    endTime: String(metadata.endTime || ""),
    setting: String(metadata.setting || ""),
    activityLabel: String(metadata.activityLabel || "")
  };
}

function ensureClientNoteHistories(db) {
  let changed = false;
  db.clients = Array.isArray(db.clients) ? db.clients : [];
  db.clients.forEach((client) => {
    const legacy97151 = String(client.note97151 || "").trim();
    const legacy97155 = String(client.note97155 || "").trim();
    let note97151History = sanitizeNoteHistoryEntries(client.note97151History || [], "97151");
    let note97155History = sanitizeNoteHistoryEntries(client.note97155History || [], "97155");
    if (legacy97151 && !note97151History.some((entry) => entry.note === legacy97151)) {
      note97151History = [
        createNoteHistoryEntry("97151", legacy97151, {
          date: client.profile?.assessment?.date || client.planUpdatedAt || client.updatedAt || client.createdAt
        }),
        ...note97151History
      ];
      changed = true;
    }
    if (legacy97155 && !note97155History.some((entry) => entry.note === legacy97155)) {
      note97155History = [
        createNoteHistoryEntry("97155", legacy97155, {
          date: client.planUpdatedAt || client.updatedAt || client.createdAt
        }),
        ...note97155History
      ];
      changed = true;
    }
    const latest97151 = note97151History[0]?.note || "";
    const latest97155 = note97155History[0]?.note || "";
    if (!Array.isArray(client.note97151History) || JSON.stringify(client.note97151History) !== JSON.stringify(note97151History)) {
      client.note97151History = note97151History;
      changed = true;
    }
    if (!Array.isArray(client.note97155History) || JSON.stringify(client.note97155History) !== JSON.stringify(note97155History)) {
      client.note97155History = note97155History;
      changed = true;
    }
    if (String(client.note97151 || "") !== latest97151) {
      client.note97151 = latest97151;
      changed = true;
    }
    if (String(client.note97155 || "") !== latest97155) {
      client.note97155 = latest97155;
      changed = true;
    }
  });
  return changed;
}
