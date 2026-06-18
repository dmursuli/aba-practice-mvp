const palette = ["#167c80", "#d1495b", "#edae49", "#4b7bec", "#6a994e", "#9d4edd"];
const MOVING_AVERAGE_WINDOW = 5;

export function drawLineChart(canvas, series, options = {}) {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(340 * dpr);
  ctx.scale(dpr, dpr);

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const allPoints = series.flatMap((item) => item.points);
  const dateCount = new Set(allPoints.map((point) => point.x)).size;
  const useAngledDates = dateCount > 2;
  const margin = { top: 52, right: 28, bottom: useAngledDates ? 92 : 68, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!allPoints.length) {
    canvas.title = "";
    drawEmpty(ctx, width, height, options.emptyMessage || "No session data yet");
    return;
  }

  const model = buildClinicalGraphModel(series, options);
  const { dates, phaseBoundary, phaseMarkers } = model;
  const maxY = Math.max(options.maxY || 0, ...allPoints.map((point) => point.y), 1);
  const yTop = options.maxY || Math.max(options.yStep || 1, Math.ceil(maxY * 1.15));
  const layout = buildChartLayout(dates, margin.left, plotWidth, phaseBoundary, phaseMarkers);
  const xPositions = layout.dateXPositions;
  const phaseLineX = phaseBoundary ? phaseLinePosition(phaseBoundary, xPositions) : null;
  const phaseMarkerXs = markerPositions(phaseMarkers, dates, xPositions, layout.markerXByDate);
  const breakLines = [
    ...(Number.isFinite(phaseLineX) ? [phaseLineX] : []),
    ...phaseMarkerXs
  ];

  drawAxes(ctx, margin, plotWidth, plotHeight, width, height, yTop, options);
  drawPhaseLine(ctx, margin, plotWidth, plotHeight, phaseBoundary, xPositions);
  drawPhaseMarkers(ctx, margin, plotHeight, phaseMarkers, dates, xPositions, layout.markerXByDate);

  dates.forEach((date, index) => {
    const x = xPositions[index];
    ctx.fillStyle = "#59656f";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = useAngledDates ? "right" : "center";
    ctx.save();
    if (useAngledDates) {
      ctx.translate(x - 4, margin.top + plotHeight + 52);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(formatGraphDate(date), 0, 0);
    } else {
      ctx.fillText(formatGraphDate(date), x, margin.top + plotHeight + 30);
    }
    ctx.restore();
  });

  const interactivePoints = [];
  const movingAverageSeries = options.showTrendLine
    ? buildMovingAverageSeriesSet(series, {
        dates,
        phaseBoundary,
        windowSize: options.trendLineWindow || MOVING_AVERAGE_WINDOW
      })
    : [];
  movingAverageSeries.forEach((item, seriesIndex) => {
    const color = palette[seriesIndex % palette.length];
    const points = item.points
      .slice()
      .sort((a, b) => a.x.localeCompare(b.x))
      .map((point) => {
        const dateIndex = dates.indexOf(point.x);
        const baseX = xPositions[dateIndex];
        return {
          x: baseX,
          y: margin.top + plotHeight - (point.y / yTop) * plotHeight,
          value: point.y,
          dateIndex,
          phase: point.phase || derivedPointPhase(dateIndex, phaseBoundary),
          label: item.name,
          date: point.x,
          source: point
        };
      });
    ctx.save();
    ctx.strokeStyle = `${color}99`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    drawPhaseSegments(ctx, points, phaseBoundary, breakLines);
    ctx.restore();
  });
  series.forEach((item, seriesIndex) => {
    const color = palette[seriesIndex % palette.length];
    const points = item.points
      .slice()
      .sort((a, b) => a.x.localeCompare(b.x))
      .map((point) => {
        const dateIndex = dates.indexOf(point.x);
        const baseX = xPositions[dateIndex];
        return {
          x: baseX,
          y: margin.top + plotHeight - (point.y / yTop) * plotHeight,
          value: point.y,
          dateIndex,
          phase: derivedPointPhase(dateIndex, phaseBoundary),
          label: item.name,
          date: point.x,
          source: point
        };
      });

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    drawPhaseSegments(ctx, points, phaseBoundary, breakLines);

    points.forEach((point) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
      interactivePoints.push(point);
    });
  });

  bindCanvasTooltip(canvas, interactivePoints);
}

