import { createServer } from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const uploadsDir = join(root, "uploads");
const dbPath = join(dataDir, "db.json");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const dataStore = process.env.DATA_STORE || (process.env.DB_HOST || process.env.DATABASE_URL ? "postgres" : "json");
const documentStore = process.env.DOCUMENT_STORE || (process.env.S3_BUCKET ? "s3" : "local");
const sessions = new Map();

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
  if (ensureDefaultUsers(db)) await writeDb(db);
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

function postgresConfig(Pool) {
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
    caCert: process.env.DB_CA_CERT || ""
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
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("set-cookie", `aba_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
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

  const targetKeys = new Set();
  programs.forEach((program) => {
    const planProgram = client?.programs?.find((item) => item.id === program.programId);
    if (!planProgram) errors.push("Program is not in this client's treatment plan.");
    program.targets.forEach((target) => {
      const planTarget = planProgram?.targets?.find((item) => item.id === target.targetId);
      if (!planTarget) errors.push("Target is not in this client's treatment plan.");
      const key = `${program.programId}:${target.targetId}`;
      if (targetKeys.has(key)) {
        errors.push("Each target can only appear once per session.");
      }
      targetKeys.add(key);
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

  const behaviorKeys = new Set();
  behaviors.forEach((behavior) => {
    if (behaviorKeys.has(behavior.behaviorId)) {
      errors.push("Each behavior can only appear once per session.");
    }
    behaviorKeys.add(behavior.behaviorId);
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
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function serveUpload(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname.replace(/^\/uploads\/?/, ""));
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");

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
      res.writeHead(200, {
        "content-type": object.ContentType || contentTypes[extname(safePath)] || "application/octet-stream",
        "cache-control": "private, max-age=300"
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
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const db = await readDbWithUsers();
      const payload = await readBody(req);
      const username = String(payload.username || "").trim().toLowerCase();
      const user = (db.users || []).find((item) => item.username === username && item.active !== false);
      if (!user || !verifyPassword(String(payload.password || ""), user.passwordHash)) {
        sendJson(res, 401, { errors: ["Invalid username or password."] });
        return;
      }
      const token = crypto.randomUUID();
      sessions.set(token, { userId: user.id, createdAt: Date.now() });
      sendAuthCookie(res, token);
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = sessionToken(req);
      if (token) sessions.delete(token);
      clearAuthCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const db = await readDbWithUsers();
      const user = currentUser(req, db);
      if (!user) {
        sendJson(res, 401, { errors: ["Not signed in."] });
        return;
      }
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/data") {
      const db = await readDbWithUsers();
      if (!requireAuth(req, res, db)) return;
      sendJson(res, 200, redactDb(db));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/backup") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const user = currentUser(req, db);
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
      sendJson(res, 200, redactDb(restoredDb));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba"])) return;
      sendJson(res, 200, { auditLog: db.auditLog || [] });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      sendJson(res, 200, { users: (db.users || []).map(publicUser) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const payload = await readBody(req);
      const user = createUserRecord(payload, db.users || []);
      db.users.push(user);
      logAudit(db, req, currentUser(req, db), "user-created", {
        details: { username: user.username, role: user.role }
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
      const targetUser = (db.users || []).find((item) => item.id === userMatch[1]);
      if (!targetUser) {
        sendJson(res, 404, { errors: ["User not found."] });
        return;
      }
      const before = userAuditSnapshot(targetUser);
      updateUserRecord(targetUser, payload);
      logAudit(db, req, currentUser(req, db), payload.password ? "user-password-reset" : "user-updated", {
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
      await serveUpload(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/clients") {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const payload = await readBody(req);
      const name = String(payload.name || "").trim();
      if (!name) {
        sendJson(res, 400, { errors: ["Client name is required."] });
        return;
      }
      const client = createClientRecord(payload, db.clients || []);
      db.clients.push(client);
      logAudit(db, req, currentUser(req, db), "client-created", {
        clientId: client.id,
        details: { name: client.name }
      });
      await writeDb(db);
      sendJson(res, 201, client);
      return;
    }

    const profileMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/profile$/);
    if (req.method === "PUT" && profileMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const payload = await readBody(req);
      const client = db.clients.find((item) => item.id === profileMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      const name = String(payload.name || "").trim();
      if (!name) {
        sendJson(res, 400, { errors: ["Client name is required."] });
        return;
      }
      const before = clientProfileAuditSnapshot(client);
      updateClientRecord(client, payload);
      const after = clientProfileAuditSnapshot(client);
      logAudit(db, req, currentUser(req, db), "client-profile-updated", {
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

    const documentCollectionMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/documents$/);
    if (req.method === "POST" && documentCollectionMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin"])) return;
      const payload = await readBody(req);
      const client = db.clients.find((item) => item.id === documentCollectionMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      const document = await saveClientDocument(client, payload);
      logAudit(db, req, currentUser(req, db), "document-uploaded", {
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
      if (!requireRole(req, res, db, ["admin"])) return;
      const client = db.clients.find((item) => item.id === documentMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
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
      logAudit(db, req, currentUser(req, db), "document-deleted", {
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
      const client = db.clients.find((item) => item.id === planMatch[1]);
      if (!client) {
        sendJson(res, 404, { errors: ["Client not found."] });
        return;
      }
      const before = treatmentPlanAuditSnapshot(client);
      client.domains = sanitizeDomains(payload.domains || client.domains || []);
      client.programs = sanitizePrograms(payload.programs || client.programs || []);
      client.behaviors = sanitizeBehaviors(payload.behaviors || client.behaviors || []);
      client.rbtPerformanceAreas = sanitizeRbtPerformanceAreas(payload.rbtPerformanceAreas || client.rbtPerformanceAreas || []);
      client.planChangeLog = sanitizePlanChangeLog(payload.planChangeLog || client.planChangeLog || []);
      client.note97155 = String(payload.note97155 ?? client.note97155 ?? "");
      client.planUpdatedAt = new Date().toISOString();
      const after = treatmentPlanAuditSnapshot(client);
      logAudit(db, req, currentUser(req, db), "treatment-plan-updated", {
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
      const session = db.sessions.find((item) => item.id === sessionMatch[1]);
      const originalLength = db.sessions.length;
      db.sessions = db.sessions.filter((item) => item.id !== sessionMatch[1]);
      if (db.sessions.length === originalLength) {
        sendJson(res, 404, { errors: ["Session not found."] });
        return;
      }
      logAudit(db, req, currentUser(req, db), "session-deleted", {
        clientId: session?.clientId,
        details: { serviceType: session?.serviceType || "97153", date: session?.date || "" }
      });
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }

    const noteMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/note$/);
    if (req.method === "PUT" && noteMatch) {
      const db = await readDbWithUsers();
      if (!requireRole(req, res, db, ["admin", "bcba", "rbt"])) return;
      const payload = await readBody(req);
      const session = db.sessions.find((item) => item.id === noteMatch[1]);
      if (!session) {
        sendJson(res, 404, { errors: ["Session not found."] });
        return;
      }
      const before = soapNoteAuditSnapshot(session);
      session.soapNote = String(payload.soapNote || "");
      session.finalized = Boolean(payload.finalized);
      session.updatedAt = new Date().toISOString();
      logAudit(db, req, currentUser(req, db), session.finalized ? "soap-note-finalized" : "soap-note-updated", {
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
    sendJson(res, 500, { errors: [error.message || "Unexpected server error."] });
  }
});

server.listen(port, host, () => {
  console.log(`ABA practice MVP running at http://localhost:${port}`);
});

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
  return {
    id: `user-${username}`,
    username,
    name,
    role,
    passwordHash: hashPassword(password),
    active: true,
    createdAt: new Date().toISOString()
  };
}

