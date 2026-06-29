import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

const [backupArg, clientArg = "Patrick Delgado"] = process.argv.slice(2);

if (!backupArg) {
  console.error("Usage: node scripts/reconstruct-97155-from-audit.mjs <backup.json> [client name]");
  process.exit(1);
}

const backupPath = resolve(backupArg);
const backupRaw = JSON.parse(await readFile(backupPath, "utf8"));
const db = backupRaw.data || backupRaw;
if (!Array.isArray(db.clients) || !Array.isArray(db.auditLog)) {
  throw new Error("Backup file is missing expected clients/auditLog data.");
}

const client = db.clients.find((item) => normalize(item.name) === normalize(clientArg));
if (!client) {
  throw new Error(`Client not found in backup: ${clientArg}`);
}

const allSessions = (db.sessions || []).filter((session) => session.clientId === client.id);
const existingHistory = Array.isArray(client.note97155History) ? structuredClone(client.note97155History) : [];
const existingDates = new Set(existingHistory.map((entry) => String(entry.date || "").slice(0, 10)).filter(Boolean));

const groupedAudit = groupAuditByDate((db.auditLog || []).filter((event) => (
  event.action === "treatment-plan-updated"
  && event.clientId === client.id
)));

const reconstructedEntries = [];
const reportSections = [];

for (const [date, events] of [...groupedAudit.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const changeLines = flattenChangeLines(events);
  const relatedSessions = allSessions.filter((session) => session.date === date);
  const hasStrongEvidence = changeLines.length > 0;
  const alreadyHasEntry = existingDates.has(date);

  reportSections.push(renderReportSection({ date, events, changeLines, relatedSessions, alreadyHasEntry, hasStrongEvidence }));

  if (!hasStrongEvidence || alreadyHasEntry) continue;

  reconstructedEntries.push({
    id: `reconstructed-97155-${client.id}-${date}`,
    serviceCode: "97155",
    note: renderReconstructedNote({
      clientName: client.name,
      date,
      events,
      changeLines,
      relatedSessions
    }),
    date,
    createdAt: latestTimestamp(events),
    updatedAt: latestTimestamp(events),
    providerSignature: "Reconstructed from audit trail",
    providerCredential: "",
    startTime: "",
    endTime: "",
    setting: relatedSessions[0]?.setting || "",
    activityLabel: "RECONSTRUCTED from audit trail"
  });
}

client.note97155History = [...existingHistory, ...reconstructedEntries].sort(compareEntriesDesc);
if (client.note97155History[0]?.note) {
  client.note97155 = client.note97155History[0].note;
}

const outputPath = join(
  dirname(backupPath),
  `${basename(backupPath, extname(backupPath))}-reconstructed-97155${extname(backupPath)}`
);
await writeFile(outputPath, `${JSON.stringify(backupRaw, null, 2)}\n`);

const reportPath = join(
  dirname(backupPath),
  `${basename(backupPath, extname(backupPath))}-reconstructed-97155-report.md`
);
await writeFile(reportPath, buildReport({
  clientName: client.name,
  outputPath,
  reconstructedEntries,
  reportSections
}));

console.log(JSON.stringify({
  client: client.name,
  reconstructedEntries: reconstructedEntries.length,
  outputPath,
  reportPath,
  dates: reconstructedEntries.map((entry) => entry.date)
}, null, 2));

function groupAuditByDate(events) {
  const map = new Map();
  for (const event of events) {
    const date = String(event.timestamp || "").slice(0, 10);
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(event);
  }
  return map;
}

function flattenChangeLines(events) {
  const lines = [];
  for (const event of events) {
    const changes = event.details?.changes || {};
    pushChangeLines(lines, "Program added", changes.programsAdded);
    pushChangeLines(lines, "Target added", changes.targetsAdded);
    pushChangeLines(lines, "Program status", changes.programStatusChanges);
    pushChangeLines(lines, "Target status", changes.targetStatusChanges);
    pushChangeLines(lines, "Objective updated", changes.objectivesChanged);
    pushChangeLines(lines, "Behavior added", changes.behaviorsAdded);
    pushChangeLines(lines, "Behavior removed", changes.behaviorsRemoved);
  }
  return [...new Set(lines)];
}

function pushChangeLines(lines, label, values) {
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    if (normalized) lines.push(`${label}: ${normalized}`);
  }
}