export function buildClinicalGraphModel(series, options = {}) {
  const allPoints = series.flatMap((item) => item.points || []);
  const dates = [...new Set(allPoints.map((point) => point.x))].sort();
  const phaseBoundary = buildBaselineToTreatmentBoundary(dates);
  const phaseMarkers = normalizePhaseMarkers(options.phaseMarkers || [], dates, phaseBoundary);
  return {
    dates,
    showGridLines: false,
    phaseBoundary,
    phaseMarkers
  };
}

export function buildLegendItems(series) {
  return series.map((item, index) => ({
    label: item.name,
    color: palette[index % palette.length]
  }));
}

export function buildGraphAnalysis(series, options = {}) {
  const graphType = options.graphType === "behavior" ? "behavior" : "skill";
  const model = buildClinicalGraphModel(series, options);
  const movingAverageSeries = buildMovingAverageSeriesSet(series, {
    dates: model.dates,
    phaseBoundary: model.phaseBoundary,
    windowSize: options.trendLineWindow || MOVING_AVERAGE_WINDOW
  });
  const analyses = series.map((item, index) => analyzeSingleSeries(item, {
    graphType,
    dates: model.dates,
    phaseBoundary: model.phaseBoundary,
    phaseMarkers: model.phaseMarkers,
    movingAveragePoints: movingAverageSeries[index]?.points || []
  }));
  return {
    graphType,
    phaseBoundary: model.phaseBoundary,
    dates: model.dates,
    trendLineEligible: analyses.some((entry) => entry.trendLineEligible),
    trendLineMessage: analyses.some((entry) => !entry.trendLineEligible)
      ? "Trend line requires at least 5 data points."
      : "",
    analyses
  };
}

export function buildMovingAverageSeriesSet(series, options = {}) {
  const dates = options.dates || [...new Set(series.flatMap((item) => (item.points || []).map((point) => point.x)))].sort();
  const phaseBoundary = options.phaseBoundary || buildBaselineToTreatmentBoundary(dates);
  const windowSize = options.windowSize || MOVING_AVERAGE_WINDOW;
  return (series || []).map((item) => ({
    name: item.name,
    points: buildMovingAveragePoints(item.points || [], { dates, phaseBoundary, windowSize }),
    meta: item.meta || {}
  }));
}

export function buildMovingAveragePoints(points, options = {}) {
  const dates = options.dates || [...new Set((points || []).map((point) => point.x))].sort();
  const phaseBoundary = options.phaseBoundary || buildBaselineToTreatmentBoundary(dates);
  const windowSize = options.windowSize || MOVING_AVERAGE_WINDOW;
  const normalized = (points || [])
    .slice()
    .sort((a, b) => a.x.localeCompare(b.x))
    .map((point) => {
      const dateIndex = dates.indexOf(point.x);
      const derivedPhase = derivedPointPhase(dateIndex, phaseBoundary);
      return {
        ...point,
        dateIndex,
        phase: point.phase === "baseline" ? "baseline" : derivedPhase
      };
    });
  const grouped = normalized.reduce((map, point) => {
    if (!map.has(point.phase)) map.set(point.phase, []);
    map.get(point.phase).push(point);
    return map;
  }, new Map());
  return [...grouped.entries()].flatMap(([, phasePoints]) => {
    if (phasePoints.length < windowSize) return [];
    return phasePoints.map((point, index) => {
      if (index + 1 < windowSize) return null;
      const windowPoints = phasePoints.slice(index + 1 - windowSize, index + 1);
      const average = mean(windowPoints.map((entry) => Number(entry.y || 0)));
      return {
        x: point.x,
        y: roundMetric(average, 1),
        phase: point.phase
      };
    }).filter(Boolean);
  });
}

