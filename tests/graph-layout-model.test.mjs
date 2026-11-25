import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMarkerLabels,buildClinicalGraphModel,buildClinicalGraphLayout,deriveProgramPhases,drawLineChart,buildStrokeSegments,buildGraphAnalysis,buildChartLayout} from '../public/charts.js';
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
 assert.equal(buildGraphAnalysis(skill.series).analyses[0].currentLevel,null);
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

for (const count of [1,3,4]) test(`${count} nearby mastery markers render one centered cluster label`,()=>{
 const markers=Array.from({length:count},(_,i)=>marker(`m${i}`,'2026-01-02',{renderX:100+i*20,targetIds:[`t${i}`]}));
 const before=structuredClone(markers);
 const labels=buildMarkerLabels(markers,text=>text.length*6);
 assert.equal(labels.length,1);
 assert.equal(labels[0].text,'Target mastered');
 assert.equal(labels[0].anchorX,(markers[0].renderX+markers.at(-1).renderX)/2);
 assert.deepEqual(markers,before);
 for(const layoutMode of [undefined,'graphs']) {
  const result=render(series,{layoutMode,phaseMarkers:markers.map(m=>({...m,targetIds:['a']}))});
  assert.equal(result.labels.filter(l=>l.t==='Target mastered').length,1);
  assert.equal(result.strokes.filter(s=>s.color==='#7a4f00').length,count);
 }
});
test('mastery label clusters use resolved pixels, measured width and spacing, not dates or target IDs',()=>{
 const markers=[marker('a','2026-01-01',{renderX:100}),marker('b','2026-02-01',{renderX:120}),
  marker('c','2026-01-01',{renderX:400}),marker('d','2026-01-01',{renderX:420})];
 const labels=buildMarkerLabels(markers,text=>text.length*6);
 assert.deepEqual(labels.map(l=>l.anchorX),[110,410]);
 assert.ok(labels[1].anchorX-labels[0].anchorX>84+12);
 assert.deepEqual(buildMarkerLabels([...markers].reverse(),text=>text.length*6),labels);
 assert.equal(buildMarkerLabels(markers,()=>400).length,1);
});
for(const layoutMode of [undefined,'graphs']) test(`shared ${layoutMode || 'report/modal'} renderer keeps every mastery line, association and exclusion band`,()=>{
 const markers=[marker('a','2026-01-01'),marker('b','2026-01-01'),marker('c','2026-01-01'),
  marker('d','2026-01-10'),marker('e','2026-01-10'),
  marker('treatment','2026-01-03',{phaseType:'environmental',clinicalPhase:'intervention',label:'Treatment'}),
  marker('custom','2026-01-03',{phaseType:'environmental',label:'Environment'})];
 const options={phaseMarkers:markers,layoutMode,showTrendLine:true};
 const before=structuredClone({series,options});
 const result=render(series,options);
 assert.equal(result.labels.filter(l=>l.t==='Target mastered').length,2);
 assert.equal(result.labels.filter(l=>l.t==='Treatment').length,1);
 assert.equal(result.labels.filter(l=>l.t==='Environment').length,1);
 assert.equal(result.strokes.filter(s=>s.color==='#7a4f00').length,markers.length);
 const expected=layout(series,options);
 assert.deepEqual(result.layout.events.map(e=>[e.id,e.renderX,e.targetIds]),expected.events.map(e=>[e.id,e.renderX,e.targetIds]));
 assert.deepEqual(result.layout.markerBreakXs,expected.markerBreakXs);
 const inspected=result.canvas.__graphInspection.groups.flatMap(g=>g.entries).filter(e=>e.kind==='marker');
 assert.equal(inspected.length,markers.length);
 for(const event of result.layout.events) {
  assert.ok(inspected.some(entry=>entry.x===event.renderX));
 }
 // A distinct label on each of the same mastery markers bypasses de-duplication.
 // Plot dimensions, points, marker lines, and clipped data strokes must match.
 const unique=render(series,{...options,phaseMarkers:markers.map(m=>m.label==='Target mastered'?{...m,label:`Mastery ${m.id}`} : m)});
 assert.deepEqual(result.arcs,unique.arcs);
 assert.deepEqual(result.strokes.filter(s=>s.color!=='#a6aeb5'),unique.strokes.filter(s=>s.color!=='#a6aeb5'));
 assert.deepEqual(buildGraphAnalysis(series,options),buildGraphAnalysis(series,before.options));
 assert.deepEqual({series,options},before);
});

