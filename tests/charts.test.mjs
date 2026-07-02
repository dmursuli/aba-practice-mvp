import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildChartLayout,
  buildDateTicks,
  buildClinicalGraphModel,
  buildGraphAnalysis,
  buildLegendItems,
  buildMovingAverageSeriesSet,
  derivedPointPhase,
  filterSeriesPointsByDateRange,
  formatGraphDate
} from '../public/charts.js';

function makeSeries(label, points) {
  return [{ name: label, points }];
}

function behaviorLikeSeries(points) {
  return makeSeries('Behavior frequency', points.map((point) => ({ ...point })));
}

function skillLikeSeries(points) {
  return makeSeries('Skill target', points.map((point) => ({ ...point })));
}

function targetMasteredMarker(date) {
  return [{
    date,
    label: 'Target mastered',
    phaseType: 'targetMastered',
    lineStyle: 'dashed',
    position: 'after-date'
  }];
}

function objectiveChangeMarker(date) {
  return [{
    date,
    label: 'Objective changed',
    phaseType: 'objectiveChange',
    lineStyle: 'dashed',
    position: 'after-date'
  }];
}

function baselineConditionChangeMarker(date) {
  return [{
    date,
    label: 'Baseline condition change',
    phaseType: 'baselineConditionChange',
    lineStyle: 'dashed',
    position: 'after-date'
  }];
}

function environmentalChangeMarker(date, lineStyle = 'dashed') {
  return [{
    date,
    label: 'School schedule change',
    phaseType: 'environmentalChange',
    lineStyle
  }];
}

