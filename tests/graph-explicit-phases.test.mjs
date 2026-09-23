import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildClinicalGraphModel, classifySeriesPointPhase, buildMovingAverageSeriesSet, buildGraphAnalysis, buildChartLayout } from '../public/charts.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const series = [{ name: 'Synthetic target', points: [
  { x: '2026-01-01', y: 0, phase: 'baseline' },
  { x: '2026-01-03', y: 30, phase: 'intervention' },
  { x: '2026-01-05', y: 50 },
  { x: '2026-01-08', y: 80 }
] }];
const phases = model => series[0].points.map((point,i) => classifySeriesPointPhase(point,i,model.phaseBoundary,model.dates));
const line = { id:'saved-treatment', date:'2026-01-04', label:'Treatment', lineStyle:'dashed', sourceType:'userTreatmentOverride' };

test('unconfigured observations remain unclassified, including the first observation and legacy point phase tags', () => {
  const before=structuredClone(series), model=buildClinicalGraphModel(series);
  assert.equal(model.phaseBoundary,null);
  assert.deepEqual(phases(model),[null,null,null,null]);
  const analysis=buildGraphAnalysis(series).analyses[0];
  assert.equal(analysis.baselineAvailable,false);
  assert.equal(analysis.treatmentAvailable,false);
  assert.equal(analysis.currentLevel,80);
  assert.deepEqual(series,before);
});

test('explicit stored date controls classification; multiple configured marker lines retain their dates and meanings', () => {
  const markers=[
    {id:'baseline-change',date:'2026-01-02',label:'Baseline condition change',phaseType:'baselineConditionChange',position:'date'},
    {id:'environment',date:'2026-01-06',label:'Environment change',phaseType:'environmentalChange',position:'date'},
    {id:'mastery',date:'2026-01-08',label:'Target mastered',phaseType:'targetMastered',position:'after-date'}
  ];
  const options={treatmentPhaseLine:line,phaseMarkers:markers};
  const before=structuredClone({series,options});
  const model=buildClinicalGraphModel(series,options);
  assert.equal(model.phaseBoundary.configuredDate,line.date);
  assert.equal(model.phaseBoundary.lineStyle,'dashed');
  assert.deepEqual(phases(model),['baseline','baseline','intervention','intervention']);
  assert.deepEqual(model.phaseMarkers.map(m=>[m.id,m.date,m.phaseType]),markers.map(m=>[m.id,m.date,m.phaseType]));
  assert.deepEqual({series,options},before);
  const layout=buildChartLayout(model.dates,64,956,model.phaseBoundary,model.phaseMarkers);
  const noPhases=buildChartLayout(model.dates,64,956,null,[]);
  assert.deepEqual(layout.dateXPositions,noPhases.dateXPositions);
});

test('stored boundaries outside the displayed range still classify by their configured dates without a fabricated in-range boundary', () => {
  for (const [date,expected] of [['2025-12-31','intervention'],['2026-02-01','baseline']]) {
    const model=buildClinicalGraphModel(series,{treatmentPhaseLine:{...line,date}});
    assert.deepEqual(phases(model),Array(4).fill(expected));
  }
});

test('removing implicit phases does not drop or move mastery and objective markers or change moving-average values', () => {
  const markers=[{date:'2026-01-05',label:'Objective changed',phaseType:'objectiveChange',position:'after-date'}, {date:'2026-01-08',label:'Target mastered',phaseType:'targetMastered',position:'after-date'}];
  const before=structuredClone(markers);
  const unconfigured=buildClinicalGraphModel(series,{phaseMarkers:markers});
  const explicit=buildClinicalGraphModel(series,{phaseMarkers:markers,treatmentPhaseLine:{...line,date:'2026-01-03'}});
  assert.deepEqual(unconfigured.phaseMarkers,explicit.phaseMarkers);
  assert.deepEqual(markers,before);
  const plain=buildMovingAverageSeriesSet(series);
  const configured=buildMovingAverageSeriesSet(series,{phaseBoundary:explicit.phaseBoundary});
  assert.deepEqual(plain[0].points.map(p=>p.y),[0,15,26.7,40]);
  assert.deepEqual(configured[0].points.map(p=>p.y),plain[0].points.map(p=>p.y));
});

test('app phase lookup is read-only, returns no default and honors existing user and legacy-auto records', () => {
  const names=['selectTreatmentPhaseRecord','treatmentPhaseRecordForGraph','graphTreatmentPhaseLine'];
  const functions=names.map(name=>{
    const match=app.match(new RegExp(`^function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'));
    assert.ok(match,name); return match[0];
  }).join('\n');
  for (const source of [null,'user','auto']) {
    const records=source ? [{id:'saved',phaseType:'treatment',date:'2026-01-04',label:'Stored label',source,lineStyle:'dashed',note:'Keep',updatedAt:'2026-01-09'}] : [];
    const before=structuredClone(records);
    const context=vm.createContext({storedPhaseLinesForGraph:()=>records});
    vm.runInContext(functions,context);
    const result=context.graphTreatmentPhaseLine('skill:synthetic',series);
    assert.deepEqual(records,before);
    if (!source) assert.equal(result,null);
    else {
      assert.equal(result.date,records[0].date);
      assert.equal(result.label,records[0].label);
      const model=buildClinicalGraphModel(series,{treatmentPhaseLine:result});
      assert.deepEqual(phases(model),['baseline','baseline','intervention','intervention']);
    }
  }
  assert.doesNotMatch(app,/ensurePersistedTreatmentPhaseLine|persistMissingTreatmentPhaseLines|source: "auto"/);
  assert.doesNotMatch(app,/first observation as baseline|default baseline-to-treatment rule/);
  assert.match(app,/Add treatment phase line/);
});