function createUserRecord(payload, existingUsers) {
  const username = String(payload.username || "").trim().toLowerCase();
  const name = text(payload.name);
  const password = String(payload.password || "");
  const role = validRole(payload.role);
  if (!username) throw new Error("Username is required.");
  if (!name) throw new Error("Name is required.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (existingUsers.some((user) => user.username === username)) {
    throw new Error("That username already exists.");
  }
  return {
    id: `user-${uniqueSlug(username, "user", existingUsers.map((user) => user.id))}`,
    username,
    name,
    role,
    passwordHash: hashPassword(password),
    active: true,
    createdAt: new Date().toISOString()
  };
}

function updateUserRecord(user, payload) {
  const name = text(payload.name);
  if (!name) throw new Error("Name is required.");
  user.name = name;
  user.role = validRole(payload.role);
  user.active = Boolean(payload.active);
  if (payload.password) {
    const password = String(payload.password);
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
    user.passwordHash = hashPassword(password);
    user.passwordUpdatedAt = new Date().toISOString();
  }
  user.updatedAt = new Date().toISOString();
}

function validRole(role) {
  return ["admin", "bcba", "rbt", "read-only"].includes(role) ? role : "rbt";
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

function currentUser(req, db) {
  const token = sessionToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  const user = (db.users || []).find((item) => item.id === session.userId && item.active !== false);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  return user;
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

function requireAuth(req, res, db) {
  if (currentUser(req, db)) return true;
  sendJson(res, 401, { errors: ["Not signed in."] });
  return false;
}

function requireRole(req, res, db, roles) {
  const user = currentUser(req, db);
  if (!user) {
    sendJson(res, 401, { errors: ["Not signed in."] });
    return false;
  }
  if (!roles.includes(user.role)) {
    sendJson(res, 403, { errors: ["Your role cannot perform this action."] });
    return false;
  }
  return true;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active !== false,
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    passwordUpdatedAt: user.passwordUpdatedAt || ""
  };
}

function redactDb(db) {
  const { users, auditLog, ...publicDb } = db;
  return publicDb;
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
    details: cleanAuditDetails(options.details || {}),
    ip: req.socket.remoteAddress || ""
  });
  db.auditLog = db.auditLog.slice(0, 5000);
}