for (const [label, make] of [['skill acquisition', skillLikeSeries], ['behavior reduction', behaviorLikeSeries]]) {
  test(`${label}: one data point renders baseline only with no treatment line`, () => {
    const model = buildClinicalGraphModel(make([
      { x: '2026-06-01', y: 40, phase: 'intervention' }
    ]));

    assert.equal(model.showGridLines, false);
    assert.equal(model.phaseBoundary, null);
    assert.deepEqual(model.phaseMarkers, []);
    assert.equal(derivedPointPhase(0, model.phaseBoundary), 'baseline');
  });

  test(`${label}: two data points render a solid treatment line after point one`, () => {
    const model = buildClinicalGraphModel(make([
      { x: '2026-06-01', y: 40, phase: 'intervention' },
      { x: '2026-06-03', y: 60, phase: 'intervention' }
    ]));

    assert.ok(model.phaseBoundary);
    assert.equal(model.phaseBoundary.phaseType, 'baselineToTreatment');
    assert.equal(model.phaseBoundary.lineStyle, 'solid');
    assert.equal(model.phaseBoundary.leftIndex, 0);
    assert.equal(model.phaseBoundary.rightIndex, 1);
    assert.equal(derivedPointPhase(0, model.phaseBoundary), 'baseline');
    assert.equal(derivedPointPhase(1, model.phaseBoundary), 'intervention');
  });

  test(`${label}: multiple data points keep the first point baseline and later points treatment`, () => {
    const model = buildClinicalGraphModel(make([
      { x: '2026-06-01', y: 20 },
      { x: '2026-06-03', y: 40 },
      { x: '2026-06-05', y: 60 }
    ]));

    assert.ok(model.phaseBoundary);
    assert.equal(derivedPointPhase(0, model.phaseBoundary), 'baseline');
    assert.equal(derivedPointPhase(1, model.phaseBoundary), 'intervention');
    assert.equal(derivedPointPhase(2, model.phaseBoundary), 'intervention');
  });

  test(`${label}: mastered marker appears only after treatment starts`, () => {
    const treatmentModel = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 20 },
        { x: '2026-06-03', y: 40 },
        { x: '2026-06-05', y: 80 }
      ]),
      { phaseMarkers: targetMasteredMarker('2026-06-03') }
    );

    assert.equal(treatmentModel.phaseMarkers.length, 1);
    assert.equal(treatmentModel.phaseMarkers[0].phaseType, 'targetMastered');
    assert.equal(treatmentModel.phaseMarkers[0].lineStyle, 'dashed');
    assert.equal(treatmentModel.phaseMarkers[0].date, '2026-06-03');

    const baselineModel = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 20 },
        { x: '2026-06-03', y: 40 }
      ]),
      { phaseMarkers: targetMasteredMarker('2026-06-01') }
    );

    assert.deepEqual(baselineModel.phaseMarkers, []);
  });

  test(`${label}: objective-change marker appears only after treatment starts`, () => {
    const treatmentModel = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 5 },
        { x: '2026-06-03', y: 3 },
        { x: '2026-06-05', y: 2 }
      ]),
      { phaseMarkers: objectiveChangeMarker('2026-06-05') }
    );

    assert.equal(treatmentModel.phaseMarkers.length, 1);
    assert.equal(treatmentModel.phaseMarkers[0].phaseType, 'objectiveChange');
    assert.equal(treatmentModel.phaseMarkers[0].lineStyle, 'dashed');

    const baselineModel = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 5 },
        { x: '2026-06-03', y: 3 }
      ]),
      { phaseMarkers: objectiveChangeMarker('2026-06-01') }
    );

    assert.deepEqual(baselineModel.phaseMarkers, []);
  });

  test(`${label}: baseline-condition-change marker may render before treatment`, () => {
    const model = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 5 },
        { x: '2026-06-03', y: 3 }
      ]),
      { phaseMarkers: baselineConditionChangeMarker('2026-06-01') }
    );

    assert.equal(model.phaseMarkers.length, 1);
    assert.equal(model.phaseMarkers[0].phaseType, 'baselineConditionChange');
    assert.equal(model.phaseMarkers[0].lineStyle, 'dashed');
    assert.equal(model.phaseMarkers[0].date, '2026-06-01');
  });

  test(`${label}: custom environmental phase lines can render without changing baseline-to-treatment logic`, () => {
    const model = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 5 },
        { x: '2026-06-03', y: 15 },
        { x: '2026-06-05', y: 25 }
      ]),
      { phaseMarkers: environmentalChangeMarker('2026-06-01', 'solid') }
    );

    assert.ok(model.phaseBoundary);
    assert.equal(model.phaseBoundary.phaseType, 'baselineToTreatment');
    assert.equal(model.phaseMarkers.length, 1);
    assert.equal(model.phaseMarkers[0].phaseType, 'environmentalChange');
    assert.equal(model.phaseMarkers[0].lineStyle, 'solid');
    assert.equal(derivedPointPhase(0, model.phaseBoundary), 'baseline');
    assert.equal(derivedPointPhase(1, model.phaseBoundary), 'intervention');
  });

  test(`${label}: editable treatment phase line can shift the baseline-treatment split`, () => {
    const model = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 5 },
        { x: '2026-06-03', y: 15 },
        { x: '2026-06-05', y: 25 }
      ]),
      {
        treatmentPhaseLine: {
          date: '2026-06-05',
          label: 'Treatment starts later',
          lineStyle: 'dashed',
          phaseType: 'userTreatmentOverride'
        }
      }
    );

    assert.ok(model.phaseBoundary);
    assert.equal(model.phaseBoundary.rightIndex, 2);
    assert.equal(model.phaseBoundary.label, 'Treatment starts later');
    assert.equal(model.phaseBoundary.lineStyle, 'dashed');
    assert.equal(derivedPointPhase(1, model.phaseBoundary), 'baseline');
    assert.equal(derivedPointPhase(2, model.phaseBoundary), 'intervention');
  });

  test(`${label}: hidden treatment phase override suppresses the automatic boundary`, () => {
    const model = buildClinicalGraphModel(
      make([
        { x: '2026-06-01', y: 5 },
        { x: '2026-06-03', y: 15 },
        { x: '2026-06-05', y: 25 }
      ]),
      {
        treatmentPhaseLine: {
          hidden: true,
          label: 'Treatment',
          phaseType: 'userTreatmentOverride'
        }
      }
    );

    assert.equal(model.phaseBoundary, null);
    assert.equal(derivedPointPhase(0, model.phaseBoundary), 'baseline');
    assert.equal(derivedPointPhase(1, model.phaseBoundary), 'baseline');
  });
}

test('grid configuration stays disabled while axes and phase model remain available', () => {
  const model = buildClinicalGraphModel(skillLikeSeries([
    { x: '2026-06-01', y: 10 },
    { x: '2026-06-03', y: 20 }
  ]));

  assert.equal(model.showGridLines, false);
  assert.ok(model.phaseBoundary);
  assert.equal(model.phaseBoundary.label, 'Treatment');
});

