import { graphNumericValue } from "./graph-values.js";

export function skillGraphMeasurement(entry) {
  const explicit = entry.dataCollectionType;
  const imported = entry.historicalImportMeasurementType;
  const hasExplicit = explicit !== undefined && explicit !== null && explicit !== "";
  const hasImported = imported !== undefined && imported !== null && imported !== "";
  if (hasExplicit && !["percent_correct", "frequency"].includes(explicit)) return null;
  const importType = imported === "percentage" ? "percent_correct" : imported === "frequency" ? "frequency" : null;
  if (hasImported && !importType) return null;
  if (hasExplicit && hasImported && explicit !== importType) return null;
  if (hasExplicit || hasImported) return hasExplicit ? explicit : importType;
  // Legacy percentage records (including SOAP recovery) store independence.
  // A frequency field without explicit type is not sufficient evidence.
  return Object.hasOwn(entry, "independence") && !Object.hasOwn(entry, "frequency") ? "percent_correct" : null;
}

export function buildSkillMeasurementChart(program, targets, observations, preferredType) {
  let ambiguousCount = 0;
  const typed = observations.flatMap((point) => {
    const measurement = skillGraphMeasurement(point);
    if (!measurement) { ambiguousCount += 1; return []; }
    return [{ ...point, dataCollectionType: measurement,
      y: graphNumericValue(measurement === "frequency" ? point.frequency : point.independence) }];
  });
  const measurementTypes = ["percent_correct", "frequency"].filter(type => typed.some(point => point.dataCollectionType === type));
  const measurementType = measurementTypes.includes(preferredType) ? preferredType : measurementTypes[0] || "percent_correct";
  const selected = typed.filter(point => point.dataCollectionType === measurementType);
  const series = targets.map(target => ({
    name: target.name,
    meta: { targetId: target.id, status: target.status || "active" },
    points: selected.filter(point => point.targetId === target.id)
  })).filter(item => item.points.length);
  return { program, series, measurementTypes, measurementType, ambiguousCount };
}

export function skillMeasurementSettings(chart) {
  return chart.measurementType === "frequency"
    ? { mode: "frequency", yLabel: "Frequency", emptyMessage: "No frequency data for this program" }
    : { mode: "percent_correct", maxY: 100, yStep: 10, yLabel: "Percent correct", emptyMessage: "No percentage data for this program" };
}
