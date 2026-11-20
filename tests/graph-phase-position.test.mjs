import test from 'node:test';
import assert from 'node:assert/strict';
import {drawLineChart,buildGraphAnalysis,buildObservationEventPositions} from '../public/charts.js';
const baseline={id:'baseline',date:'2026-11-19',effectiveAt:'2026-11-19T14:30:00.000Z',clinicalPhase:'baseline',phaseType:'environmental',label:'Baseline',initial:true};
const treatment={id:'treatment',date:'2026-11-19',effectiveAt:'2026-11-19T14:45:00.000Z',clinicalPhase:'intervention',phaseType:'environmental',label:'Treatment'};
const point=(y,at='14:35',phaseRecordId='baseline',date='2026-11-19')=>({x:date,y,recordedAt:`${date}T${at}:00.000Z`,phaseRecordId,sessionId:'same-97155'});
function draw(series,markers=[baseline,treatment],extra={}) {
 const strokes=[];let path=[];
 const ctx={scale(){},clearRect(){},fillRect(){},save(){},restore(){},translate(){},rotate(){},fill(){},fillText(){},setLineDash(){},
  beginPath(){path=[];},moveTo(x,y){path.push({x,y});},lineTo(x,y){path.push({x,y});},arc(){},stroke(){strokes.push({color:this.strokeStyle,path:[...path]});}};
 const canvas={style:{},getContext:()=>ctx,getBoundingClientRect:()=>({width:804,left:0,top:0})};
 const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
 try{drawLineChart(canvas,series,{graphType:'skill',maxY:100,phaseMarkers:markers,...extra});}finally{globalThis.window=previous;}
 const entries=canvas.__graphInspection.groups.flatMap(group=>group.entries);
 return {canvas,strokes,points:entries.filter(e=>e.kind==='observation'),markers:entries.filter(e=>e.kind==='marker')};
}

test('single baseline followed by saved treatment start immediately shows a non-overlapping boundary',()=>{
 const series=[{name:'A',points:[point(0)]}];const before=structuredClone({series,baseline,treatment});
 const result=draw(series);
 assert.equal(result.points.length,1);assert.equal(result.points[0].phase,'baseline');
 assert.equal(result.markers.length,1);assert.ok(result.markers[0].x>result.points[0].x+4);
 assert.equal(result.strokes.filter(s=>s.color==='#7a4f00').length,1);
 assert.deepEqual({series,baseline,treatment},before);
});

test('baseline-only program has no invented transition',()=>{
 const result=draw([{name:'A',points:[point(0),point(20,'14:40')]}],[baseline]);
 assert.equal(result.markers.length,0);assert.ok(result.points.every(p=>p.phase==='baseline'));
});

test('later-date treatment point has its boundary after the last baseline and before treatment',()=>{
 const series=[{name:'A',points:[point(0),point(20,'14:40'),point(60,'15:00','treatment','2026-12-20')]}];
 const result=draw(series);const marker=result.markers[0];
 assert.equal(marker.date,treatment.date);assert.equal(marker.effectiveAt,treatment.effectiveAt);
 assert.ok(marker.x>Math.max(...result.points.filter(p=>p.phase==='baseline').map(p=>p.x)));
 assert.ok(marker.x<result.points.find(p=>p.phase==='intervention').x);
 assert.equal(result.strokes.find(s=>s.color==='#7a4f00').path[0].x,marker.x);
});

test('same-date 09:35 baseline and 10:00 treatment surround the 09:45 transition with one inspection date',()=>{
 const series=[{name:'A',points:[point(60,'15:00','treatment'),point(0)]}];
 const result=draw(series,[baseline,treatment],{showTrendLine:true});
 const before=result.points.find(p=>p.phase==='baseline'),after=result.points.find(p=>p.phase==='intervention');
 assert.ok(before.x<result.markers[0].x && result.markers[0].x<after.x);
 assert.equal(result.canvas.__graphInspection.groups.length,1);
 assert.ok(result.points.every(p=>p.date==='2026-11-19'));
 assert.equal(before.source.recordedAt,'2026-11-19T14:35:00.000Z');
 const rolling=result.strokes.filter(s=>s.color==='#167c80');
 assert.ok(rolling.every(s=>s.path.every(p=>Number.isFinite(p.x))));
});

test('phase-record references preserve before/after display order when timestamps tie',()=>{
 const series=[{name:'A',points:[point(0,'14:45'),point(60,'14:45','treatment')]}];
 const result=draw(series);
 assert.ok(result.points[0].x<result.markers[0].x && result.markers[0].x<result.points[1].x);
});

test('multiple targets share one boundary without fabricated baselines; analysis and records stay unchanged',()=>{
 const series=[{name:'A',points:[point(0),point(40,'15:00','treatment')]},
 {name:'B',points:[point(60,'15:05','treatment'),point(70,'15:10','treatment'),point(80,'15:15','treatment')]}];
 const options={phaseMarkers:[baseline,treatment]};const snapshot=structuredClone({series,options});
 const analysis=buildGraphAnalysis(series,options);
 const result=draw(series);const line=result.markers[0];
 assert.equal(result.markers.length,1);
 assert.ok(result.points.filter(p=>p.phase==='baseline').every(p=>p.x<line.x));
 assert.ok(result.points.filter(p=>p.phase==='intervention').every(p=>p.x>line.x));
 assert.equal(analysis.analyses[1].baselineLevel,null);assert.equal(analysis.analyses[1].treatmentLevel,70);
 assert.equal(analysis.analyses[1].trendDirection,'Increasing');
 assert.deepEqual(buildGraphAnalysis(series,options),analysis);assert.deepEqual({series,options},snapshot);
});

