import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { graphNumericValue } from '../public/graph-values.js';
import { skillObservationValue, normalizeSkillDataCollectionType } from '../public/session-utils.js';
import { drawLineChart, buildMovingAveragePoints, buildGraphAnalysis, buildClinicalGraphModel } from '../public/charts.js';

const unavailable = [null, undefined, '', ' \t\n', 'not a number', NaN, Infinity, -Infinity, 'Infinity', false, [], {}];
const seriesFor = values => [{ name: 'Synthetic', points: values.map((y,i) => ({ x: `2026-01-${String(i+1).padStart(2,'0')}`, y })) }];
const readSource = file => readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
function extract(source, name) {
  const match = source.match(new RegExp(`^(?:export )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0].replace(/^export /, '');
}

test('graph numeric validation preserves finite values and numeric strings without coercing unavailable values', () => {
  for (const value of unavailable) assert.equal(graphNumericValue(value), null);
  for (const [value, expected] of [[0,0],['0',0],[' 0 ',0],[20.5,20.5],['20.5',20.5],[-3,-3],['-3',-3]]) {
    assert.equal(graphNumericValue(value), expected);
  }
});

test('skill graph values preserve zero counts and zero percent with actual trials, including imported zero', () => {
  for (const value of [0,'0']) {
    assert.equal(skillObservationValue({dataCollectionType:'frequency',frequency:value}),0);
    assert.equal(skillObservationValue({dataCollectionType:'percent_correct',independence:value,trials:5,correct:0}),0);
    assert.equal(skillObservationValue({historicalImportMeasurementType:'percentage',independence:value}),0);
  }
  for (const value of unavailable) {
    assert.equal(skillObservationValue({dataCollectionType:'frequency',frequency:value}),null);
    assert.equal(skillObservationValue({independence:value}),null);
  }
});

test('graph builders retain unavailable dates as gaps and preserve zero and input records', () => {
  const app=readSource('app.js');
  const names=['buildProgramSkillChart','behaviorChartSeries','buildBehaviorChart','buildParentTrainingChartModels'];
  const context=vm.createContext({graphNumericValue,skillObservationValue,normalizeSkillDataCollectionType,
    configuredTargetsForProgram:()=>[{id:'target',name:'Target'}],
    targetEntries:s=>s.programs.flatMap(p=>p.targets.map(t=>({...t,programId:p.programId}))),
    isActualTargetEntry:t=>t.targetId!==t.programId,
    clientBehaviors:()=>[{id:'behavior',name:'Behavior'}],
    behaviorEntriesForSession:s=>s.behaviors,
    parentTrainingGoalKey:()=> 'goal'
  });
  vm.runInContext(names.map(n=>extract(app,n)).join('\n'),context);
  const values=[0,'0',...unavailable];
  const sessions=values.map((value,i)=>({id:`session-${i}`,date:`2026-01-${String(i+1).padStart(2,'0')}`,serviceType:'parent-training',
    programs:[{programId:'program',targets:[{targetId:'target',independence:value,correct:0,trials:5}]}],
    behaviors:[{behaviorId:'behavior',frequency:value}],
    parentGoals:[{goalName:'Goal',targetName:'Target',fidelity:value,opportunities:5,independent:0}]
  }));
  const before=structuredClone(sessions);
  const charts=[context.buildProgramSkillChart({id:'program'},sessions), {series:context.behaviorChartSeries(sessions)}, context.buildBehaviorChart('behavior',sessions), ...context.buildParentTrainingChartModels(sessions)];
  for (const chart of charts) {
    assert.deepEqual(Array.from(chart.series[0].points,p=>p.y),[0,0,...unavailable.map(()=>null)]);
    assert.equal(chart.series[0].points.length,sessions.length);
  }
  assert.deepEqual(sessions,before);
});

test('moving averages exclude unavailable values within the existing window and leave gaps at unavailable dates', () => {
  const points=seriesFor([0,null,20,undefined,40,60,80])[0].points;
  const before=structuredClone(points);
  const result=buildMovingAveragePoints(points);
  assert.deepEqual(result.map(p=>p.y),[0,null,10,null,20,40,50]);
  assert.deepEqual(result.map(p=>p.x),points.map(p=>p.x));
  assert.deepEqual(points,before);
  assert.ok(buildMovingAveragePoints(seriesFor(unavailable)[0].points).every(p=>p.y===null));
});

test('analysis excludes unavailable observations from phase means and current level without changing phase configuration', () => {
  const series=seriesFor([0,null,20,'',40,Infinity,'bad']);
  const options={treatmentPhaseLine:{date:'2026-01-03'},phaseMarkers:[{date:'2026-01-05',phaseType:'targetMastered',label:'Target mastered'}]};
  const before=structuredClone({series,options});
  const model=buildClinicalGraphModel(series,options);
  const analysis=buildGraphAnalysis(series,options);
  assert.equal(analysis.analyses[0].baselineAverage,0);
  assert.equal(analysis.analyses[0].treatmentAverage,30);
  assert.equal(analysis.analyses[0].currentLevel,40);
  assert.deepEqual(analysis.phaseBoundary,model.phaseBoundary);
  assert.deepEqual({series,options},before);
  const empty=buildGraphAnalysis(seriesFor(unavailable),options).analyses[0];
  assert.equal(empty.baselineAverage,null);
  assert.equal(empty.treatmentAverage,null);
  assert.equal(empty.currentLevel,null);
  assert.equal(empty.trendLineEligible,false);
});

test('roundMetric retains zero but rejects blank and non-finite values', () => {
  const context=vm.createContext({graphNumericValue});
  vm.runInContext(extract(readSource('charts.js'),'roundMetric'),context);
  unavailable.forEach(value=>assert.equal(context.roundMetric(value),null));
  assert.equal(context.roundMetric('0'),0);
});

function recorder() {
  const calls={text:[],arcs:[],strokes:[]};
  let path=[], dash=[];
  const ctx={scale(){},clearRect(){},fillRect(){},save(){},restore(){},translate(){},rotate(){},fill(){},
    fillText(value){calls.text.push(String(value));},
    setLineDash(value){dash=value;},
    beginPath(){path=[];},
    moveTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));path.push({x,y});},
    lineTo(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));path.push({x,y});},
    arc(x,y){assert.ok(Number.isFinite(x)&&Number.isFinite(y));calls.arcs.push({x,y});},
    stroke(){calls.strokes.push({path:[...path],color:this.strokeStyle,dash:[...dash]});}
  };
  const canvas={style:{},getContext:()=>ctx,getBoundingClientRect:()=>({width:804,left:0,top:0})};
  return {canvas,calls};
}

test('renderer excludes unavailable values from axes and markers while connecting valid raw and trend points', () => {
  const previousWindow=globalThis.window;
  globalThis.window={devicePixelRatio:1};
  try {
    for (const value of unavailable) {
      const plotted=recorder(), control=recorder();
      const series=seriesFor([0,'0',value,10,20]);
      const before=structuredClone(series);
      drawLineChart(plotted.canvas,series,{showTrendLine:true});
      drawLineChart(control.canvas,seriesFor([0,0,10,20]));
      assert.equal(plotted.calls.arcs.length,4);
      assert.equal(plotted.calls.arcs[0].y,plotted.calls.arcs[1].y);
      const axisLabels=chart=>chart.calls.text.filter(t=>/^\d+$/.test(t));
      assert.deepEqual(axisLabels(plotted),axisLabels(control));
      const strokes=plotted.calls.strokes.filter(s=>s.color==='#167c80');
      assert.equal(strokes.filter(s=>!s.dash.length).length,3);
      assert.equal(strokes.filter(s=>s.dash.length).length,3);
      for (const lines of [strokes.filter(s=>!s.dash.length),strokes.filter(s=>s.dash.length)]) {
        assert.equal(lines[1].path[0].x,plotted.calls.arcs[1].x);
        assert.equal(lines[1].path[1].x,plotted.calls.arcs[2].x);
      }
      assert.deepEqual(series,before);
    }
    const empty=recorder();
    drawLineChart(empty.canvas,seriesFor([0]));
    drawLineChart(empty.canvas,seriesFor(unavailable));
    empty.canvas.onmousemove({clientX:400,clientY:372});
    assert.equal(empty.canvas.title,'');
    assert.ok(empty.calls.text.includes('No session data yet'));
    assert.equal(empty.calls.arcs.length,1,'all-unavailable redraw adds no markers');
  } finally {globalThis.window=previousWindow;}
});

test('missing values retain elapsed spacing and intentional clinical breaks without synthetic observations', () => {
  const previousWindow=globalThis.window;
  globalThis.window={devicePixelRatio:1};
  try {
    const series=[{name:'Synthetic',points:[
      {x:'2026-01-01',y:60},
      {x:'2026-01-02',y:null},
      {x:'2026-01-03',y:80},
      {x:'2026-01-09',y:90}
    ]}];
    const before=structuredClone(series);
    const draw=options=>{
      const chart=recorder();
      drawLineChart(chart.canvas,series,{maxY:100,showTrendLine:true,...options});
      return chart;
    };
    const plain=draw({});
    const arcs=plain.calls.arcs;
    assert.equal(arcs.length,3);
    assert.ok(Math.abs((arcs[1].x-arcs[0].x)/(arcs[2].x-arcs[0].x)-2/8)<1e-9);
    const lines=chart=>chart.calls.strokes.filter(s=>s.color==='#167c80');
    const raw=lines(plain).filter(s=>!s.dash.length);
    assert.deepEqual(raw[0].path,[arcs[0],arcs[1]]);
    assert.equal(lines(plain).filter(s=>s.dash.length).length,2);
    const missingX=arcs[0].x+(arcs[1].x-arcs[0].x)/2;
    plain.canvas.onmousemove({clientX:missingX,clientY:372});
    assert.equal(plain.canvas.title,'');
    // The Treatment boundary still breaks raw lines. The existing rolling
    // trend intentionally spans that boundary and is not changed here.
    const phase=draw({treatmentPhaseLine:{date:'2026-01-02'}});
    assert.equal(lines(phase).filter(s=>!s.dash.length).length,1);
    assert.equal(lines(phase).filter(s=>s.dash.length).length,2);
    assert.deepEqual(lines(phase).filter(s=>!s.dash.length)[0].path,[arcs[1],arcs[2]]);
    // Existing environmental marker discontinuities still break both lines,
    // even when the marker occurs on a missing observation's date.
    const marker=draw({phaseMarkers:[{date:'2026-01-02',label:'Environment',phaseType:'environmentalChange',position:'after-date'}]});
    assert.equal(lines(marker).filter(s=>!s.dash.length).length,1);
    assert.equal(lines(marker).filter(s=>s.dash.length).length,1);
    assert.deepEqual(series,before);
  } finally {globalThis.window=previousWindow;}
});