test('explicit one-date historical Treatment occupies the interval after all Baseline observations',async()=>{
 const {applyProgramClinicalAction,programPhaseRecords}=await import('../lib/program-phase-workflow.mjs');
 const client={id:'c',programs:[{id:'p',targets:[{id:'a'},{id:'b'}]}],profile:{graphPhaseLines:{}}};
 const db={clients:[client],sessions:[{id:'s',clientId:'c',date:'2026-01-01',programs:[{programId:'p',targets:[
  {targetId:'a',independence:20},{targetId:'b',independence:40,recordedAt:'2026-01-01T23:59:00Z'}
 ]}]}]};
 const before=structuredClone(db.sessions);
 applyProgramClinicalAction(db,'c','p',{action:'classify-historical',boundaryMode:'first',baselineBefore:false,confirmed:true,
  sessionContext:{clientId:'c',sessionId:'active',sessionDate:'2026-11-19'}},{id:'bcba',role:'bcba'},'2026-11-19T15:00:00Z');
 const markers=programPhaseRecords(client,'p');
 const input=db.sessions[0].programs[0].targets.map(p=>({name:p.targetId,meta:{targetId:p.targetId},points:[{x:'2026-01-01',y:p.independence,recordedAt:p.recordedAt}]}));
 const result=render(input,{phaseMarkers:markers});
 const bare=render(input);
 assert.deepEqual(result.layout.observationAnchors.map(p=>p.x),bare.layout.observationAnchors.map(p=>p.x));
 assert.equal(result.layout.events.length,1);
 const treatment=result.layout.events[0];
 assert.ok(result.layout.observationAnchors.every(p=>p.x<treatment.renderX));
 assert.equal(result.layout.observationAnchors[0].x,424);
 assert.equal(treatment.renderX,438);
 assert.equal(result.labels.filter(l=>l.t==='Treatment').length,1);
 const inspection=result.canvas.__graphInspection.groups.flatMap(g=>g.entries);
 assert.ok(inspection.filter(e=>e.kind==='observation').every(e=>e.phase==='baseline'));
 assert.deepEqual(db.sessions,before);
 // A historical date-boundary record without the explicit timed after-date
 // designation keeps the existing before-observation positioning.
 const legacy=render(input,{phaseMarkers:[{...markers[1],effectiveAt:undefined,position:undefined}]});
 assert.equal(legacy.layout.events[0].renderX,410);
 const future=render([...input,{name:'Future',points:[{x:'2026-11-20',y:70,phaseRecordId:markers[1].id}]}],{phaseMarkers:markers});
 const boundary=future.layout.events[0].renderX;
 assert.ok(future.layout.observationAnchors.filter(p=>p.point.x==='2026-01-01').every(p=>p.x<boundary));
 assert.ok(future.layout.observationAnchors.filter(p=>p.point.x==='2026-11-20').every(p=>p.x>boundary));
});

for(const count of [1,3]) test(`historical Treatment marker follows all ${count} same-date observations resolved as Baseline`,()=>{
 const phaseMarkers=[
  {id:'baseline',date:'2026-01-01',label:'Baseline',clinicalPhase:'baseline',initial:true},
  {id:'treatment',date:'2026-01-02',label:'Treatment',clinicalPhase:'intervention',historicalDecision:true,baselineBefore:true}
 ];
 const input=[{name:'A',points:[
  ...Array.from({length:count},(_,i)=>({x:'2026-01-02',y:20+i*5,phaseRecordId:'baseline',...(i?{recordedAt:`2026-01-02T0${i}:00:00Z`}:{})})),
  {x:'2026-01-03',y:60,phaseRecordId:'treatment'}
 ]}];
 const before=structuredClone({input,phaseMarkers});
 const result=render(input,{phaseMarkers});
 const markerX=result.layout.events[0].renderX;
 const baseline=result.layout.observationAnchors.filter(p=>p.point.effectiveProgramPhase==='baseline');
 const treatment=result.layout.observationAnchors.filter(p=>p.point.effectiveProgramPhase==='intervention');
 assert.equal(baseline.length,count);
 assert.ok(baseline.every(p=>p.x<markerX));
 assert.ok(treatment.every(p=>p.x>markerX));
 assert.deepEqual(result.layout.observationAnchors.map(p=>p.x),render(input).layout.observationAnchors.map(p=>p.x));
 if(count===1) {assert.equal(baseline[0].x,92);assert.equal(markerX,424);assert.equal(treatment[0].x,756);}
 assert.deepEqual({input,phaseMarkers},before);
});