test('legend items preserve all target labels for readable HTML legends', () => {
  const legend = buildLegendItems([
    { name: 'What can be full? -> cup', points: [] },
    { name: 'What is shiny? -> spoon', points: [] },
    { name: 'What is dry? -> towel', points: [] }
  ]);

  assert.equal(legend.length, 3);
  assert.deepEqual(legend.map((item) => item.label), [
    'What can be full? -> cup',
    'What is shiny? -> spoon',
    'What is dry? -> towel'
  ]);
});

test('graph date labels include the year in M/D/YYYY format', () => {
  assert.equal(formatGraphDate('2026-05-21'), '5/21/2026');
});

test('all date labels can be preserved when the graph explicitly opts into full labeling', () => {
  const series = behaviorLikeSeries([
    { x: '2026-03-15', y: 18 },
    { x: '2026-04-09', y: 0 },
    { x: '2026-04-10', y: 1 }
  ]);
  const ticks = buildDateTicks(series, { showAllDateLabels: true });
  assert.equal(ticks.length, 3);
  assert.deepEqual(ticks.map((tick) => tick.date), ['2026-03-15', '2026-04-09', '2026-04-10']);
});

test('25 sessions render a readable reduced set of x-axis labels while keeping first and last dates', () => {
  const series = behaviorLikeSeries(Array.from({ length: 25 }, (_, index) => ({
    x: `2026-03-${String(index + 1).padStart(2, '0')}`,
    y: index % 5
  })));
  const ticks = buildDateTicks(series);
  assert.equal(ticks[0].date, '2026-03-01');
  assert.equal(ticks.at(-1).date, '2026-03-25');
  assert.ok(ticks.length < 25);
  assert.ok(ticks.length >= 9);
});

test('75 sessions render approximately 8 to 10 readable x-axis labels while keeping first and last dates', () => {
  const uniqueSeries = [{
    name: 'Behavior frequency',
    points: Array.from({ length: 75 }, (_, index) => ({
      x: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      y: index % 7
    }))
  }];
  const ticks = buildDateTicks(uniqueSeries);
  assert.equal(ticks[0].date, '2026-01-01');
  assert.equal(ticks.at(-1).date, '2026-03-16');
  assert.ok(ticks.length >= 8 && ticks.length <= 12);
});

test('200 sessions render approximately 10 to 15 readable x-axis labels while keeping first and last dates', () => {
  const series = [{
    name: 'Behavior frequency',
    points: Array.from({ length: 200 }, (_, index) => ({
      x: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      y: index % 9
    }))
  }];
  const ticks = buildDateTicks(series);
  assert.equal(ticks[0].date, '2026-01-01');
  assert.equal(ticks.at(-1).date, '2026-07-19');
  assert.ok(ticks.length >= 10 && ticks.length <= 16);
});

test('all-data chart layout uses full plot width without reserving an artificial phase gap', () => {
  const dates = ['2026-04-17', '2026-04-18', '2026-04-20', '2026-04-22', '2026-04-24'];
  const phaseBoundary = {
    date: '2026-04-18',
    leftIndex: 0,
    rightIndex: 1,
    label: 'Treatment',
    lineStyle: 'solid',
    phaseType: 'baselineToTreatment',
    sourceType: 'autoTreatment'
  };
  const layout = buildChartLayout(dates, 56, 600, phaseBoundary, []);
  const positions = layout.dateXPositions;
  const totalSpan = positions.at(-1) - positions[0];
  const treatmentSpan = positions.at(-1) - positions[1];
  const baselineGap = positions[1] - positions[0];

  assert.ok(Number.isFinite(positions[0]));
  assert.ok(Number.isFinite(positions.at(-1)));
  assert.ok(totalSpan > 450);
  assert.ok(treatmentSpan > totalSpan * 0.7);
  assert.ok(baselineGap < totalSpan * 0.2);
});

test('phase dates remain visible when labels are thinned', () => {
  const series = [{
    name: 'Behavior frequency',
    points: Array.from({ length: 75 }, (_, index) => ({
      x: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      y: index % 4
    }))
  }];
  const ticks = buildDateTicks(series, {
    phaseDates: ['2026-02-15']
  });
  assert.ok(ticks.some((tick) => tick.date === '2026-02-15'));
});

