import { graphNumericValue } from "./graph-values.js";
import { drawLineChart, buildGraphAnalysis } from "./charts.js";

const labels = {
  frequency: "Frequency", percentage: "Percentage",
  duration: "Duration (unit unspecified)", rate: "Rate (denominator unspecified)"
};

export function behaviorMeasurementLabel(type) {
  return Object.hasOwn(labels, type) ? labels[type] : "Measurement unspecified";
}

export function behaviorGraphMeasurement(entry, session = {}) {
  const normalize = value => ["count", "occurrences"].includes(value)
    ? "frequency" : (Object.hasOwn(labels, value) ? value : null);
  const declarations = [entry.historicalImportMeasurementType, entry.measurementType, entry.dataCollectionType]
    .filter(value => value !== undefined && value !== null && value !== "");
  const types = declarations.map(normalize);
  if (types.some(type => !type) || new Set(types).size > 1) return null;
  if (types.length) return types[0];
  // Imported values overload the frequency field; that field alone is not
  // evidence of counts when import provenance is present.
  const imported = entry.historicalImportRowId || entry.historicalImportBatchId
    || session.historicalImportBatchId || session.historicalImport
    || ["historical-import", "historical_import"].includes(session.source);
  return !imported && Object.hasOwn(entry, "frequency") ? "frequency" : null;
}

export function behaviorMeasurementGate(series) {
  const points = series.flatMap(item => item.points);
  const ambiguousCount = points.filter(point => !Object.hasOwn(labels, point.measurementType)).length;
  const typed = points.filter(point => Object.hasOwn(labels, point.measurementType));
  const numeric = typed.filter(point => graphNumericValue(point.y) !== null);
  const types = [...new Set((numeric.length ? numeric : typed).map(point => point.measurementType))];
  const blocked = types.length > 1 || (!types.length && ambiguousCount > 0);
  const type = types.length === 1 ? types[0] : null;
  const notice = types.length > 1
    ? "These observations use different measurement types. The combined graph, moving average, and numeric analysis are unavailable until comparable measurements can be selected."
    : ambiguousCount ? `${ambiguousCount} observation(s) have unclear or conflicting measurement metadata and are excluded from the graph and numeric analysis.` : "";
  const safeSeries = blocked ? [] : series.map(item => ({ ...item,
    points: item.points.filter(point => point.measurementType === type)
  })).filter(item => item.points.length);
  return { series: safeSeries, type, blocked, notice, ambiguousCount,
    settings: type === "percentage"
      ? { maxY: 100, yStep: 10, yLabel: labels.percentage }
      : { yStep: 1, yLabel: behaviorMeasurementLabel(type) }
  };
}

export function drawBehaviorMeasurementChart(canvas, series, options = {}) {
  const gate = behaviorMeasurementGate(series);
  if (!canvas) return gate;
  canvas.parentElement?.querySelector('[data-behavior-measurement-notice]')?.remove();
  if (gate.notice) {
    const notice = document.createElement('p');
    notice.className = 'muted';
    notice.dataset.behaviorMeasurementNotice = '';
    notice.setAttribute('role', 'status');
    notice.textContent = gate.notice;
    canvas.before(notice);
  }
  canvas.classList.toggle('hidden', gate.blocked);
  drawLineChart(canvas, gate.series, { ...options, ...gate.settings,
    showTrendLine: !gate.blocked && options.showTrendLine });
  return gate;
}

export function buildBehaviorMeasurementAnalysis(series, options = {}) {
  const gate = behaviorMeasurementGate(series);
  if (gate.blocked) return { analyses: [], measurementNotice: gate.notice };
  const analysis = buildGraphAnalysis(gate.series, { ...options, graphType: "behavior" });
  // Preserve calculations; remove count-specific wording for other units.
  if (gate.type && gate.type !== 'frequency') {
    analysis.analyses = analysis.analyses.map(entry => ({ ...entry,
      interpretation: entry.interpretation.replace(/frequency/g, behaviorMeasurementLabel(gate.type).toLowerCase())
    }));
  }
  return { ...analysis, measurementNotice: gate.notice, measurementLabel: behaviorMeasurementLabel(gate.type) };
}