function renderReconstructedNote({ clientName, date, events, changeLines, relatedSessions }) {
  const sameDaySessions = relatedSessions.length
    ? relatedSessions.map((session) => {
        const code = session.serviceType === "parent-training" ? "97156" : "97153";
        return `${code} ${session.startTime || ""}-${session.endTime || ""} ${session.setting || ""}`.trim();
      }).join("; ")
    : "No same-day 97153/97156 session in the backup.";

  const topChanges = changeLines.slice(0, 18).map((line) => `- ${line}`).join("\n");

  return [
    `[RECONSTRUCTED FROM AUDIT TRAIL]`,
    ``,
    `S: A reconstructed 97155 treatment planning / protocol modification entry was generated for ${clientName} on ${formatDate(date)}. This entry was reconstructed on ${formatDate(new Date().toISOString().slice(0, 10))} from treatment-plan audit events because the original contemporaneous 97155 narrative was not preserved in the prior storage model.`,
    ``,
    `O: Audit evidence shows ${events.length} treatment-plan update event(s) on ${formatDate(date)}.${changeLines.length ? ` Documented changes included:\n${topChanges}` : " No specific treatment-plan deltas were captured in the preserved audit details."}`,
    ``,
    `A: The preserved audit trail supports that protocol-modification / treatment-planning work occurred on this date and altered the client’s plan. This note is reconstructed support documentation and is not the original preserved 97155 narrative.`,
    ``,
    `P: Use this entry alongside the audit log and related same-day clinical activity for record support. Related same-day sessions in backup: ${sameDaySessions}.`
  ].join("\n");
}

function renderReportSection({ date, events, changeLines, relatedSessions, alreadyHasEntry, hasStrongEvidence }) {
  return [
    `## ${date}`,
    ``,
    `- Audit events: ${events.length}`,
    `- Same-day sessions: ${relatedSessions.length ? relatedSessions.map((session) => `${session.serviceType === "parent-training" ? "97156" : "97153"} ${session.startTime}-${session.endTime}`).join(", ") : "none in backup"}`,
    `- Existing 97155 entry already present: ${alreadyHasEntry ? "yes" : "no"}`,
    `- Strong reconstruction evidence: ${hasStrongEvidence ? "yes" : "no"}`,
    ``,
    ...(changeLines.length ? changeLines.map((line) => `- ${line}`) : ["- No preserved change details"]),
    ``
  ].join("\n");
}

function buildReport({ clientName, outputPath, reconstructedEntries, reportSections }) {
  return [
    `# Reconstructed 97155 Timeline`,
    ``,
    `Client: ${clientName}`,
    `Generated: ${new Date().toISOString()}`,
    `Output backup: ${outputPath}`,
    `Reconstructed entries added: ${reconstructedEntries.length}`,
    ``,
    `These entries were reconstructed from preserved treatment-plan audit events and related session context. They are not the original contemporaneous 97155 note text.`,
    ``,
    ...reportSections
  ].join("\n");
}

function latestTimestamp(events) {
  return [...events]
    .map((event) => String(event.timestamp || ""))
    .sort()
    .at(-1) || new Date().toISOString();
}

function compareEntriesDesc(a, b) {
  const aKey = `${a.date || ""}T${a.startTime || ""}|${a.updatedAt || a.createdAt || ""}`;
  const bKey = `${b.date || ""}T${b.startTime || ""}|${b.updatedAt || b.createdAt || ""}`;
  return bKey.localeCompare(aKey);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return "unknown date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