test('date range filtering keeps raw points intact while changing the visible data', () => {
  const series = [{
    name: 'Aggression',
    meta: { behaviorId: 'behavior-1' },
    points: [
      { x: '2026-01-01', y: 3 },
      { x: '2026-02-01', y: 2 },
      { x: '2026-03-01', y: 1 }
    ]
  }];
  const filtered = filterSeriesPointsByDateRange(series, {
    startDate: '2026-02-01',
    endDate: '2026-03-01'
  });
  assert.equal(series[0].points.length, 3);
  assert.equal(filtered[0].points.length, 2);
  assert.deepEqual(filtered[0].points.map((point) => point.x), ['2026-02-01', '2026-03-01']);
});

test('graph layout uses responsive width without data-length based canvas sizing while preserving caregiver-training graph support', () => {
  const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const htmlSource = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const chartSource = fs.readFileSync(new URL('../public/charts.js', import.meta.url), 'utf8');
  const stylesSource = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(appSource, /Caregiver Training/);
  assert.match(appSource, /drawParentTrainingChartSet\(sessions, parentTrainingCharts, "parent-training-chart"/);
  assert.match(appSource, /renderCustomPhaseLineManager\(graphKey, chart\.series/);
  assert.match(appSource, /data-delete-parent-point/);
  assert.match(appSource, /parentTrainingSummary/);
  assert.match(appSource, /data-parent-training-analysis/);
  assert.match(appSource, /report-parent-training-charts/);
  assert.match(appSource, /behaviorGraphRangePreset/);
  assert.match(appSource, /behavior-graph-range-preset/);
  assert.match(appSource, /behavior-graph-show-points/);
  assert.match(appSource, /behavior-graph-analyze-all/);
  assert.match(appSource, /function graphTreatmentPhaseLine/);
  assert.match(appSource, /function setPhaseLinesForGraph/);
  assert.match(appSource, /selectTreatmentPhaseRecord\(storedPhaseLinesForGraph\(graphKey\)\)/);
  assert.match(appSource, /setTreatmentPhaseOverrideForGraph\(graphKey, null\)/);
  assert.doesNotMatch(appSource, /deleted:\s*true\s*\}\)\);\s*markReportDraftDirty\(\);\s*await persistGraphPhaseLineUiChange/);
  assert.match(appSource, /await persistGraphPhaseLineUiChange\(\{[\s\S]*successMessage: `Updated treatment phase line "\$\{label\}"\.`/);
  assert.match(appSource, /data-edit-treatment-phase-line/);
  assert.match(appSource, /data-hide-treatment-phase-line/);
  assert.match(appSource, /data-reset-treatment-phase-line/);
  assert.match(appSource, /data-phase-line-kind=\"treatment\"/);
  assert.match(appSource, /Treatment phase line unavailable; baseline\/treatment analysis may be limited\./);
  assert.match(appSource, /showPointMarkers: state\.behaviorGraphShowPoints/);
  assert.match(appSource, /<div class="graph-canvas-scroll">/);
  assert.doesNotMatch(appSource, /showAllDateLabels: true/);
  assert.match(chartSource, /canvas\.style\.width = "100%"/);
  assert.match(chartSource, /canvas\.style\.maxWidth = "100%"/);
  assert.doesNotMatch(chartSource, /dateCount \* DENSE_SCROLL_PIXELS_PER_DATE/);
  assert.doesNotMatch(chartSource, /canvas\.style\.width = `\$\{denseWidth\}px`/);
  assert.match(htmlSource, /id="parent-training-charts"/);
  assert.match(htmlSource, /id="behavior-graph-controls"/);
  assert.match(stylesSource, /\.graph-canvas-scroll\s*\{[\s\S]*width: 100%;[\s\S]*max-width: 100%;/);
  assert.match(stylesSource, /\.graph-canvas-scroll canvas\s*\{[\s\S]*width: 100%;[\s\S]*max-width: 100%;/);
  assert.match(stylesSource, /\.view-switcher\s*\{[\s\S]*flex-wrap: wrap;[\s\S]*overflow-x: visible;/);
});

test('skill graph analysis reports baseline, treatment, trend, and mastery metrics', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Request break',
    meta: { targetId: 'target-1', status: 'mastered' },
    points: [
      { x: '2026-06-01', y: 20 },
      { x: '2026-06-03', y: 40 },
      { x: '2026-06-05', y: 60 },
      { x: '2026-06-07', y: 80 },
      { x: '2026-06-09', y: 90 }
    ]
  }], {
    graphType: 'skill',
    phaseMarkers: [{
      date: '2026-06-09',
      label: 'Target mastered',
      phaseType: 'targetMastered',
      lineStyle: 'dashed',
      targetIds: ['target-1']
    }]
  });

  assert.equal(analysis.graphType, 'skill');
  assert.equal(analysis.analyses.length, 1);
  assert.equal(analysis.analyses[0].baselineAverage, 20);
  assert.equal(analysis.analyses[0].treatmentAverage, 67.5);
  assert.equal(analysis.analyses[0].currentLevel, 90);
  assert.equal(analysis.analyses[0].trendDirection, 'ascending');
  assert.equal(analysis.analyses[0].masteryStatus, 'mastered');
  assert.equal(analysis.analyses[0].sessionsToMastery, 4);
});

test('behavior graph analysis reports reduction, overlap, and immediacy metrics', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Aggression',
    meta: { behaviorId: 'behavior-1' },
    points: [
      { x: '2026-06-01', y: 10 },
      { x: '2026-06-03', y: 8 },
      { x: '2026-06-05', y: 6 },
      { x: '2026-06-07', y: 4 },
      { x: '2026-06-09', y: 2 }
    ]
  }], {
    graphType: 'behavior'
  });

  assert.equal(analysis.graphType, 'behavior');
  assert.equal(analysis.analyses[0].baselineAverage, 10);
  assert.equal(analysis.analyses[0].treatmentAverage, 5);
  assert.equal(analysis.analyses[0].currentLevel, 2);
  assert.equal(analysis.analyses[0].trendDirection, 'decreasing');
  assert.equal(analysis.analyses[0].percentReduction, '50%');
  assert.equal(analysis.analyses[0].overlap, '0%');
  assert.match(analysis.analyses[0].immediacy, /Immediate decrease/);
});

