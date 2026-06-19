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
    editedGraphAnalysis: sortObjectKeys(editedGraphAnalysis)
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
    if (key === "assessmentGrid" || key === "standardizedAssessmentGrid") return false;
    return String(value || "").trim().length > 0;
  });
}