test('legacy explicit boundary still classifies dates, and same-date mastery remains after the observations',()=>{
 const series=[{name:'A',points:[point(0),point(60,'15:00','treatment')]}];
 const mastered={date:'2026-11-19',label:'Target mastered',phaseType:'targetMastered',position:'after-date'};
 const result=draw(series,[baseline,treatment,mastered]);
 assert.ok(result.markers.find(m=>m.phaseType==='targetMastered').x>Math.max(...result.points.map(p=>p.x)));
 const legacy=draw([{name:'Legacy',points:[{x:'2026-01-01',y:0},{x:'2026-01-02',y:50}]}],[],{treatmentPhaseLine:{date:'2026-01-02'}});
 assert.deepEqual(legacy.points.map(p=>p.phase),['baseline','intervention']);
 assert.ok(legacy.markers[0].x>legacy.points[0].x && legacy.markers[0].x<legacy.points[1].x);
});

for (const graphType of ['skill','behavior']) {
 test(`${graphType}: timed mastery between same-date observations uses a boundary without changing analysis`,()=>{
  const series=[{name:'A',points:[point(0),point(40,'15:00','treatment'),point(60,'15:30','treatment')]}];
  const mastery={id:'mastery',date:treatment.date,timestamp:'2026-11-19T15:15:00.000Z',label:'Target mastered',phaseType:'targetMastered',position:'after-date'};
  const before=structuredClone(series);
  const result=draw(series,[baseline,treatment,mastery],{graphType});
  const marker=result.markers.find(m=>m.phaseType==='targetMastered');
  assert.ok(result.points[1].x<marker.x && marker.x<result.points[2].x);
  assert.equal(result.canvas.__graphInspection.groups.length,1);
  const a=buildGraphAnalysis(series,{graphType,phaseMarkers:[baseline,treatment]}).analyses[0];
  const b=buildGraphAnalysis(series,{graphType,phaseMarkers:[baseline,treatment,mastery]}).analyses[0];
  for(const field of ['baselineLevel','treatmentLevel','trendDirection','currentLevel','recentPerformance']) assert.deepEqual(b[field],a[field]);
  assert.deepEqual(series,before);
 });
}
test('mastery after final observation and date-only annotation never overlap the final dot',()=>{
 const series=[{name:'A',points:[point(0)]}];
 for(const metadata of [{timestamp:'2026-11-19T14:36:00.000Z'},{}]) {
  const result=draw(series,[{id:'m',date:treatment.date,label:'Target mastered',phaseType:'targetMastered',...metadata}]);
  assert.ok(result.markers[0].x>result.points[0].x);
  assert.equal(result.points[0].phase,null);
 }
});
test('explicit Maintenance and other clinical annotations use the same timed boundary',()=>{
 for(const marker of [{label:'Maintenance',clinicalPhase:'maintenance',phaseType:'environmental'}, {label:'Protocol changed',phaseType:'environmental'}]) {
  const result=draw([{name:'A',points:[point(10),point(20,'15:00')]}],[{id:'event',date:treatment.date,effectiveAt:treatment.effectiveAt,...marker}]);
  assert.ok(result.points[0].x<result.markers[0].x && result.markers[0].x<result.points[1].x);
 }
});

for (const [name,points,event,expected] of [
 ['single observation, same-date mastery',[point(0)],{date:'2026-11-19',phaseType:'targetMastered'},0.5],
 ['single observation, later mastery',[point(0)],{date:'2026-11-20',phaseType:'targetMastered'},0.5],
 ['mastery on final observation date',[point(0),point(40,'15:00')],{date:'2026-11-19',phaseType:'targetMastered'},1.5],
 ['mastery between observations',[point(0),point(40,'15:00')],{date:'2026-11-19',timestamp:treatment.effectiveAt,phaseType:'targetMastered'},0.5],
 ['Treatment between observations',[point(0),point(40,'15:00','treatment')],treatment,0.5],
 ['Treatment after final Baseline',[point(0)],treatment,0.5]
]) test(`integer observation / half-step event coordinates: ${name}`,()=>{
 const marker={label:'Clinical event',...event};const series=[{name:'A',points}];
 const original=structuredClone({series,marker});
 const positions=buildObservationEventPositions(series,[marker]);
 assert.deepEqual(points.map(positions.observationPosition),points.map((_,i)=>i));
 assert.equal(positions.events[0].displayPosition,expected);
 for(const p of points) assert.notEqual(positions.events[0].displayPosition,positions.observationPosition(p));
 const result=draw(series,[baseline,marker]);
 const rendered=result.markers[0];
 assert.ok(rendered.x>result.points[Math.floor(expected)].x);
 if(points.length>Math.ceil(expected)) assert.ok(rendered.x<result.points[Math.ceil(expected)].x);
 assert.ok(result.points.every(p=>p.x!==rendered.x));
 assert.equal(rendered.date,event.date);
 assert.deepEqual({series,marker},original);
});

test('date-only historical Treatment is before the first observation, including a single-point graph',()=>{
 const record={id:'historical',date:'2026-11-19',phaseType:'environmental',clinicalPhase:'intervention',label:'Treatment',historicalDecision:true,baselineBefore:false};
 const result=draw([{name:'A',points:[{x:record.date,y:0}]}],[record]);
 assert.ok(result.markers[0].x<result.points[0].x);
 assert.equal(result.points[0].phase,'intervention');
});
