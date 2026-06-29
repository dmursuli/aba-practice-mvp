import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceArgs = args.filter((arg) => !arg.startsWith("--"));

if (!sourceArgs.length) {
  console.error("Usage: node scripts/recover-note-history.mjs [--dry-run] <source-backup.json> [more-backups.json]");
  process.exit(1);
}

const targetPath = resolve("data/db.json");
const targetDb = JSON.parse(await readFile(targetPath, "utf8"));
const summary = [];

for (const sourceArg of sourceArgs) {
  const sourcePath = resolve(sourceArg);
  const sourceRaw = JSON.parse(await readFile(sourcePath, "utf8"));
  const sourceDb = sourceRaw?.data?.clients ? sourceRaw.data : sourceRaw;
  if (!Array.isArray(sourceDb.clients)) {
    throw new Error(`Source file is not a recognized backup/db file: ${sourceArg}`);
  }

  for (const sourceClient of sourceDb.clients) {
    const targetClient = findMatchingClient(targetDb.clients || [], sourceClient);
    if (!targetClient) continue;

    const before97155 = (targetClient.note97155History || []).length;
    const before97151 = (targetClient.note97151History || []).length;

    targetClient.note97155History = mergeNoteHistory(targetClient.note97155History || [], extractSourceEntries(sourceClient, "97155"));
    targetClient.note97151History = mergeNoteHistory(targetClient.note97151History || [], extractSourceEntries(sourceClient, "97151"));

    if (!String(targetClient.note97155 || "").trim() && targetClient.note97155History.length) {
      targetClient.note97155 = targetClient.note97155History[0].note;
    }
    if (!String(targetClient.note97151 || "").trim() && targetClient.note97151History.length) {
      targetClient.note97151 = targetClient.note97151History[0].note;
    }

    const added97155 = targetClient.note97155History.length - before97155;
    const added97151 = targetClient.note97151History.length - before97151;
    if (added97155 || added97151) {
      summary.push({
        client: targetClient.name,
        source: sourceArg,
        added97155,
        added97151
      });
    }
  }
}

if (!dryRun) {
  await writeFile(targetPath, `${JSON.stringify(targetDb, null, 2)}\n`);
}

if (!summary.length) {
  console.log("No recoverable 97155/97151 note history entries were found.");
  process.exit(0);
}

console.log(dryRun ? "Dry run summary:" : "Recovered note history:");
for (const item of summary) {
  console.log(
    `${item.client} <- ${item.source}: +${item.added97155} 97155, +${item.added97151} 97151`
  );
}

function findMatchingClient(targetClients, sourceClient) {
  return targetClients.find((client) => client.id === sourceClient.id)
    || targetClients.find((client) => normalize(client.name) === normalize(sourceClient.name));
}

function extractSourceEntries(client, serviceCode) {
  const field = serviceCode === "97155" ? "note97155" : "note97151";
  const historyField = `${field}History`;
  const entries = [];
  for (const entry of client[historyField] || []) {
    if (String(entry?.note || "").trim()) {
      entries.push(normalizeEntry(entry, serviceCode));
    }
  }
  if (String(client[field] || "").trim()) {
    entries.push(normalizeEntry({
      id: `legacy-${serviceCode}-${client.id || slugify(client.name || "client")}`,
      note: client[field],
      date: client.planUpdatedAt || client.updatedAt || client.createdAt || "",
      createdAt: client.planUpdatedAt || client.updatedAt || client.createdAt || "",
      activityLabel: serviceCode === "97155" ? "Treatment planning / protocol modification" : "Behavior assessment / report update"
    }, serviceCode));
  }
  return entries;
}

function mergeNoteHistory(existing, recovered) {
  const merged = [...existing.map((entry) => normalizeEntry(entry, entry.serviceCode || inferServiceCode(entry)))];
  for (const entry of recovered) {
    const alreadyExists = merged.some((candidate) => sameNote(candidate, entry));
    if (!alreadyExists) {
      merged.push(entry);
    }
  }
  return merged.sort(compareEntriesDesc);
}

function normalizeEntry(entry, serviceCode) {
  const note = String(entry?.note || "").trim();
  return {
    id: String(entry?.id || `${serviceCode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    serviceCode,
    note,
    date: String(entry?.date || entry?.createdAt || "").slice(0, 10),
    createdAt: String(entry?.createdAt || entry?.date || ""),
    providerSignature: String(entry?.providerSignature || ""),
    providerCredential: String(entry?.providerCredential || ""),
    startTime: String(entry?.startTime || ""),
    endTime: String(entry?.endTime || ""),
    activityLabel: String(entry?.activityLabel || (serviceCode === "97155" ? "Treatment planning / protocol modification" : "Behavior assessment / report update"))
  };
}

function inferServiceCode(entry) {
  return String(entry?.serviceCode || "").includes("97151") ? "97151" : "97155";
}

function sameNote(a, b) {
  return normalize(a.note) === normalize(b.note)
    && normalize(a.date) === normalize(b.date)
    && normalize(a.providerSignature) === normalize(b.providerSignature);
}

function compareEntriesDesc(a, b) {
  const aKey = `${a.date || ""}T${a.startTime || ""}|${a.createdAt || ""}`;
  const bKey = `${b.date || ""}T${b.startTime || ""}|${b.createdAt || ""}`;
  return bKey.localeCompare(aKey);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
