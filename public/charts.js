const palette = ["#167c80", "#d1495b", "#edae49", "#4b7bec", "#6a994e", "#9d4edd"];

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