function cleanAuditDetails(details) {
  return Object.entries(details).reduce((clean, [key, value]) => {
    if (value === undefined || value === null) return clean;
    clean[key] = value;
    return clean;
  }, {});
}

function userAuditSnapshot(user) {
  return {
    name: user.name || "",
    username: user.username || "",
    role: user.role || "",
    active: user.active !== false
  };
}

function clientProfileAuditSnapshot(client) {
  return {
    name: client.name || "",
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
    noteLength: String(session.soapNote || "").length,
    notePreview: String(session.soapNote || "").slice(0, 180)
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

function createClientRecord(payload, existingClients) {
  const name = text(payload.name);
  return {
    id: uniqueSlug(name, "client", existingClients.map((client) => client.id)),
    name,
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
    planChangeLog: [],
    note97155: "",
    rbtPerformanceAreas: [],
    createdAt: new Date().toISOString(),
    planUpdatedAt: ""
  };
}

function updateClientRecord(client, payload) {
  client.name = text(payload.name);
  client.dob = text(payload.dob);
  client.defaultSetting = text(payload.defaultSetting) || "Clinic";
  client.status = payload.status === "archived" ? "archived" : "active";
  client.profile = {
    ...sanitizeClientProfile(payload),
    documents: client.profile?.documents || []
  };
  client.updatedAt = new Date().toISOString();
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
    parentTrainingGoals: sanitizeParentGoals(payload.parentTrainingGoals || []),
    intakeInterview: sanitizeIntakeInterview(payload.intakeInterview || {}),
    documents: Array.isArray(payload.documents) ? payload.documents : []
  };
}

function authorizationService(hours, units) {
  return {
    hours: text(hours),
    units: text(units)
  };
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
    relativePath,
    s3Key,
    storage: documentStore,
    url: `/uploads/${key.split("/").map(encodeURIComponent).join("/")}`,
    createdAt: new Date().toISOString()
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
