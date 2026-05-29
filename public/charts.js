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
  const legendRows = Math.ceil(series.length / 2);
  const margin = { top: 52, right: 28, bottom: 102 + legendRows * 20, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allPoints = series.flatMap((item) => item.points);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!allPoints.length) {
    drawEmpty(ctx, width, height, options.emptyMessage || "No session data yet");
    return;
  }

  const dates = [...new Set(allPoints.map((point) => point.x))].sort();
  const maxY = Math.max(options.maxY || 0, ...allPoints.map((point) => point.y), 1);
  const yTop = options.maxY || Math.max(options.yStep || 1, Math.ceil(maxY * 1.15));
  const phaseBoundary = getPhaseBoundary(allPoints, dates);
  const layout = buildChartLayout(dates, margin.left, plotWidth, phaseBoundary, options.phaseMarkers || []);
  const xPositions = layout.dateXPositions;
  const phaseLineX = phaseBoundary ? phaseLinePosition(phaseBoundary, xPositions) : null;
  const phaseMarkerXs = markerPositions(options.phaseMarkers || [], dates, xPositions, layout.markerXByDate);
  const breakLines = [
    ...(Number.isFinite(phaseLineX) ? [phaseLineX] : []),
    ...phaseMarkerXs
  ];

  drawAxes(ctx, margin, plotWidth, plotHeight, width, height, yTop, options);
  drawPhaseLine(ctx, margin, plotWidth, plotHeight, phaseBoundary, xPositions);
  drawPhaseMarkers(ctx, margin, plotHeight, options.phaseMarkers || [], dates, xPositions, layout.markerXByDate);

  dates.forEach((date, index) => {
    const x = xPositions[index];
    ctx.fillStyle = "#59656f";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = dates.length > 3 ? "right" : "center";
      ctx.save();
      if (dates.length > 3) {
      ctx.translate(x - 4, margin.top + plotHeight + 38);
      ctx.rotate(-Math.PI / 7);
      ctx.fillText(formatDate(date), 0, 0);
    } else {
      ctx.fillText(formatDate(date), x, margin.top + plotHeight + 30);
    }
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
          phase: point.phase || "intervention"
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
    });

    drawLegendItem(
      ctx,
      item.name,
      color,
      margin.left + (seriesIndex % 2) * Math.min(260, plotWidth / 2),
      margin.top + plotHeight + 72 + Math.floor(seriesIndex / 2) * 20
    );
  });
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
    if (value > 0) {
      ctx.save();
      ctx.strokeStyle = "#edf2f6";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();
      ctx.restore();
    }
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

function getPhaseBoundary(allPoints, dates) {
  const baselineIndexes = allPoints
    .filter((point) => point.phase === "baseline")
    .map((point) => dates.indexOf(point.x))
    .filter((index) => index >= 0);
  const interventionIndexes = allPoints
    .filter((point) => (point.phase || "intervention") === "intervention")
    .map((point) => dates.indexOf(point.x))
    .filter((index) => index >= 0);

  if (!baselineIndexes.length || !interventionIndexes.length) return null;

  const firstIntervention = Math.min(...interventionIndexes.filter((index) => baselineIndexes.some((baselineIndex) => baselineIndex < index)));
  if (!Number.isFinite(firstIntervention)) return null;
  const lastBaseline = Math.max(...baselineIndexes.filter((index) => index < firstIntervention));
  if (!Number.isFinite(lastBaseline)) return null;

  return { leftIndex: lastBaseline, rightIndex: firstIntervention };
}

function drawPhaseLine(ctx, margin, plotWidth, plotHeight, phaseBoundary, xPositions) {
  if (!phaseBoundary) return null;

  const lineX = phaseLinePosition(phaseBoundary, xPositions);

  ctx.save();
  ctx.strokeStyle = "#1f2933";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lineX, margin.top - 2);
  ctx.lineTo(lineX, margin.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#1f2933";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Baseline", Math.max(margin.left + 48, lineX - 92), margin.top - 14);
  ctx.fillText("Treatment", Math.min(margin.left + plotWidth - 72, lineX + 92), margin.top - 14);

  ctx.save();
  ctx.translate(lineX - 12, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Treatment", 0, 0);
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
    if (marker.dashed) ctx.setLineDash([6, 6]);
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

function drawLegendItem(ctx, label, color, x, y) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 9, 12, 12);
  ctx.fillStyle = "#1f2933";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, x + 18, y + 1);
}

function drawEmpty(ctx, width, height, message) {
  ctx.fillStyle = "#59656f";
  ctx.font = "15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function buildXPositions(count, left, width, phaseBoundary) {
  if (count <= 1) return [left + width / 2];
  const padding = Math.min(28, width * 0.08);
  const start = left + padding;
  const end = left + width - padding;

  if (!phaseBoundary) {
    return buildCenteredSegmentPositions(count, start, end, 88);
  }

  const leftCount = phaseBoundary.leftIndex + 1;
  const rightCount = count - phaseBoundary.rightIndex;
  const phaseGap = Math.min(72, width * 0.12);
  const usableWidth = end - start - phaseGap;
  const leftWidth = usableWidth / 2;
  const rightWidth = usableWidth / 2;

  const leftPositions = buildCenteredSegmentPositions(leftCount, start, start + leftWidth, 88);
  const rightPositions = buildCenteredSegmentPositions(rightCount, start + leftWidth + phaseGap, end, 88);

  return [
    ...leftPositions,
    ...rightPositions
  ];
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

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
