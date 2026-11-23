import test from 'node:test';
import assert from 'node:assert/strict';
import {buildClinicalGraphModel,buildClinicalGraphLayout,deriveProgramPhases,drawLineChart,buildStrokeSegments,buildGraphAnalysis,buildChartLayout} from '../public/charts.js';
import {sanitizeClinicalSnapshot,snapshotPhaseConfig} from '../public/report-snapshot.js';
import {buildSkillMeasurementChart} from '../public/skill-graph-measurements.js';
import {behaviorMeasurementGate} from '../public/behavior-graph-measurements.js';
const series=[{name:'A',meta:{targetId:'a'},points:[{x:'2026-01-01',y:0},{x:'2026-01-03',y:50},{x:'2026-01-10',y:90}]}];
const marker=(id,date='2026-01-02',extra={})=>({id,date,label:'Target mastered',phaseType:'targetMastered',targetIds:['a'],...extra});
const layout=(input=series,options={},width=720)=>{const derived=deriveProgramPhases(input,options);return buildClinicalGraphLayout(derived,buildClinicalGraphModel(derived,options),64,width,options.graphType==='behavior'?'calendar':'sequence');};
function render(input,options={}) {
 const strokes=[],labels=[],arcs=[],operations=[];let path=[];
 const ctx={scale(){},clearRect(){},fillRect(){},save(){},restore(){},translate(){},rotate(){},fill(){},setLineDash(v){this.dash=v;},measureText:t=>({width:t.length*6}),
  fillText(t,x){labels.push({t,x});},beginPath(){path=[];},moveTo(x,y){path.push({x,y});},lineTo(x,y){path.push({x,y});},arc(x,y){arcs.push({x,y});operations.push({kind:"point"});},stroke(){operations.push({kind:"stroke",color:this.strokeStyle});strokes.push({color:this.strokeStyle,dash:this.dash||[],path:[...path]});}};
 const canvas={style:{},getContext:()=>ctx,getBoundingClientRect:()=>({width:804,left:0,top:0})};
 const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
 try{drawLineChart(canvas,input,{maxY:100,...options});}finally{globalThis.window=previous;}
 return {canvas,strokes,labels,arcs,operations,layout:canvas.__clinicalGraphLayout};
}
test('events share open intervals with stable deterministic spacing and never intersect any dot',()=>{
 const markers=[marker('b'),marker('a'),marker('c')];
 const a=layout(series,{phaseMarkers:markers}),b=layout(series,{phaseMarkers:[...markers].reverse()});
 assert.equal(new Set(a.events.map(e=>e.renderX)).size,3);
 for(const e of a.events){const interval=a.intervals.find(i=>i.index===e.intervalIndex);assert.ok(e.renderX>interval.left && e.renderX<interval.right);assert.equal(e.renderX,b.events.find(i=>i.id===e.id).renderX);}
 assert.deepEqual(a.observationAnchors.map(p=>p.x),layout().observationAnchors.map(p=>p.x));
});
test('target-specific interval cannot collide with unrelated target observation',()=>{
 const input=[...series,{name:'B',meta:{targetId:'b'},points:[{x:'2026-01-02',y:40}]}];
 const result=layout(input,{phaseMarkers:[marker('a')]});
 assert.equal(result.events.length,1);
 assert.ok(result.observationAnchors.every(p=>p.x!==result.events[0].renderX));
});
test('rendered marker lines, labels, break coordinates and inspection consume the same resolved x',()=>{
 const result=render(series,{phaseMarkers:[marker('environment','2026-01-03',{phaseType:'environmental',label:'Environment'})]});
 const e=result.layout.events[0];
 assert.equal(result.strokes.find(s=>s.color==='#7a4f00').path[0].x,e.renderX);
 assert.equal(result.labels.find(l=>l.t==='Environment').x,e.renderX);
 assert.equal(result.canvas.__graphInspection.groups.flatMap(g=>g.entries).find(e=>e.kind==='marker').x,e.renderX);
 assert.deepEqual(result.layout.markerBreakXs,[e.renderX]);
});
test('mastery clips raw and moving-average strokes without moving source or marker anchors',()=>{
 const options={showTrendLine:true,phaseMarkers:[marker('mastery')]};
 const plain=render(series,{showTrendLine:true}),annotated=render(series,options);
 const x=annotated.layout.events[0].renderX;
 assert.deepEqual(annotated.layout.observationAnchors.map(p=>p.x),plain.layout.observationAnchors.map(p=>p.x));
 assert.equal(x,layout(series,options).events[0].renderX);
 const data=annotated.strokes.filter(s=>s.color==='#167c80');
 for(const dash of [false,true]) {
  const paths=data.filter(s=>Boolean(s.dash.length)===dash).map(s=>s.path);
  const gap=dash?6:6.5;
  assert.ok(paths.some(p=>Math.abs(p.at(-1).x-(x-gap))<1e-9));
  assert.ok(paths.some(p=>Math.abs(p[0].x-(x+gap))<1e-9));
  assert.ok(paths.every(p=>!(p[0].x<x && p.at(-1).x>x)));
 }
});
test('main, modal and snapshot report share geometry for identical data and dimensions',()=>{
 const options={phaseMarkers:[marker('mastery')],treatmentPhaseLine:{date:'2026-01-02'}};
 const snap=sanitizeClinicalSnapshot({version:1,phases:{'skill:p':options}});
 const main=render(series,{...options,layoutMode:'graphs'}),modal=render(series,options),report=render(series,snapshotPhaseConfig(snap,'skill:p'));
 const geometry=r=>({points:r.layout.observationAnchors.map(p=>p.x),events:r.layout.events.map(e=>e.renderX)});
 assert.deepEqual(geometry(main),geometry(modal));assert.deepEqual(geometry(main),geometry(report));
 const data=r=>r.strokes.filter(s=>s.color==='#167c80');
 assert.deepEqual(data(main),data(modal));assert.deepEqual(data(main),data(report));
});
test('explicit targetId wins over conflicting targetIds and survives snapshot normalization',()=>{
 const input=[...series,{name:'B',meta:{targetId:'b'},points:[{x:'2026-01-03',y:40}]}];
 const event=marker('m','2026-01-01',{targetId:'b'});
 const snap=sanitizeClinicalSnapshot({version:1,phases:{p:{phaseMarkers:[event]}}});
 const result=layout(input,snapshotPhaseConfig(snap,'p'));
 const bx=result.observationAnchors.find(p=>p.point.y===40).x;
 assert.ok(result.events[0].renderX>bx);
});
test('behavior keeps calendar spacing and measurement gates; skill keeps shared sequence dates',()=>{
 const behavior=behaviorMeasurementGate(series.map(s=>({...s,points:s.points.map(p=>({...p,measurementType:'frequency'}))})));
 const b=layout(behavior.series,{graphType:'behavior'});
 const dates=series[0].points.map(p=>p.x);
 assert.deepEqual(b.dateXPositions,buildChartLayout(dates,64,720,null,[],'calendar').dateXPositions);
 const skill=buildSkillMeasurementChart({id:'p'},[{id:'a',name:'A'}],series[0].points.map(p=>({...p,targetId:'a',independence:p.y,dataCollectionType:'percent_correct'})));
 const a=layout(skill.series);assert.equal(a.dateXPositions[1]-a.dateXPositions[0],a.dateXPositions[2]-a.dateXPositions[1]);
 assert.equal(buildGraphAnalysis(skill.series).analyses[0].currentLevel,90);
});

