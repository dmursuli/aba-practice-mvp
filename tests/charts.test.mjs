import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildClinicalGraphModel,
  buildGraphAnalysis,
  buildLegendItems,
  buildMovingAverageSeriesSet,
  derivedPointPhase,
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

test('graph analysis uses insufficient-data messaging when treatment data are too sparse', () => {
  const analysis = buildGraphAnalysis([{
    name: 'Follow directions',
    points: [
      { x: '2026-06-01', y: 30 },
      { x: '2026-06-03', y: 50 }
    ]
  }], { graphType: 'skill' });

  assert.equal(analysis.analyses[0].trendDirection, 'flat');
  assert.match(analysis.analyses[0].interpretation, /Insufficient data for stable trend interpretation/);
  assert.equal(analysis.analyses[0].stability, 'unstable');
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
});