test('same-date future Treatment without a phase link follows the historical boundary by resolved classification',()=>{
 const phaseMarkers=[
  {id:'b',date:'2026-01-01',label:'Baseline',clinicalPhase:'baseline',initial:true},
  {id:'t',date:'2026-01-01',label:'Treatment',clinicalPhase:'intervention',historicalDecision:true,baselineBefore:true,
   effectiveAt:'2026-01-01T12:00:00Z',position:'after-date'}
 ];
 const input=[{name:'A',points:[{x:'2026-01-01',y:20,recordedAt:'2026-01-01T09:00:00Z'},
  {x:'2026-01-01',y:60,recordedAt:'2026-01-01T15:00:00Z'}]}];
 const result=render(input,{phaseMarkers});
 assert.equal(result.layout.events.length,1);
 const markerX=result.layout.events[0].renderX;
 assert.ok(result.layout.observationAnchors[0].x<markerX);
 assert.ok(result.layout.observationAnchors[1].x>markerX);
 assert.deepEqual(result.layout.observationAnchors.map(p=>p.point.effectiveProgramPhase),['baseline','intervention']);
});

for(const layoutMode of [undefined,'graphs']) for(const source of ['marker','boundary']) {
 test(`earlier Treatment ${source} is invisible in ${layoutMode || 'standard'} charts without reclassifying data`,()=>{
  const input=[{name:'Later target',points:[{x:'2026-07-06',y:20},{x:'2026-07-14',y:60}]}];
  const transition={id:'t',date:'2026-05-15',label:'Treatment',clinicalPhase:'intervention'};
  const options={layoutMode,...(source==='marker'?{phaseMarkers:[transition]}:{treatmentPhaseLine:transition})};
  const before=structuredClone({input,options});
  const analysis=buildGraphAnalysis(input,options);
  const result=render(input,options);
  assert.equal(result.layout.events.length,0);assert.equal(result.layout.phaseBoundary,null);
  assert.equal(result.strokes.filter(s=>s.color==='#7a4f00').length,0);
  assert.equal(result.labels.filter(l=>l.t==='Treatment').length,0);
  assert.ok(result.canvas.__graphInspection.groups.flatMap(g=>g.entries).filter(e=>e.kind==='observation').every(e=>e.phase==='intervention'));
  assert.deepEqual(result.layout.observationAnchors.map(p=>p.x),render(input).layout.observationAnchors.map(p=>p.x));
  assert.deepEqual(buildGraphAnalysis(input,options),analysis);
  assert.equal(analysis.analyses[0].baselineLevel,null);assert.equal(analysis.analyses[0].treatmentLevel,40);
  assert.deepEqual({input,options},before);
 });
}
test('visibility preserves other marker geometry, labels and raw-series coordinates',()=>{
 const transition={id:'t',date:'2025-12-01',label:'Treatment',clinicalPhase:'intervention'};
 const companions=[marker('m','2026-01-02'),marker('m2','2026-01-02'),
  {id:'environment',date:'2025-12-01',label:'Environment',phaseType:'environmental'}];
 for(const layoutMode of [undefined,'graphs']) {
  const result=render(series,{layoutMode,phaseMarkers:[...companions,transition]});
  // Same geometry with the old line represented as a custom annotation, which
  // must remain visible and reserve the same label space and peer interval.
  const control=render(series,{layoutMode,phaseMarkers:[...companions,{...transition,clinicalPhase:'',label:'EarlierTx',phaseType:'environmental'}]});
  for(const id of ['m','m2','environment']) assert.equal(result.layout.events.find(e=>e.id===id).renderX,control.layout.events.find(e=>e.id===id).renderX);
  assert.deepEqual(result.arcs,control.arcs);
  assert.equal(result.labels.filter(l=>l.t==='Target mastered').length,control.labels.filter(l=>l.t==='Target mastered').length);
  assert.equal(result.labels.filter(l=>l.t==='Environment').length,1);
  assert.deepEqual(result.strokes.filter(s=>s.color==='#167c80'),control.strokes.filter(s=>s.color==='#167c80'));
 }
});
test('missing observations do not expand the plotted Treatment visibility domain',()=>{
 const input=[{name:'A',points:[{x:'2026-01-01',y:null},{x:'2026-07-06',y:60}]}];
 const result=render(input,{phaseMarkers:[{date:'2026-05-15',label:'Treatment'}]});
 assert.equal(result.layout.events.length,0);
});
test('known same-day transition before every plotted timestamp is hidden; date-only same-day boundary remains',()=>{
 const record={date:'2026-07-06',effectiveAt:'2026-07-06T09:00:00Z',label:'Treatment',clinicalPhase:'intervention'};
 const points=[{x:record.date,y:40,recordedAt:'2026-07-06T10:00:00Z'}];
 assert.equal(render([{name:'A',points}],{phaseMarkers:[record]}).layout.events.length,0);
 assert.equal(render([{name:'A',points:[{x:record.date,y:40}]}],{phaseMarkers:[{...record,effectiveAt:undefined}]}).layout.events.length,1);
});
