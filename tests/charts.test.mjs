import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicalGraphModel, buildLegendItems, derivedPointPhase, formatGraphDate } from '../public/charts.js';

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
