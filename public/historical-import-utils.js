function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeText(value = "") {
  return cleanText(value).toLowerCase();
}

const DATE_HEADERS = new Set(["date", "sessiondate"]);
const VALUE_HEADERS = new Set(["value", "frequency", "count", "occurrences", "data", "duration", "rate", "percentage", "fidelity"]);
const NOTES_HEADERS = new Set(["notes", "note"]);
const SETTING_HEADERS = new Set(["setting", "location"]);
const PHASE_HEADERS = new Set(["phase"]);
const DENOMINATOR_HEADERS = new Set(["denominator", "trials", "opportunities"]);

export function normalizeHistoricalImportDataType(value = "") {
  const normalized = normalizeText(value).replace(/[\s-]+/g, "_");
  if (["skill", "skills", "skill_acquisition", "skillacquisition"].includes(normalized)) return "skill";
  if (["behavior", "behaviors", "behavior_reduction", "behaviorreduction"].includes(normalized)) return "behavior";
  if (["caregiver_training", "caregiver", "parent_training", "parent"].includes(normalized)) return "caregiver_training";
  return "";
}

export function normalizeHistoricalMeasurementType(value = "", dataType = "") {
  const normalized = normalizeText(value).replace(/[\s-]+/g, "_");
  const type = normalizeHistoricalImportDataType(dataType);
  if (type === "skill") {
    if (["percentage", "percent", "independence"].includes(normalized)) return "percentage";
  }
  if (type === "behavior") {
    if (["frequency", "count", "occurrences", "value", "data"].includes(normalized)) return "frequency";
    if (["duration"].includes(normalized)) return "duration";
    if (["rate"].includes(normalized)) return "rate";
    if (["percentage", "percent"].includes(normalized)) return "percentage";
  }
  if (type === "caregiver_training") {
    if (["fidelity", "percentage", "percent"].includes(normalized)) return "fidelity";
  }
  return "";
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeHistoricalImportDate(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const parsed = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) return iso;
  }
  return "";
}

function isFutureDate(value, today = new Date()) {
  const iso = normalizeHistoricalImportDate(value);
  if (!iso) return false;
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const baseline = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parsed.getTime() > baseline.getTime();
}

