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

export function hasMeaningfulFunderReportDraft(draft = {}) {
  if (!draft || typeof draft !== "object") return false;
  return Object.entries(draft).some(([key, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (key === "assessmentGrid" || key === "standardizedAssessmentGrid") return false;
    return String(value || "").trim().length > 0;
  });
}