test('behavior interpretation uses increase wording when treatment rises above baseline', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Aggression',
    meta: { behaviorId: 'behavior-1' },
    points: [
      { x: '2026-06-01', y: 5 },
      { x: '2026-06-03', y: 8 },
      { x: '2026-06-05', y: 9 }
    ]
  }], {
    graphType: 'behavior'
  });

  assert.match(analysis.analyses[0].interpretation, /increase from baseline/i);
  assert.doesNotMatch(analysis.analyses[0].interpretation, /-\d+(\.\d+)?% reduction from baseline/i);
});

test('editing the treatment phase line recalculates behavior baseline and treatment metrics', () => {
  const series = [{
    name: 'Aggression',
    meta: { behaviorId: 'behavior-1' },
    points: [
      { x: '2026-06-01', y: 10 },
      { x: '2026-06-03', y: 8 },
      { x: '2026-06-05', y: 4 }
    ]
  }];
  const defaultAnalysis = buildGraphAnalysis(series, { graphType: 'behavior' });
  const shiftedAnalysis = buildGraphAnalysis(series, {
    graphType: 'behavior',
    treatmentPhaseLine: {
      date: '2026-06-05',
      label: 'Treatment',
      lineStyle: 'solid',
      phaseType: 'userTreatmentOverride'
    }
  });

  assert.equal(defaultAnalysis.analyses[0].baselineAverage, 10);
  assert.equal(defaultAnalysis.analyses[0].treatmentAverage, 6);
  assert.equal(shiftedAnalysis.analyses[0].baselineAverage, 9);
  assert.equal(shiftedAnalysis.analyses[0].treatmentAverage, 4);
});

test('graph analysis uses insufficient-data messaging when treatment data are too sparse', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Follow directions',
    points: [
      { x: '2026-06-01', y: 30 },
      { x: '2026-06-03', y: 50 }
    ]
  }], { graphType: 'skill' });

  assert.equal(analysis.analyses[0].baselineLevel, 30);
  assert.equal(analysis.analyses[0].treatmentLevel, 50);
  assert.equal(analysis.analyses[0].difference, 20);
  assert.equal(analysis.analyses[0].trendDirection, 'Unavailable');
  assert.match(analysis.analyses[0].interpretation, /representing a 20-percentage-point improvement/i);
  assert.match(analysis.analyses[0].interpretation, /Interpretation is limited by the small number of data points/i);
  assert.match(analysis.analyses[0].stability, /requires at least 3 treatment data points/i);
});