function analyzeSingleSeries(series, options) {
  const graphType = options.graphType;
  const baselinePoints = [];
  const treatmentPoints = [];
  const normalized = (series.points || [])
    .slice()
    .sort((a, b) => a.x.localeCompare(b.x))
    .map((point) => {
      const dateIndex = options.dates.indexOf(point.x);
      const derivedPhase = derivedPointPhase(dateIndex, options.phaseBoundary);
      const phase = point.phase === "baseline" ? "baseline" : derivedPhase;
      const normalizedPoint = { ...point, dateIndex, phase };
      if (phase === "baseline") baselinePoints.push(normalizedPoint);
      else treatmentPoints.push(normalizedPoint);
      return normalizedPoint;
    });
  const baselineValues = baselinePoints.map((point) => Number(point.y || 0));
  const treatmentValues = treatmentPoints.map((point) => Number(point.y || 0));
  const evaluationValues = treatmentValues.length ? treatmentValues : baselineValues;
  const baselineAverage = baselineValues.length ? mean(baselineValues) : null;
  const treatmentAverage = treatmentValues.length ? mean(treatmentValues) : null;
  const baselineCurrent = baselineValues.length ? baselineValues[baselineValues.length - 1] : null;
  const treatmentCurrent = treatmentValues.length ? treatmentValues[treatmentValues.length - 1] : null;
  const trend = classifyTrend(treatmentValues, graphType);
  const variability = classifyVariability(evaluationValues);
  const stability = classifyStability(evaluationValues);
  const difference = baselineAverage !== null && treatmentAverage !== null
    ? graphType === "behavior"
      ? baselineAverage - treatmentAverage
      : treatmentAverage - baselineAverage
    : null;
  const percentChange = graphType === "skill"
    ? percentChangeMetric(baselineAverage, treatmentAverage)
    : null;
  const sessionsToMastery = graphType === "skill"
    ? calculateSessionsToMastery(series, treatmentPoints, options.phaseMarkers)
    : null;
  const masteryStatus = graphType === "skill"
    ? skillMasteryStatus(series, sessionsToMastery)
    : null;
  const magnitudeOfImprovement = graphType === "skill"
    ? magnitudeImprovement(baselineAverage, treatmentAverage, treatmentCurrent)
    : null;
  const percentReduction = graphType === "behavior"
    ? percentReductionMetric(baselineAverage, treatmentAverage, treatmentCurrent)
    : null;
  const overlap = baselineValues.length && treatmentValues.length
    ? overlapMetric(graphType, baselineValues, treatmentValues)
    : null;
  const immediacy = graphType === "behavior"
    ? immediacyMetric(baselineValues, treatmentValues)
    : null;
  const interpretation = buildInterpretation({
    graphType,
    label: series.name,
    baselineValues,
    treatmentValues,
    baselineAverage,
    treatmentAverage,
    trend,
    variability,
    stability,
    magnitudeOfImprovement,
    difference,
    percentChange,
    percentReduction,
    overlap,
    immediacy,
    masteryStatus,
    sessionsToMastery
  });
  return {
    label: series.name,
    graphType,
    baselineAverage: roundMetric(baselineAverage),
    baselineLevel: roundMetric(baselineAverage),
    treatmentAverage: roundMetric(treatmentAverage),
    treatmentLevel: roundMetric(treatmentAverage),
    currentLevel: roundMetric(treatmentCurrent ?? baselineCurrent),
    trendDirection: trend.direction,
    trendConfidence: trend.confidence,
    variability,
    stability,
    magnitudeOfImprovement,
    difference: roundMetric(difference),
    percentChange,
    sessionsToMastery,
    masteryStatus,
    percentReduction,
    overlap,
    immediacy,
    interpretation,
    baselineAvailable: baselineValues.length > 0,
    treatmentAvailable: treatmentValues.length > 0,
    trendLineEligible: normalized.length >= MOVING_AVERAGE_WINDOW,
    movingAveragePoints: options.movingAveragePoints || []
  };
}