test('stroke clipping merges close markers, interpolates slope, and handles endpoint and reversed segments',()=>{
 const points=[{x:0,y:0},{x:100,y:200}];
 assert.deepEqual(buildStrokeSegments(points,[50]),[[{x:0,y:0},{x:45,y:90}],[{x:55.00000000000001,y:110.00000000000001},{x:100,y:200}]]);
 const merged=buildStrokeSegments(points,[52,50,50]);
 assert.equal(merged.length,2);assert.equal(merged[0][1].x,45);assert.ok(Math.abs(merged[1][0].x-57)<1e-9);assert.ok(Math.abs(merged[1][0].y-114)<1e-9);
 for(const input of [points,[...points].reverse()]) {
  const segments=buildStrokeSegments(input,[0,50,52,100]);
  for(const [a,b] of segments) for(const x of [0,50,52,100]) assert.ok(x<Math.min(a.x,b.x) || x>Math.max(a.x,b.x));
 }
 assert.deepEqual(buildStrokeSegments([points[0]],[0]),[]);
 assert.deepEqual(buildStrokeSegments([{x:0,y:0,phase:'baseline'},{x:100,y:20,phase:'intervention'}],[50]),[]);
});

test('mastery generated by one target globally interrupts other targets and later maintenance strokes',()=>{
 const input=[series[0],{...series[0],name:'B',meta:{targetId:'b'}}];
 const plain=render(input,{showTrendLine:true}),result=render(input,{showTrendLine:true,phaseMarkers:[marker('mastery')]});
 const b=r=>r.strokes.filter(s=>s.color==='#d1495b');
 assert.notDeepEqual(b(result),b(plain));
 assert.deepEqual(result.arcs,plain.arcs);
 for(const stroke of [...b(result),...result.strokes.filter(s=>s.color==='#167c80')]) {
  const x=result.layout.events[0].renderX;
  assert.ok(stroke.path.at(-1).x<=x-5 || stroke.path[0].x>=x+5);
 }
 const a=r=>r.strokes.filter(s=>s.color==='#167c80');assert.notDeepEqual(a(result),a(plain));
 assert.deepEqual(result.layout.observationAnchors.map(p=>p.x),plain.layout.observationAnchors.map(p=>p.x));
});