test('five-session moving average requires at least five points in a phase segment', () => {
  const movingAverage = buildMovingAverageSeriesSet([{
    name: 'Target A',
    points: [
      { x: '2026-06-01', y: 10 },
      { x: '2026-06-03', y: 20 },
      { x: '2026-06-05', y: 30 },
      { x: '2026-06-07', y: 40 }
    ]
  }]);

  assert.deepEqual(movingAverage[0].points, []);
});

test('five-session moving average stays separated by phase boundary', () => {
  const movingAverage = buildMovingAverageSeriesSet([{
    name: 'Target B',
    points: [
      { x: '2026-06-01', y: 10 },
      { x: '2026-06-03', y: 20 },
      { x: '2026-06-05', y: 30 },
      { x: '2026-06-07', y: 40 },
      { x: '2026-06-09', y: 50 },
      { x: '2026-06-11', y: 60 }
    ]
  }]);

  assert.equal(movingAverage[0].points.length, 1);
  assert.equal(movingAverage[0].points[0].x, '2026-06-11');
  assert.equal(movingAverage[0].points[0].phase, 'intervention');
});

test('five-session moving average is calculated independently for each series', () => {
  const movingAverage = buildMovingAverageSeriesSet([
    {
      name: 'Target C',
      points: [
        { x: '2026-06-01', y: 10 },
        { x: '2026-06-03', y: 20 },
        { x: '2026-06-05', y: 30 },
        { x: '2026-06-07', y: 40 },
        { x: '2026-06-09', y: 50 },
        { x: '2026-06-11', y: 60 }
      ]
    },
    {
      name: 'Target D',
      points: [
        { x: '2026-06-01', y: 60 },
        { x: '2026-06-03', y: 50 },
        { x: '2026-06-05', y: 40 },
        { x: '2026-06-07', y: 30 },
        { x: '2026-06-09', y: 20 },
        { x: '2026-06-11', y: 10 }
      ]
    }
  ]);

  assert.equal(movingAverage.length, 2);
  assert.equal(movingAverage[0].points.length, 1);
  assert.equal(movingAverage[1].points.length, 1);
  assert.equal(movingAverage[0].points[0].y, 40);
  assert.equal(movingAverage[1].points[0].y, 30);
});

test('graph analysis identifies trend-line eligibility when a series has five treatment points', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Request attention',
    points: [
      { x: '2026-06-01', y: 10 },
      { x: '2026-06-03', y: 30 },
      { x: '2026-06-05', y: 40 },
      { x: '2026-06-07', y: 50 },
      { x: '2026-06-09', y: 60 },
      { x: '2026-06-11', y: 70 }
    ]
  }], { graphType: 'skill' });

  assert.equal(analysis.trendLineEligible, true);
  assert.equal(analysis.analyses[0].trendLineEligible, true);
  assert.equal(analysis.trendLineMessage, '');
});

test('graph analysis reports trend-line ineligibility when fewer than five treatment points exist', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Tantrums',
    points: [
      { x: '2026-06-01', y: 8 },
      { x: '2026-06-03', y: 6 },
      { x: '2026-06-05', y: 4 },
      { x: '2026-06-07', y: 2 }
    ]
  }], { graphType: 'behavior' });

  assert.equal(analysis.trendLineEligible, false);
  assert.equal(analysis.analyses[0].trendLineEligible, false);
  assert.match(analysis.trendLineMessage, /requires at least 5 data points/i);
});

test('graph UI exposes a trend-line toggle and report insertion action', () => {
  const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appSource, /Show trend line/);
  assert.match(appSource, /data-graph-trend-toggle/);
  assert.match(appSource, /data-insert-graph-analysis/);
  assert.match(appSource, /progressSummary/);
  assert.match(appSource, /syncProgressSummaryField/);
  assert.match(appSource, /data-report-program-analysis/);
  assert.match(appSource, /renderReportGraphAnalysisMarkup/);
  assert.match(appSource, /data-behavior-analysis/);
  assert.doesNotMatch(appSource, /Skill acquisition graph analysis:/);
  assert.doesNotMatch(appSource, /Behavior reduction graph analysis:/);
});