function isValidDate(value) {
  return Boolean(normalizeHistoricalImportDate(value));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function buildHistoricalImportCsvTemplate(dataType = "skill") {
  const normalizedType = normalizeHistoricalImportDataType(dataType) || "skill";
  const behaviorHeader = {
    frequency: "Frequency",
    duration: "Duration",
    rate: "Rate",
    percentage: "Percentage"
  };
  const sample = {
    skill: {
      header: ["Date", "Value", "Notes"],
      row: ["3/15/2024", "80", "Historical independence percentage"]
    },
    behavior: {
      header: ["Date", behaviorHeader.frequency, "Notes"],
      row: ["3/15/2024", "18", "Historical paper frequency"]
    },
    caregiver_training: {
      header: ["Date", "Fidelity", "Notes"],
      row: ["3/15/2024", "75", "Caregiver implementation fidelity"]
    }
  }[normalizedType];
  return `${sample.header.map(csvEscape).join(",")}\n${sample.row.map(csvEscape).join(",")}\n`;
}

export function parseHistoricalImportCsv(text = "") {
  const rows = [];
  const source = String(text || "");
  let current = "";
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\"") {
      if (insideQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (char === "," && !insideQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  const filtered = rows.filter((entry) => entry.some((cell) => cleanText(cell)));
  if (!filtered.length) return [];
  const [headerRow, ...dataRows] = filtered;
  const headers = headerRow.map((value) => normalizeText(value).replace(/[\s-]+/g, ""));
  const dateIndex = headers.findIndex((header) => DATE_HEADERS.has(header));
  const recognizedValueIndex = headers.findIndex((header) => VALUE_HEADERS.has(header));
  const valueIndex = dateIndex === 0 && headers.length === 2
    ? 1
    : recognizedValueIndex >= 0
      ? recognizedValueIndex
      : dateIndex >= 0 && headers.length >= 2
        ? headers.findIndex((_, index) => index !== dateIndex)
        : -1;
  const notesIndex = headers.findIndex((header) => NOTES_HEADERS.has(header));
  const settingIndex = headers.findIndex((header) => SETTING_HEADERS.has(header));
  const phaseIndex = headers.findIndex((header) => PHASE_HEADERS.has(header));
  const denominatorIndex = headers.findIndex((header) => DENOMINATOR_HEADERS.has(header));
  const inferredMeasurementHeader = valueIndex >= 0 ? headers[valueIndex] : "";
  return dataRows.map((cells, index) => ({
    __rowNumber: index + 2,
    date: cleanText(cells[dateIndex] || ""),
    value: cleanText(cells[valueIndex] || ""),
    notes: cleanText(cells[notesIndex] || ""),
    setting: cleanText(cells[settingIndex] || ""),
    phase: cleanText(cells[phaseIndex] || ""),
    denominator: cleanText(cells[denominatorIndex] || ""),
    inferredMeasurementHeader
  }));
}

function skillLookupMaps(client) {
  const programs = Array.isArray(client?.programs) ? client.programs : [];
  const byTargetId = new Map();
  const byComposite = new Map();
  programs.forEach((program) => {
    const domain = cleanText(program?.domain || "General");
    (program?.targets || []).forEach((target) => {
      const resolved = {
        programId: String(program.id),
        programName: cleanText(program.name || "Program"),
        domain,
        targetId: String(target.id),
        targetName: cleanText(target.name || "Target")
      };
      byTargetId.set(resolved.targetId, resolved);
      const compositeKeys = [
        [domain, resolved.programName, resolved.targetName].map(normalizeText).join("::"),
        ["", resolved.programName, resolved.targetName].map(normalizeText).join("::"),
        [domain, "", resolved.targetName].map(normalizeText).join("::"),
        ["", "", resolved.targetName].map(normalizeText).join("::")
      ];
      compositeKeys.forEach((key) => {
        if (!key.replace(/:/g, "")) return;
        const bucket = byComposite.get(key) || [];
        bucket.push(resolved);
        byComposite.set(key, bucket);
      });
    });
  });
  return { byTargetId, byComposite };
}

function behaviorLookupMaps(client) {
  const behaviors = Array.isArray(client?.behaviors) ? client.behaviors : [];
  const byId = new Map();
  const byName = new Map();
  behaviors.forEach((behavior) => {
    const resolved = {
      behaviorId: String(behavior.id),
      behaviorName: cleanText(behavior.name || "Behavior")
    };
    byId.set(resolved.behaviorId, resolved);
    const key = normalizeText(resolved.behaviorName);
    const bucket = byName.get(key) || [];
    bucket.push(resolved);
    byName.set(key, bucket);
  });
  return { byId, byName };
}

function caregiverLookupMaps(client) {
  const goals = Array.isArray(client?.profile?.parentTrainingGoals) ? client.profile.parentTrainingGoals : [];
  const byComposite = new Map();
  goals.forEach((goal) => {
    const resolved = {
      goalName: cleanText(goal.goalName || ""),
      targetName: cleanText(goal.targetName || "")
    };
    const key = [normalizeText(resolved.goalName), normalizeText(resolved.targetName)].join("::");
    if (key === "::") return;
    byComposite.set(key, resolved);
  });
  return { byComposite };
}

function resolveSkillReference(row, client) {
  const { byTargetId, byComposite } = skillLookupMaps(client);
  const explicitTargetId = cleanText(row.targetId || row.targetid);
  if (explicitTargetId && byTargetId.has(explicitTargetId)) return byTargetId.get(explicitTargetId);
  const domain = cleanText(row.domain);
  const goal = cleanText(row.goal);
  const target = cleanText(row.target);
  const candidates = byComposite.get([domain, goal, target].map(normalizeText).join("::"))
    || byComposite.get(["", goal, target].map(normalizeText).join("::"))
    || byComposite.get([domain, "", target].map(normalizeText).join("::"))
    || byComposite.get(["", "", target].map(normalizeText).join("::"))
    || [];
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveBehaviorReference(row, client) {
  const { byId, byName } = behaviorLookupMaps(client);
  const explicitBehaviorId = cleanText(row.targetId || row.targetid);
  if (explicitBehaviorId && byId.has(explicitBehaviorId)) return byId.get(explicitBehaviorId);
  const label = cleanText(row.target || row.goal);
  const candidates = byName.get(normalizeText(label)) || [];
  return candidates.length === 1 ? candidates[0] : null;
}

function resolveCaregiverReference(row, client) {
  const { byComposite } = caregiverLookupMaps(client);
  const goalName = cleanText(row.goal);
  const targetName = cleanText(row.target);
  return byComposite.get([normalizeText(goalName), normalizeText(targetName)].join("::")) || null;
}

function entryIdentityFromSession(session, dataType, item) {
  if (dataType === "skill") {
    return {
      dataType,
      id: String(item?.targetId || ""),
      measurementType: cleanText(item?.historicalImportMeasurementType || "percentage"),
      date: cleanText(session?.date),
      sessionId: String(session?.id || "")
    };
  }
  if (dataType === "behavior") {
    return {
      dataType,
      id: String(item?.behaviorId || ""),
      measurementType: cleanText(item?.historicalImportMeasurementType || "frequency"),
      date: cleanText(session?.date),
      sessionId: String(session?.id || "")
    };
  }
  return {
    dataType,
    id: [normalizeText(item?.goalName), normalizeText(item?.targetName)].join("::"),
    measurementType: cleanText(item?.historicalImportMeasurementType || "fidelity"),
    date: cleanText(session?.date),
    sessionId: String(session?.id || "")
  };
}

export function historicalImportDuplicateKey({ clientId = "", dataType = "", itemId = "", date = "", measurementType = "" } = {}) {
  return [
    cleanText(clientId),
    normalizeHistoricalImportDataType(dataType),
    cleanText(itemId),
    cleanText(date),
    cleanText(measurementType),
    "historical_import"
  ].join("::");
}

export function buildHistoricalImportDuplicateMap(clientId, sessions = []) {
  const duplicates = new Map();
  (sessions || []).forEach((session) => {
    const source = cleanText(session?.source || session?.historicalImport?.source);
    if (source !== "historical_import") return;
    (session?.programs || []).forEach((program) => {
      (program?.targets || []).forEach((target) => {
        const identity = entryIdentityFromSession(session, "skill", target);
        const key = historicalImportDuplicateKey({
          clientId,
          dataType: "skill",
          itemId: identity.id,
          date: identity.date,
          measurementType: identity.measurementType
        });
        duplicates.set(key, { sessionId: identity.sessionId, dataType: "skill", entry: target });
      });
    });
    (session?.behaviors || []).forEach((behavior) => {
      const identity = entryIdentityFromSession(session, "behavior", behavior);
      const key = historicalImportDuplicateKey({
        clientId,
        dataType: "behavior",
        itemId: identity.id,
        date: identity.date,
        measurementType: identity.measurementType
      });
      duplicates.set(key, { sessionId: identity.sessionId, dataType: "behavior", entry: behavior });
    });
    (session?.parentGoals || []).forEach((goal) => {
      const identity = entryIdentityFromSession(session, "caregiver_training", goal);
      const key = historicalImportDuplicateKey({
        clientId,
        dataType: "caregiver_training",
        itemId: identity.id,
        date: identity.date,
        measurementType: identity.measurementType
      });
      duplicates.set(key, { sessionId: identity.sessionId, dataType: "caregiver_training", entry: goal });
    });
  });
  return duplicates;
}

function normalizedPhase(value = "") {
  return normalizeText(value) === "baseline" ? "baseline" : "intervention";
}

function resolveImportReference(row, client, dataType, selectedReference = null) {
  if (selectedReference) {
    if (dataType === "behavior") {
      const { byId } = behaviorLookupMaps(client);
      const explicitBehaviorId = cleanText(selectedReference.behaviorId || selectedReference.id);
      if (explicitBehaviorId && byId.has(explicitBehaviorId)) return byId.get(explicitBehaviorId);
      if (selectedReference.behaviorId && selectedReference.behaviorName) return selectedReference;
    }
    if (dataType === "skill") {
      const { byTargetId } = skillLookupMaps(client);
      const explicitTargetId = cleanText(selectedReference.targetId || selectedReference.id);
      if (explicitTargetId && byTargetId.has(explicitTargetId)) return byTargetId.get(explicitTargetId);
      if (selectedReference.programId && selectedReference.targetId) return selectedReference;
    }
    if (dataType === "caregiver_training") {
      const { byComposite } = caregiverLookupMaps(client);
      const goalName = cleanText(selectedReference.goalName || selectedReference.goal);
      const targetName = cleanText(selectedReference.targetName || selectedReference.target);
      const composite = [normalizeText(goalName), normalizeText(targetName)].join("::");
      if (byComposite.has(composite)) return byComposite.get(composite);
      if (goalName && targetName) return { goalName, targetName };
    }
  }
  if (dataType === "skill") return resolveSkillReference(row, client);
  if (dataType === "behavior") return resolveBehaviorReference(row, client);
  return resolveCaregiverReference(row, client);
}

function itemIdentifierForResolved(dataType, resolved) {
  if (dataType === "skill") return resolved?.targetId || "";
  if (dataType === "behavior") return resolved?.behaviorId || "";
  return [normalizeText(resolved?.goalName), normalizeText(resolved?.targetName)].join("::");
}

function buildCommitShape(dataType, resolved, row, value, denominator) {
  if (dataType === "skill") {
    const safeDenominator = Number(denominator || 10);
    const correct = Math.max(0, Math.min(safeDenominator, Math.round((Number(value) / 100) * safeDenominator)));
    return {
      dataType,
      date: cleanText(row.date),
      setting: cleanText(row.setting) || "Historical import",
      phase: normalizedPhase(row.phase),
      measurementType: "percentage",
      value: Number(value),
      denominator: safeDenominator,
      notes: cleanText(row.notes),
      programId: resolved.programId,
      programName: resolved.programName,
      domain: resolved.domain,
      targetId: resolved.targetId,
      targetName: resolved.targetName,
      trials: safeDenominator,
      correct,
      incorrect: Math.max(safeDenominator - correct, 0)
    };
  }
  if (dataType === "behavior") {
    return {
      dataType,
      date: cleanText(row.date),
      setting: cleanText(row.setting) || "Historical import",
      phase: normalizedPhase(row.phase),
      measurementType: cleanText(row.measurementType || "frequency"),
      value: Number(value),
      notes: cleanText(row.notes),
      behaviorId: resolved.behaviorId,
      behaviorName: resolved.behaviorName,
      frequency: Number(value)
    };
  }
  const safeDenominator = Number(denominator || 10);
  const independent = Math.max(0, Math.min(safeDenominator, Math.round((Number(value) / 100) * safeDenominator)));
  return {
    dataType,
    date: cleanText(row.date),
    setting: cleanText(row.setting) || "Historical import",
    phase: normalizedPhase(row.phase),
    measurementType: "fidelity",
    value: Number(value),
    denominator: safeDenominator,
    notes: cleanText(row.notes),
    goalName: resolved.goalName,
    targetName: resolved.targetName,
    opportunities: safeDenominator,
    independent,
    prompted: Math.max(safeDenominator - independent, 0)
  };
}

export function validateHistoricalImportRows({
  client,
  sessions = [],
  dataType = "",
  measurementType = "",
  selectedReference = null,
  rows = [],
  duplicateStrategy = "skip",
  today = new Date()
} = {}) {
  const normalizedType = normalizeHistoricalImportDataType(dataType);
  const duplicateMap = buildHistoricalImportDuplicateMap(client?.id, sessions);
  const batchKeys = new Set();
  const previewRows = (rows || []).map((rawRow, index) => {
    const row = {
      date: normalizeHistoricalImportDate(rawRow.date),
      dataType: normalizeHistoricalImportDataType(rawRow.dataType || normalizedType || dataType) || normalizedType,
      domain: cleanText(rawRow.domain),
      goal: cleanText(rawRow.goal),
      target: cleanText(rawRow.target),
      targetId: cleanText(rawRow.targetId || rawRow.targetid),
      measurementType: normalizeHistoricalMeasurementType(
        rawRow.measurementType || rawRow.measurementtype || measurementType || rawRow.inferredMeasurementHeader,
        normalizedType
      ),
      value: rawRow.value,
      denominator: rawRow.denominator,
      phase: cleanText(rawRow.phase),
      setting: cleanText(rawRow.setting),
      notes: cleanText(rawRow.notes),
      rowNumber: Number(rawRow.rowNumber || rawRow.__rowNumber || index + 1)
    };
    const errors = [];
    const warnings = [];
    if (!row.dataType) errors.push("Data type is required.");
    if (!isValidDate(rawRow.date || row.date)) errors.push("Enter a valid date.");
    if (row.date && isFutureDate(row.date, today)) warnings.push("Date is in the future. Review before importing.");
    if (!row.measurementType) {
      errors.push(normalizedType === "behavior"
        ? "Select a supported behavior measurement type."
        : normalizedType === "caregiver_training"
          ? "Caregiver-training historical imports currently support fidelity values."
          : "Skill historical imports currently support percentage / independence values.");
    }
    const numericValue = parseNumber(row.value);
    if (numericValue === null) errors.push("Missing value.");
    const denominator = parseNumber(row.denominator);
    if (normalizedType === "skill" || normalizedType === "caregiver_training") {
      if (numericValue !== null && (numericValue < 0 || numericValue > 100)) {
        errors.push("Percentage / fidelity values must be between 0 and 100.");
      }
      if (denominator !== null && denominator <= 0) errors.push("Denominator must be greater than 0 when provided.");
    }
    if (normalizedType === "behavior" && numericValue !== null) {
      if (numericValue < 0) errors.push("Behavior values must be 0 or greater.");
      if (row.measurementType === "percentage" && numericValue > 100) {
        errors.push("Behavior percentage values must be between 0 and 100.");
      }
    }
    const resolved = resolveImportReference(row, client, normalizedType, selectedReference);
    if (!resolved) {
      errors.push(
        normalizedType === "behavior"
          ? "Select the behavior graph you want to import into."
          : normalizedType === "caregiver_training"
            ? "Select the caregiver-training goal you want to import into."
            : "Select the skill target you want to import into."
      );
    }
    const itemId = itemIdentifierForResolved(normalizedType, resolved);
    const duplicateKey = historicalImportDuplicateKey({
      clientId: client?.id,
      dataType: normalizedType,
      itemId,
      date: row.date,
      measurementType: row.measurementType
    });
    const existingDuplicate = duplicateMap.get(duplicateKey) || null;
    const inBatchDuplicate = batchKeys.has(duplicateKey);
    if (inBatchDuplicate) {
      warnings.push("This batch contains another row for the same item, date, and measurement type.");
    }
    batchKeys.add(duplicateKey);
    if (existingDuplicate) {
      warnings.push("A historical import already exists for this item and date.");
    }
    let commitAction = "create";
    if (existingDuplicate) {
      if (duplicateStrategy === "replace" || duplicateStrategy === "update") commitAction = "update";
      else if (duplicateStrategy === "cancel") {
        commitAction = "cancel";
        errors.push("Duplicate found. Choose Skip duplicates or Replace duplicates to continue.");
      }
      else commitAction = "skip";
    }
    const commitShape = !errors.length && resolved && numericValue !== null
      ? buildCommitShape(normalizedType, resolved, row, numericValue, denominator)
      : null;
    return {
      rowNumber: row.rowNumber,
      dataType: normalizedType,
      raw: row,
      resolved,
      errors,
      warnings,
      duplicateKey,
      existingDuplicate,
      commitAction,
      commitShape
    };
  });

  const validRows = previewRows.filter((row) => !row.errors.length);
  return {
    rows: previewRows,
    summary: {
      totalRows: previewRows.length,
      validRows: validRows.length,
      errorRows: previewRows.filter((row) => row.errors.length).length,
      warningRows: previewRows.filter((row) => row.warnings.length).length,
      duplicateRows: previewRows.filter((row) => row.existingDuplicate).length,
      importableRows: previewRows.filter((row) => !row.errors.length && !["skip", "cancel"].includes(row.commitAction)).length,
      skippedRows: previewRows.filter((row) => row.commitAction === "skip").length
    }
  };
}