export function buildBaselineToTreatmentBoundary(dates) {
  if (!Array.isArray(dates) || dates.length < 2) return null;
  return {
    label: "Treatment",
    leftIndex: 0,
    rightIndex: 1,
    lineStyle: "solid",
    phaseType: "baselineToTreatment"
  };
}

export function normalizePhaseMarkers(markers = [], dates = [], phaseBoundary = null) {
  if (!Array.isArray(markers) || !markers.length) return [];
  const treatmentStartDate = phaseBoundary ? dates[phaseBoundary.rightIndex] : null;
  return markers
    .map((marker) => normalizePhaseMarker(marker))
    .filter(Boolean)
    .filter((marker) => {
      if (!marker.date) return false;
      if (!phaseBoundary) {
        return marker.phaseType === "baselineConditionChange";
      }
      if (marker.phaseType === "baselineConditionChange") return true;
      if (!treatmentStartDate) return false;
      return marker.date >= treatmentStartDate;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || phaseMarkerOrder(a) - phaseMarkerOrder(b));
}

function normalizePhaseMarker(marker = {}) {
  if (!marker || !marker.date) return null;
  const phaseType = marker.phaseType || inferPhaseType(marker);
  const lineStyle = marker.lineStyle || (phaseType === "baselineToTreatment" ? "solid" : "dashed");
  return {
    ...marker,
    label: marker.label || "Marker",
    phaseType,
    lineStyle,
    dashed: lineStyle !== "solid",
    position: marker.position || "after-date"
  };
}

function inferPhaseType(marker = {}) {
  if (marker.label === "Treatment") return "baselineToTreatment";
  if (marker.label === "Target mastered") return "objectiveChange";
  return "objectiveChange";
}

function phaseMarkerOrder(marker) {
  const order = {
    baselineConditionChange: 0,
    objectiveChange: 1,
    targetMastered: 2
  };
  return order[marker.phaseType] ?? 1;
}

export function derivedPointPhase(dateIndex, phaseBoundary = null) {
  if (!phaseBoundary) return "baseline";
  return dateIndex <= phaseBoundary.leftIndex ? "baseline" : "intervention";
}

function drawAxes(ctx, margin, plotWidth, plotHeight, width, height, yTop, options) {
  const tickValues = axisTicks(yTop, options.yStep);
  ctx.strokeStyle = "#d6dde3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotHeight);
  ctx.lineTo(width - margin.right, margin.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#59656f";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  tickValues.forEach((value) => {
    const y = margin.top + plotHeight - (value / yTop) * plotHeight;
    ctx.fillText(String(value), margin.left - 10, y + 4);
  });

  if (options.yLabel) {
    ctx.save();
    ctx.translate(16, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(options.yLabel, 0, 0);
    ctx.restore();
  }
}

function drawPhaseLine(ctx, margin, plotWidth, plotHeight, phaseBoundary, xPositions) {
  if (!phaseBoundary) return null;

  const lineX = phaseLinePosition(phaseBoundary, xPositions);

  ctx.save();
  ctx.strokeStyle = "#1f2933";
  ctx.lineWidth = 2;
  if (phaseBoundary.lineStyle === "dashed") ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(lineX, margin.top - 2);
  ctx.lineTo(lineX, margin.top + plotHeight);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#1f2933";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Baseline", Math.max(margin.left + 48, lineX - 92), margin.top - 14);
  ctx.fillText(phaseBoundary.label || "Treatment", Math.min(margin.left + plotWidth - 72, lineX + 92), margin.top - 14);

  ctx.save();
  ctx.translate(lineX - 12, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(phaseBoundary.label || "Treatment", 0, 0);
  ctx.restore();
  ctx.restore();

  return lineX;
}

function drawPhaseMarkers(ctx, margin, plotHeight, markers, dates, xPositions, markerXByDate = new Map()) {
  markers.forEach((marker) => {
    const lineX = xPositionForMarkerDateWithMode(marker, dates, xPositions, markerXByDate);
    if (!Number.isFinite(lineX)) return;

    ctx.save();
    ctx.strokeStyle = "#7a4f00";
    ctx.lineWidth = 2;
    if (marker.lineStyle === "dashed") ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(lineX, margin.top - 2);
    ctx.lineTo(lineX, margin.top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#7a4f00";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(marker.label || "Marker", lineX, margin.top - 30);
    ctx.restore();
  });
}

function xPositionForMarkerDate(date, dates, xPositions, markerXByDate = new Map()) {
  return xPositionForMarkerDateWithMode({ date }, dates, xPositions, markerXByDate);
}

function xPositionForMarkerDateWithMode(marker, dates, xPositions, markerXByDate = new Map()) {
  const date = marker?.date;
  if (marker?.position === "after-date" && markerXByDate.has(date)) {
    return markerXByDate.get(date);
  }
  const exactIndex = dates.indexOf(date);
  if (exactIndex >= 0) {
    return xPositions[exactIndex];
  }

  const markerValue = `${date}T00:00`;
  let previousIndex = -1;
  let nextIndex = -1;

  dates.forEach((existingDate, index) => {
    const value = `${existingDate}T00:00`;
    if (value < markerValue) previousIndex = index;
    if (nextIndex === -1 && value > markerValue) nextIndex = index;
  });

  if (previousIndex >= 0 && nextIndex >= 0) {
    return xPositions[previousIndex] + (xPositions[nextIndex] - xPositions[previousIndex]) / 2;
  }
  if (previousIndex >= 0) return xPositions[previousIndex];
  if (nextIndex >= 0) return xPositions[nextIndex];
  return NaN;
}

function markerPositions(markers, dates, xPositions, markerXByDate = new Map()) {
  return markers
    .map((marker) => xPositionForMarkerDateWithMode(marker, dates, xPositions, markerXByDate))
    .filter((value) => Number.isFinite(value));
}

function phaseLinePosition(phaseBoundary, xPositions) {
  const baselineX = xPositions[phaseBoundary.leftIndex];
  const interventionX = xPositions[phaseBoundary.rightIndex];
  return baselineX + (interventionX - baselineX) / 2;
}

function drawPhaseSegments(ctx, points, phaseBoundary, breakLines = []) {
  let previousPoint = null;
  points.forEach((point) => {
    const crossesPhaseBoundary = phaseBoundary
      && previousPoint
      && previousPoint.dateIndex <= phaseBoundary.leftIndex
      && point.dateIndex >= phaseBoundary.rightIndex;
    const crossesBreakLine = previousPoint && breakLines.some((lineX) => (
      Number.isFinite(lineX)
      && ((previousPoint.x < lineX && point.x > lineX) || (previousPoint.x > lineX && point.x < lineX))
    ));
    if (!previousPoint || previousPoint.phase !== point.phase || crossesPhaseBoundary || crossesBreakLine) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    }
    previousPoint = point;
  });
}

function buildChartLayout(dates, left, width, phaseBoundary, markers = []) {
  const dateXPositions = Array(dates.length).fill(NaN);
  const markerXByDate = new Map();
  const timelineItems = dates.map((date) => ({
    kind: "date",
    date,
    sortValue: dateSortValue(date)
  }));

  (markers || [])
    .filter((marker) => marker?.position === "after-date" && marker?.date)
    .forEach((marker) => {
      timelineItems.push({
        kind: "marker",
        date: marker.date,
        sortValue: dateSortValue(marker.date) + 0.5
      });
    });

  timelineItems.sort((a, b) => a.sortValue - b.sortValue);

  const slotCount = Math.max(timelineItems.length, 1);
  const padding = Math.min(28, width * 0.08);
  const start = left + padding;
  const end = left + width - padding;

  let slotPositions;
  if (!phaseBoundary) {
    slotPositions = buildCenteredSegmentPositions(slotCount, start, end, 88);
  } else {
    const baselineDate = dates[phaseBoundary.leftIndex];
    const treatmentDate = dates[phaseBoundary.rightIndex];
    const phaseBoundaryValue = (dateSortValue(baselineDate) + dateSortValue(treatmentDate)) / 2;
    const leftItems = timelineItems.filter((item) => item.sortValue <= phaseBoundaryValue);
    const rightItems = timelineItems.filter((item) => item.sortValue > phaseBoundaryValue);
    const phaseGap = Math.min(72, width * 0.12);
    const usableWidth = end - start - phaseGap;
    const leftWidth = usableWidth / 2;
    const rightWidth = usableWidth / 2;
    const leftPositions = buildCenteredSegmentPositions(leftItems.length, start, start + leftWidth, 88);
    const rightPositions = buildCenteredSegmentPositions(rightItems.length, start + leftWidth + phaseGap, end, 88);
    slotPositions = [...leftPositions, ...rightPositions];
  }

  timelineItems.forEach((item, index) => {
    const x = slotPositions[index];
    if (item.kind === "date") {
      dateXPositions[dates.indexOf(item.date)] = x;
    } else {
      markerXByDate.set(item.date, x);
    }
  });

  return { dateXPositions, markerXByDate };
}

function dateSortValue(value) {
  return Date.parse(`${value}T00:00:00`);
}

function axisTicks(yTop, yStep) {
  if (!yStep) {
    return [0, 1, 2, 3, 4].map((index) => Math.round((yTop / 4) * index));
  }
  const ticks = [];
  for (let value = 0; value <= yTop; value += yStep) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== yTop) ticks.push(yTop);
  return ticks;
}

function drawEmpty(ctx, width, height, message) {
  ctx.fillStyle = "#59656f";
  ctx.font = "15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function buildCenteredSegmentPositions(count, start, end, maxStep) {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  const width = end - start;
  const naturalStep = width / (count - 1);
  const step = Math.min(naturalStep, maxStep);
  const span = step * (count - 1);
  const offset = (width - span) / 2;
  return Array.from({ length: count }, (_, index) => start + offset + index * step);
}

export function formatGraphDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function classifyTrend(values, graphType) {
  if (!Array.isArray(values) || values.length < 3) {
    return {
      direction: "Unavailable",
      slope: 0,
      confidence: "Insufficient data for trend interpretation."
    };
  }
  const slope = linearRegressionSlope(values);
  const range = Math.max(...values) - Math.min(...values);
  const threshold = Math.max(range * 0.1, graphType === "skill" ? 1 : 0.25);
  if (Math.abs(slope) <= threshold) {
    return { direction: "flat", slope, confidence: "" };
  }
  if (graphType === "behavior") {
    return { direction: slope < 0 ? "decreasing" : "increasing", slope, confidence: "" };
  }
  return { direction: slope > 0 ? "ascending" : "descending", slope, confidence: "" };
}

function classifyVariability(values) {
  if (!Array.isArray(values) || values.length < 2) return "Variability requires at least 2 data points.";
  const average = mean(values);
  if (!average) return "low";
  const cv = standardDeviation(values) / Math.abs(average);
  if (cv < 0.15) return "low";
  if (cv <= 0.35) return "moderate";
  return "high";
}

function classifyStability(values) {
  if (!Array.isArray(values) || values.length < 3) return "Stability requires at least 3 treatment data points.";
  const median = med(values);
  if (!median) return "stable";
  const lower = median * 0.75;
  const upper = median * 1.25;
  const withinBand = values.filter((value) => value >= lower && value <= upper).length;
  return withinBand / values.length >= 0.8 ? "stable" : "unstable";
}

function magnitudeImprovement(baselineAverage, treatmentAverage, currentLevel) {
  if (baselineAverage === null) return "Baseline unavailable.";
  const comparison = treatmentAverage ?? currentLevel;
  if (comparison === null) return "Treatment data unavailable.";
  const delta = comparison - baselineAverage;
  const direction = delta > 0 ? "increase" : delta < 0 ? "decrease" : "no change";
  return `${direction === "no change" ? "No change" : `${Math.abs(roundMetric(delta, 1))} point ${direction}`}${direction === "no change" ? "" : " from baseline"}`;
}

function percentChangeMetric(baselineAverage, treatmentAverage) {
  if (baselineAverage === null || treatmentAverage === null) return "Unavailable";
  if (baselineAverage === 0) return "Baseline mean is 0; percent change unavailable.";
  const change = ((treatmentAverage - baselineAverage) / baselineAverage) * 100;
  return `${roundMetric(change, 1)}%`;
}

function percentReductionMetric(baselineAverage, treatmentAverage, currentLevel) {
  if (baselineAverage === null || baselineAverage === 0) return "Baseline unavailable.";
  const comparison = treatmentAverage ?? currentLevel;
  if (comparison === null) return "Treatment data unavailable.";
  const reduction = ((baselineAverage - comparison) / baselineAverage) * 100;
  return `${roundMetric(reduction, 1)}%`;
}

function overlapMetric(graphType, baselineValues, treatmentValues) {
  if (!baselineValues.length || !treatmentValues.length) return "Unavailable";
  const threshold = graphType === "skill"
    ? Math.max(...baselineValues)
    : Math.min(...baselineValues);
  const overlapping = treatmentValues.filter((value) => (
    graphType === "skill" ? value <= threshold : value >= threshold
  )).length;
  return `${roundMetric((overlapping / treatmentValues.length) * 100, 1)}%`;
}

function immediacyMetric(baselineValues, treatmentValues) {
  if (!baselineValues.length || !treatmentValues.length) return "Unavailable";
  const baselineWindow = baselineValues.slice(-3);
  const treatmentWindow = treatmentValues.slice(0, 3);
  const baselineLevel = mean(baselineWindow);
  const treatmentLevel = mean(treatmentWindow);
  const direction = treatmentLevel < baselineLevel ? "Immediate decrease" : treatmentLevel > baselineLevel ? "Immediate increase" : "No immediate change";
  const confidence = baselineWindow.length < 3 || treatmentWindow.length < 3 ? " (limited confidence)" : "";
  return `${direction}${confidence}`;
}

function calculateSessionsToMastery(series, treatmentPoints, markers) {
  const targetId = series.meta?.targetId;
  const masteryMarker = (markers || []).find((marker) => (
    marker.phaseType === "targetMastered"
    && (!targetId || !Array.isArray(marker.targetIds) || marker.targetIds.includes(targetId))
  ));
  if (!masteryMarker) return null;
  const masteredDate = masteryMarker.date;
  const count = treatmentPoints.filter((point) => point.x <= masteredDate).length;
  return count || null;
}

function skillMasteryStatus(series, sessionsToMastery) {
  const status = series.meta?.status || "";
  if (status === "mastered" || sessionsToMastery) return "mastered";
  if (status === "maintenance") return "maintenance";
  return "in progress";
}

function buildInterpretation(context) {
  const {
    graphType,
    label,
    baselineValues,
    treatmentValues,
    baselineAverage,
    treatmentAverage,
    trend,
    variability,
    stability,
    magnitudeOfImprovement,
    difference,
    percentChange,
    percentReduction,
    overlap,
    immediacy,
    masteryStatus,
    sessionsToMastery
  } = context;
  if (!baselineValues.length) {
    return `${label}: Baseline unavailable. ${treatmentValues.length ? `Treatment level is currently ${roundMetric(treatmentAverage ?? mean(treatmentValues), 1)}${graphType === "skill" ? "%" : ""}.` : "Treatment data are unavailable."} ${trend.confidence || ""}`.trim();
  }
  if (!treatmentValues.length) {
    return `${label}: Baseline level was ${roundMetric(baselineAverage, 1)}${graphType === "skill" ? "%" : ""}. Treatment data are unavailable.`;
  }
  if (graphType === "behavior") {
    const limitedConfidence = baselineValues.length < 3 || treatmentValues.length < 3;
    const reductionClause = baselineAverage === 0
      ? `Treatment frequency averaged ${roundMetric(treatmentAverage, 1)}, representing a ${roundMetric(difference, 1)}-point absolute decrease from baseline.`
      : `Treatment frequency averaged ${roundMetric(treatmentAverage, 1)}, representing a ${percentReduction} reduction from baseline.`;
    const trendClause = trend.direction === "Unavailable"
      ? "Additional data are needed to establish a stable trend."
      : `Data show a ${trend.direction} trend.`;
    const supportClauses = [
      variability && !String(variability).includes("requires") ? `${variability} variability` : "",
      stability && !String(stability).includes("requires") ? `${stability} stability` : "",
      overlap && overlap !== "Unavailable" ? `overlap was ${overlap}` : "",
      immediacy && immediacy !== "Unavailable" ? String(immediacy).toLowerCase() : ""
    ].filter(Boolean);
    return `${label}: Baseline frequency averaged ${roundMetric(baselineAverage, 1)} based on ${baselineValues.length} baseline data point${baselineValues.length === 1 ? "" : "s"}. ${reductionClause} ${trendClause}${supportClauses.length ? ` Observed response showed ${supportClauses.join(", ")}.` : ""}${limitedConfidence ? " Interpretation is limited by the small number of data points." : ""}`.trim();
  }
  const limitedConfidence = baselineValues.length < 3 || treatmentValues.length < 3;
  const changeClause = baselineAverage === 0
    ? `Treatment level averaged ${roundMetric(treatmentAverage, 1)}%, representing a ${roundMetric(difference, 1)}-percentage-point increase from baseline.`
    : `Treatment performance averaged ${roundMetric(treatmentAverage, 1)}%, representing a ${roundMetric(difference, 1)}-percentage-point improvement${percentChange && !String(percentChange).includes("unavailable") ? ` (${percentChange})` : ""}.`;
  const trendClause = trend.direction === "Unavailable"
    ? "Additional treatment data are needed to establish a stable trend."
    : `Data demonstrate a ${trend.direction} trend.`;
  const supportClauses = [
    variability && !String(variability).includes("requires") ? `${variability} variability` : "",
    stability && !String(stability).includes("requires") ? `${stability} stability` : ""
  ].filter(Boolean);
  const masterySentence = masteryStatus === "mastered" && sessionsToMastery
    ? ` Mastery was reached after ${sessionsToMastery} treatment session${sessionsToMastery === 1 ? "" : "s"}.`
    : ` Current mastery status is ${masteryStatus || "in progress"}.`;
  return `${label}: Baseline level was ${roundMetric(baselineAverage, 1)}% based on ${baselineValues.length} baseline data point${baselineValues.length === 1 ? "" : "s"}. ${changeClause} ${trendClause}${supportClauses.length ? ` Observed response showed ${supportClauses.join(" and ")}.` : ""}${limitedConfidence ? " Interpretation is limited by the small number of data points." : ""}${masterySentence}`.trim();
}

function linearRegressionSlope(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

function mean(values) {
  if (!Array.isArray(values) || !values.length) return null;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function med(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }
  return sorted[midpoint];
}

function standardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function roundMetric(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function bindCanvasTooltip(canvas, points) {
  if (!canvas) return;
  canvas.onmousemove = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = points.reduce((best, point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance > 12) return best;
      if (!best || distance < best.distance) return { point, distance };
      return best;
    }, null);
    canvas.title = nearest
      ? `${nearest.point.label}: ${nearest.point.value} on ${formatGraphDate(nearest.point.date)}`
      : "";
  };
  canvas.onmouseleave = () => {
    canvas.title = "";
  };
}
