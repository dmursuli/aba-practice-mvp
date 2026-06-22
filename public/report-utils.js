function formatMetricValue(value, graphType) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  if (typeof value === "number") {
    return graphType === "behavior" ? `${value}` : `${value}%`;
  }
  return String(value);
}

export function buildCompactGraphAnalysisSentence(entry, graphType) {
  if (!entry) return "";
  const metrics = [
    `Baseline: ${formatMetricValue(entry.baselineLevel, graphType)}`,
    `Treatment: ${formatMetricValue(entry.treatmentLevel ?? entry.treatmentAverage, graphType)}`,
    graphType === "behavior"
      ? `Reduction: ${entry.percentReduction || "Unavailable"}`
      : `Change: ${formatMetricValue(entry.difference, graphType)}${entry.percentChange && !String(entry.percentChange).includes("unavailable") ? ` (${entry.percentChange})` : ""}`,
    `Trend: ${entry.trendDirection || "Unavailable"}`
  ];
  return `${metrics.join(". ")}. ${String(entry.interpretation || "").trim()}`.replace(/\s+/g, " ").trim();
}

export function parseNumberedObjectives(source = "") {
  const text = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const matches = [...text.matchAll(/(?:^|[\n\s])(\d+)\.\s+(?=[A-Z"\[])/g)];
  if (!matches.length) {
    return [text.replace(/\s+/g, " ").trim()].filter(Boolean);
  }

  return matches.map((match, index) => {
    const numberToken = `${match[1]}.`;
    const numberIndex = match.index + match[0].lastIndexOf(numberToken);
    const contentStart = numberIndex + numberToken.length;
    const nextMatch = matches[index + 1];
    const nextIndex = nextMatch
      ? nextMatch.index + nextMatch[0].lastIndexOf(`${nextMatch[1]}.`)
      : text.length;
    return text
      .slice(contentStart, nextIndex)
      .replace(/\s+/g, " ")
      .trim();
  }).filter(Boolean);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObjectKeys(value[key]);
    return result;
  }, {});
}

export function sanitizeTrendVisibilityMap(source = {}, allowedKeys = []) {
  const allowed = new Set((allowedKeys || []).filter(Boolean));
  return Object.entries(source || {}).reduce((result, [key, value]) => {
    if (allowed.has(key)) result[key] = Boolean(value);
    return result;
  }, {});
}

function sanitizeText(value) {
  return String(value || "").trim();
}

export function sanitizeAssessmentDocumentRefs(source = {}) {
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return [];
    return value.reduce((result, item) => {
      const fileId = sanitizeText(item?.fileId || item?.id);
      if (!fileId) return result;
      result.push({
        fileId,
        originalFileName: sanitizeText(item?.originalFileName || item?.fileName),
        uploadedAt: sanitizeText(item?.uploadedAt || item?.createdAt),
        fileSize: Number.isFinite(Number(item?.fileSize)) ? Math.max(0, Number(item.fileSize)) : 0,
        contentType: sanitizeText(item?.contentType || item?.mimeType),
        storagePath: sanitizeText(item?.storagePath || item?.relativePath || item?.s3Key),
        objectKey: sanitizeText(item?.objectKey || item?.s3Key),
        clientId: sanitizeText(item?.clientId),
        documentType: sanitizeText(item?.documentType || item?.type)
      });
      return result;
    }, []);
  };

  return {
    assessmentGrid: normalizeList(source.assessmentGrid),
    standardizedAssessmentGrid: normalizeList(source.standardizedAssessmentGrid)
  };
}

export function sanitizeCustomPhaseLines(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.entries(source).reduce((result, [graphKey, lines]) => {
    const key = sanitizeText(graphKey);
    if (!key || !Array.isArray(lines)) return result;
    const normalized = lines.reduce((entries, line) => {
      const date = sanitizeText(line?.date);
      const label = sanitizeText(line?.label);
      if (!date || !label) return entries;
      entries.push({
        id: sanitizeText(line?.id) || `${key}:${date}:${label.toLowerCase()}`,
        date,
        label,
        lineStyle: sanitizeText(line?.lineStyle) === "solid" ? "solid" : "dashed",
        note: sanitizeText(line?.note),
        phaseType: "environmentalChange"
      });
      return entries;
    }, []);
    if (normalized.length) {
      result[key] = normalized.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
    }
    return result;
  }, {});
}

export function buildFunderDraftRecord({
  clientId = "",
  startDate = "",
  endDate = "",
  sections = {},
  fadePlanRows = [],
  serviceHours = [],
  graphPreferences = {},
  includedContent = {},
  displaySettings = {},
  editedGraphAnalysis = {},
  assessmentDocuments = {},
  customPhaseLines = {},
  existingDraft = {},
  now = new Date().toISOString()
} = {}) {
  const previousCreatedAt = existingDraft?.metadata?.createdAt || existingDraft?.createdAt || now;
  return {
    metadata: {
      clientId: String(clientId || ""),
      reportingPeriod: {
        startDate: String(startDate || ""),
        endDate: String(endDate || "")
      },
      draftStatus: "draft",
      createdAt: previousCreatedAt,
      updatedAt: now,
      lastSavedAt: now
    },
    startDate: String(startDate || ""),
    endDate: String(endDate || ""),
    ...sections,
    fadePlanRows: Array.isArray(fadePlanRows) ? fadePlanRows : [],
    serviceHours: Array.isArray(serviceHours) ? serviceHours : [],
    includedContent: {
      programIds: Array.isArray(includedContent.programIds) ? includedContent.programIds : [],
      targetIds: Array.isArray(includedContent.targetIds) ? includedContent.targetIds : [],
      behaviorIds: Array.isArray(includedContent.behaviorIds) ? includedContent.behaviorIds : [],
      parentTrainingGoalIds: Array.isArray(includedContent.parentTrainingGoalIds) ? includedContent.parentTrainingGoalIds : []
    },
    settings: {
      graphPreferences: sortObjectKeys(graphPreferences),
      displaySettings: sortObjectKeys(displaySettings)
    },
    editedGraphAnalysis: sortObjectKeys(editedGraphAnalysis),
    assessmentDocuments: sortObjectKeys(sanitizeAssessmentDocumentRefs(assessmentDocuments)),
    customPhaseLines: sortObjectKeys(sanitizeCustomPhaseLines(customPhaseLines))
  };
}

export function estimateJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value || {})).length;
}

export function draftContainsLargeArtifacts(draft = {}) {
  const serialized = JSON.stringify(draft || {}).toLowerCase();
  return serialized.includes("data:application/pdf")
    || serialized.includes("data:image/")
    || serialized.includes("<html")
    || serialized.includes("<section class=\"report-document\"")
    || serialized.includes("base64,");
}

export function hasMeaningfulFunderReportDraft(draft = {}) {
  if (!draft || typeof draft !== "object") return false;
  const sections = Object.fromEntries(Object.entries(draft).filter(([key]) => !["metadata", "includedContent", "settings", "editedGraphAnalysis"].includes(key)));
  return Object.entries(sections).some(([key, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (key === "assessmentDocuments") {
      return Object.values(sanitizeAssessmentDocumentRefs(value)).some((items) => items.length > 0);
    }
    if (key === "customPhaseLines") {
      return Object.values(sanitizeCustomPhaseLines(value)).some((items) => items.length > 0);
    }
    if (key === "assessmentGrid" || key === "standardizedAssessmentGrid") return false;
    return String(value || "").trim().length > 0;
  });
}