test('app bootstrap lazy-loads session-backed graph data instead of rendering charts during the base render pass', () => {
  const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /await switchView\(requested\.view \|\| currentView\(\)\);/);
  assert.match(appSource, /async function ensureSessionDataForView/);
  assert.match(appSource, /await getClientSessions\(/);
  assert.match(appSource, /await getVisibleSessions\(/);
  assert.doesNotMatch(appSource, /renderHistory\(\);\s+renderCharts\(\);\s+renderNote\(\);/);
});

test('graphs view filters all tabs to the selected date range before chart fan-out and defers analysis rendering', () => {
  const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /const sessions = filterSessionsByGraphRange\(allSessions, range\);/);
  assert.match(appSource, /function filterSessionsByGraphRange\(/);
  assert.match(appSource, /function queueGraphAnalysis\(/);
  assert.match(appSource, /function queueGraphAnalysisBatch\(/);
  assert.match(appSource, /Loading graph analysis\.\.\./);
  assert.match(appSource, /queueGraphAnalysisBatch\(analysisTasks, renderToken\)/);
});

test('graph data managers defer large row lists until the details panel is expanded', () => {
  const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /graphDataManagerRows: \{\}/);
  assert.match(appSource, /addEventListener\("toggle", handleGraphDataManagerToggle, true\)/);
  assert.match(appSource, /function handleGraphDataManagerToggle\(/);
  assert.match(appSource, /Expand to load data points for this graph\./);
  assert.match(appSource, /state\.graphDataManagerRows\[managerId\] = rows;/);
});

test('baseline and treatment comparison calculate with one point in each phase for behavior graphs', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Self-injury',
    points: [
      { x: '2026-06-01', y: 8 },
      { x: '2026-06-03', y: 3 }
    ]
  }], { graphType: 'behavior' });

  assert.equal(analysis.analyses[0].baselineLevel, 8);
  assert.equal(analysis.analyses[0].treatmentLevel, 3);
  assert.equal(analysis.analyses[0].difference, 5);
  assert.equal(analysis.analyses[0].percentReduction, '62.5%');
  assert.equal(analysis.analyses[0].trendDirection, 'Unavailable');
});

test('baseline mean of zero does not cause divide-by-zero errors', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Manding',
    points: [
      { x: '2026-06-01', y: 0 },
      { x: '2026-06-03', y: 20 }
    ]
  }], { graphType: 'skill' });

  assert.equal(analysis.analyses[0].baselineLevel, 0);
  assert.equal(analysis.analyses[0].difference, 20);
  assert.match(String(analysis.analyses[0].percentChange), /Baseline mean is 0/i);
  assert.match(analysis.analyses[0].interpretation, /20-percentage-point increase/i);
});

test('graph analysis panel data remains available when some metrics are unavailable', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Task completion',
    points: [
      { x: '2026-06-01', y: 45 },
      { x: '2026-06-03', y: 50 }
    ]
  }], { graphType: 'skill' });

  assert.equal(analysis.analyses.length, 1);
  assert.equal(analysis.analyses[0].baselineLevel, 45);
  assert.match(analysis.analyses[0].variability, /requires at least 2 data points|low|moderate|high/i);
  assert.match(String(analysis.analyses[0].stability), /requires at least 3 treatment data points/i);
});

test('filtered range can suppress the auto treatment boundary when treatment began earlier', () => {
  const model = buildClinicalGraphModel(behaviorLikeSeries([
    { x: '2026-04-01', y: 4 },
    { x: '2026-04-15', y: 3 }
  ]), { suppressAutoTreatmentBoundary: true });
  assert.equal(model.phaseBoundary, null);
});

test('skill analysis still calculates baseline level when stored phase labels mark the first point as intervention', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Answer WH questions',
    points: [
      { x: '2026-06-01', y: 25, phase: 'intervention' },
      { x: '2026-06-03', y: 55, phase: 'intervention' }
    ]
  }], { graphType: 'skill' });

  assert.equal(analysis.analyses[0].baselineLevel, 25);
  assert.equal(analysis.analyses[0].treatmentLevel, 55);
  assert.match(analysis.analyses[0].interpretation, /Baseline level was 25% based on 1 baseline data point/i);
});

test('behavior analysis still calculates baseline level when stored phase labels mark the first point as intervention', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Aggression',
    points: [
      { x: '2026-06-01', y: 7, phase: 'intervention' },
      { x: '2026-06-03', y: 4, phase: 'intervention' }
    ]
  }], { graphType: 'behavior' });

  assert.equal(analysis.analyses[0].baselineLevel, 7);
  assert.equal(analysis.analyses[0].treatmentLevel, 4);
  assert.match(analysis.analyses[0].interpretation, /Baseline frequency averaged 7 based on 1 baseline data point/i);
});