test('dense multiple-marker intervals produce deterministic gaps without changing resolved geometry',()=>{
 const markers=Array.from({length:12},(_,i)=>marker(`m${i}`));
 const a=render(series,{phaseMarkers:markers}),b=render(series,{phaseMarkers:[...markers].reverse()});
 assert.deepEqual(a.strokes.filter(s=>s.color==='#167c80'),b.strokes.filter(s=>s.color==='#167c80'));
 for(const stroke of a.strokes.filter(s=>s.color==='#167c80')) for(const event of a.layout.events) {
  assert.ok(!(stroke.path[0].x<event.renderX && stroke.path.at(-1).x>event.renderX));
 }
});

test('ten crossing target series and their moving averages all exclude the full marker band',()=>{
 const input=Array.from({length:10},(_,i)=>({name:`Target ${i}`,meta:{targetId:`t${i}`},points:[{x:'2026-01-01',y:i+20},{x:'2026-01-10',y:i+60}]}));
 const options={showTrendLine:true,phaseMarkers:[marker('mastery','2026-01-05',{targetIds:['t0']})]};
 const plain=render(input,{showTrendLine:true}),result=render(input,options);
 const x=result.layout.events[0].renderX;
 assert.equal(x,layout(input,options).events[0].renderX);
 assert.deepEqual(result.arcs,plain.arcs);
 const data=result.strokes.filter(s=>s.color!=='#7a4f00' && s.color!=='#1f2933');
 const colors=new Set(plain.strokes.filter(s=>s.path.length===2 && s.path[0].x!==s.path[1].x).map(s=>s.color));
 for(const color of colors) for(const dashed of [false,true]) {
  const strokes=data.filter(s=>s.color===color && Boolean(s.dash.length)===dashed);
  assert.equal(strokes.length,2);
  assert.ok(strokes.every(s=>s.path.at(-1).x<=x-5 || s.path[0].x>=x+5));
 }
 const firstPoint=result.operations.findIndex(o=>o.kind==='point');
 const markerIndex=result.operations.findIndex(o=>o.kind==='stroke' && o.color==='#7a4f00');
 assert.ok(markerIndex>=0 && markerIndex<firstPoint);
 assert.ok(result.operations.slice(markerIndex+1,firstPoint).every(o=>o.kind!=='stroke'));
 assert.ok(result.operations.slice(firstPoint).every(o=>o.kind==='point'));
});

test('exclusion bands clip endpoint-adjacent and vertical strokes even if marker center is outside segment',()=>{
 const segments=buildStrokeSegments([{x:0,y:0},{x:100,y:100}],[-2,102]);
 assert.equal(segments.length,1);
 assert.ok(Math.abs(segments[0][0].x-3)<1e-9 && Math.abs(segments[0][0].y-3)<1e-9);
 assert.deepEqual(segments[0][1],{x:97,y:97});
 assert.deepEqual(buildStrokeSegments([{x:2,y:0},{x:2,y:100}],[0]),[]);
 assert.deepEqual(buildStrokeSegments([{x:0,y:0},{x:2,y:2}],[4]),[]);
 assert.deepEqual(buildStrokeSegments([{x:20,y:40}],[20]),[]);
});

test('many exclusion bands merge without crossed strokes or lost datapoints',()=>{
 const markers=Array.from({length:100},(_,i)=>marker(`dense-${i}`));
 const plain=render(series,{showTrendLine:true}),result=render(series,{showTrendLine:true,phaseMarkers:markers});
 assert.deepEqual(result.arcs,plain.arcs);
 for(const stroke of result.strokes.filter(s=>s.color==='#167c80')) for(const event of result.layout.events) {
  assert.ok(stroke.path.at(-1).x<=event.renderX-5 || stroke.path[0].x>=event.renderX+5);
 }
 assert.deepEqual(result.layout.events.map(e=>e.renderX),layout(series,{phaseMarkers:markers}).events.map(e=>e.renderX));
});
