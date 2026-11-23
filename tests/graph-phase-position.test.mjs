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
 test(`${graphType}: mastery follows all same-date target observations without changing analysis`,()=>{
  const series=[{name:'A',points:[point(0),point(40,'15:00','treatment'),point(60,'15:30','treatment')]}];
  const mastery={id:'mastery',date:treatment.date,timestamp:'2026-11-19T15:15:00.000Z',label:'Target mastered',phaseType:'targetMastered',position:'after-date'};
  const before=structuredClone(series);
  const result=draw(series,[baseline,treatment,mastery],{graphType});
  const marker=result.markers.find(m=>m.phaseType==='targetMastered');
  assert.ok(marker.x>Math.max(...result.points.map(point=>point.x)));
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
 ['mastery follows same-date observations despite earlier timestamp',[point(0),point(40,'15:00')],{date:'2026-11-19',timestamp:treatment.effectiveAt,phaseType:'targetMastered'},1.5],
 ['Treatment between observations',[point(0),point(40,'15:00','treatment')],treatment,0.5],
 ['Treatment after final Baseline',[point(0)],treatment,0.5]
]) test(`frozen date slots with event overlays: ${name}`,()=>{
 const marker={label:'Clinical event',...event};const series=[{name:'A',points}];
 const original=structuredClone({series,marker});
 const positions=buildObservationEventPositions(series,[marker]);
 assert.deepEqual(points.map(positions.observationPosition),points.map(()=>0));
 const without=draw(series,[baseline]);
 const result=draw(series,[baseline,marker]);
 const rendered=result.markers[0];
 assert.deepEqual(result.points.map(p=>p.x),without.points.map(p=>p.x));
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

test('100 observations share ten date slots; mastery and Treatment overlays cannot move data',()=>{
 const dates=Array.from({length:10},(_,i)=>`2026-${String(i+1).padStart(2,'0')}-01`);
 const series=Array.from({length:10},(_,t)=>({name:`Target ${t}`,points:dates.map((x,i)=>({x,y:i*10+t,targetId:`t${t}`}))}));
 const original=structuredClone(series);
 const plain=draw(series,[]);
 assert.equal(new Set(plain.points.map(point=>point.x)).size,10);
 const base=dates.map(date=>plain.points.find(point=>point.date===date).x);
 for(let i=2;i<base.length;i++) assert.ok(Math.abs((base[i]-base[i-1])-(base[1]-base[0]))<1e-9);
 for(const date of dates) assert.equal(new Set(plain.points.filter(point=>point.date===date).map(point=>point.x)).size,1);
 for(const markers of [
  [{date:dates.at(-1),phaseType:'targetMastered',label:'Target mastered',targetIds:['t0']}],
  [{date:dates[4],phaseType:'environmental',clinicalPhase:'intervention',label:'Treatment'}],
  dates.map(date=>({date,phaseType:'targetMastered',label:'Target mastered',targetIds:['t0']}))
 ]) {
  const result=draw(series,markers);
  assert.deepEqual(result.points.map(point=>point.x),plain.points.map(point=>point.x));
  assert.deepEqual(result.canvas.__graphInspection.groups.filter(group=>group.entries.some(entry=>entry.kind==='observation')).length,10);
  assert.ok(result.markers.every(marker=>!result.points.some(point=>point.x===marker.x)));
 }
 for(const target of series) {
  const points=plain.points.filter(p=>p.label===target.name);
  assert.ok(points.every((point,i)=>i===0 || point.x>points[i-1].x));
 }
 assert.deepEqual(series,original);
});

test('single observation stays centered with mastery always bounded to its right',()=>{
 const series=[{name:'A',points:[{x:'2026-07-05',y:50}]}];
 const plain=draw(series,[]);const x=plain.points[0].x;
 assert.equal(x,424,'normal single-point plot center');
 for(const [date,direction] of [['2026-07-01',1],['2026-07-05',1],['2026-07-10',1]]) {
  const result=draw(series,[{date,label:'Target mastered',phaseType:'targetMastered'}]);
  assert.equal(result.points[0].x,x);
  const offset=result.markers[0].x-x;
  assert.ok(offset*direction>0 && Math.abs(offset)<=16);
 }
});

test('between-date events use frozen midpoint; final events use bounded offset; analytics remain unchanged',()=>{
 const series=[{name:'A',points:[{x:'2026-07-01',y:0},{x:'2026-08-01',y:50},{x:'2026-09-01',y:80}]}];
 const phases=[{date:'2026-07-01',label:'Treatment',clinicalPhase:'intervention',phaseType:'environmental',historicalDecision:true,baselineBefore:false}];
 const before=buildGraphAnalysis(series,{phaseMarkers:phases});
 const markers=[...phases,{date:'2026-07-15',label:'Target mastered',phaseType:'targetMastered'},{date:'2026-09-01',label:'Target mastered',phaseType:'targetMastered'}];
 const plain=draw(series,phases),result=draw(series,markers);
 assert.deepEqual(result.points.map(p=>p.x),plain.points.map(p=>p.x));
 assert.equal(result.markers[1].x,(result.points[0].x+result.points[1].x)/2);
 assert.ok(result.markers[2].x>result.points[2].x && result.markers[2].x-result.points[2].x<=16);
 assert.deepEqual(buildGraphAnalysis(series,{phaseMarkers:phases}),before);
 const after=buildGraphAnalysis(series,{phaseMarkers:markers});
 for(const key of ['baselineLevel','treatmentLevel','currentLevel','recentPerformance','trendDirection']) assert.deepEqual(after.analyses[0][key],before.analyses[0][key]);
});

test('intraday offsets are small, metadata-driven, and invariant under event additions',()=>{
 const series=[{name:'A',points:[point(0),point(60,'15:00','treatment')]},
  {name:'B',points:[{x:'2026-11-19',y:30,targetId:'b'}]}];
 const plain=draw(series,[]),result=draw(series,[baseline,treatment]);
 assert.deepEqual(result.points.map(p=>p.x),plain.points.map(p=>p.x));
 assert.equal(result.points[2].x,424,'untimed target stays at the shared date center');
 assert.ok(result.points.every(p=>Math.abs(p.x-424)<=12));
 assert.ok(result.points[0].x<result.markers[0].x && result.markers[0].x<result.points[1].x);
 assert.equal(result.canvas.__graphInspection.groups.length,1);
});

for(const timestamp of ['2026-11-19T14:00:00.000Z','2026-11-19T16:00:00.000Z']) test(`one-point mastery follows its target despite save time ${timestamp}`,()=>{
 const series=[{name:'A',meta:{targetId:'a'},points:[{...point(80),targetId:'a'}]}];
 const marker={date:'2026-11-19',label:'Target mastered',phaseType:'targetMastered',targetIds:['a'],timestamp,masteredAt:timestamp};
 const before=structuredClone({series,marker});const plain=draw(series,[]),result=draw(series,[marker]);
 assert.equal(result.markers.length,1);
 assert.equal(result.points[0].x,424);
 assert.equal(result.points[0].x,plain.points[0].x);
 assert.ok(result.markers[0].x>result.points[0].x && result.markers[0].x-result.points[0].x<=16);
 assert.deepEqual({series,marker},before);
});

test('mastery follows every same-day target observation but precedes later maintenance data',()=>{
 const series=[{name:'A',meta:{targetId:'a'},points:[point(50),point(80,'15:00'),point(90,'16:00'),point(95,'14:00','','2026-11-20')]}];
 const marker={date:'2026-11-19',label:'Target mastered',phaseType:'targetMastered',targetId:'a',timestamp:'2026-11-19T14:00:00.000Z'};
 const plain=draw(series,[]),result=draw(series,[marker]);
 assert.equal(result.markers.length,1);
 assert.ok(result.points.slice(0,3).every(p=>p.x<result.markers[0].x));
 assert.ok(result.points[3].x>result.markers[0].x);
 assert.deepEqual(result.points.map(p=>p.x),plain.points.map(p=>p.x));
 assert.equal(result.canvas.__graphInspection.groups.length,2);
});

test('Target A mastery uses only A observations, not later same-day Target B observations',()=>{
 const series=[{name:'A',meta:{targetId:'a'},points:[point(80)]},{name:'B',meta:{targetId:'b'},points:[point(70,'16:00')]}];
 const marker={date:'2026-11-19',label:'Target mastered',phaseType:'targetMastered',targetIds:['a'],timestamp:'2026-11-19T13:00:00.000Z'};
 const plain=draw(series,[]),result=draw(series,[marker]);
 assert.equal(result.markers.length,1);
 assert.ok(result.markers[0].x>result.points[0].x);
 assert.ok(result.markers[0].x<result.points[1].x,'B must not move mastery after B');
 assert.ok(result.markers[0].x-result.points[0].x<=16);
 assert.deepEqual(result.points.map(p=>p.x),plain.points.map(p=>p.x));
});

test('legacy mastery association resolves unique target names and does not guess ambiguous targets',()=>{
 const series=[{name:'A',meta:{targetId:'a'},points:[point(80)]},{name:'B',meta:{targetId:'b'},points:[point(70,'16:00')]}];
 const marker={date:'2026-11-19',label:'Target mastered',phaseType:'objectiveChange',targetName:'A',timestamp:'2026-11-19T13:00:00.000Z'};
 const named=draw(series,[marker]),identified=draw(series,[{...marker,targetIds:['a']}]);
 assert.equal(named.markers.length,1);assert.equal(named.markers[0].x,identified.markers[0].x);
 assert.equal(draw(series,[{...marker,targetName:'',detail:''}]).markers.length,0);
 assert.equal(draw(series,[{...marker,targetIds:['absent']}]).markers.length,0,'explicit IDs cannot be overridden by a name');
 assert.equal(draw([{...series[0],name:'Same'},{...series[1],name:'Same'}],[{...marker,targetName:'Same'}]).markers.length,0);
});

test('mastery source preserves target association and timestamp without changing status history',async()=>{
 const {readFileSync}=await import('node:fs');const {default:vm}=await import('node:vm');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const source=app.match(/^function masteryMarkersForProgram\([^\n]*\{[\s\S]*?^}/m)[0];
 const history=[{id:'m',programId:'p',targetId:'a',targetName:'A',type:'target-status-changed',toStatus:'mastered',date:'2026-11-19',timestamp:'2026-11-19T13:00:00.000Z'}];
 const before=structuredClone(history),sandbox={currentClient:()=>({planChangeLog:history})};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const marker=sandbox.masteryMarkersForProgram('p')[0];
 assert.equal(marker.targetIds[0],'a');assert.equal(marker.targetName,'A');assert.equal(marker.timestamp,history[0].timestamp);
 assert.deepEqual(history,before);
});

test('legacy mastery before all target data clamps after earliest observation, preserving date and later data',()=>{
 const series=[{name:'A',meta:{targetId:'a'},points:[{x:'2026-07-05',y:80},{x:'2026-07-10',y:90},{x:'2026-07-15',y:95}]}];
 const marker={date:'2026-07-01',label:'Target mastered',phaseType:'targetMastered',targetIds:['a']};
 const original=structuredClone({series,marker});
 const plain=draw(series,[]),result=draw(series,[marker]);
 assert.equal(result.markers.length,1);
 assert.equal(result.markers[0].date,'2026-07-01');
 assert.ok(result.markers[0].x>result.points[0].x);
 assert.ok(result.markers[0].x-result.points[0].x<=16);
 assert.ok(result.points.slice(1).every(point=>point.x>result.markers[0].x));
 assert.deepEqual(result.points.map(point=>point.x),plain.points.map(point=>point.x));
 assert.deepEqual({series,marker},original);
});

test('one valid target observation clamps mastery right despite missing entries and unrelated target data',()=>{
 const series=[{name:'A',meta:{targetId:'a'},points:[{x:'2026-07-01',y:null},{x:'2026-07-05',y:80}]},
  {name:'B',meta:{targetId:'b'},points:[{x:'2026-07-01',y:30},{x:'2026-07-10',y:70}]}];
 for(const date of ['2026-06-01','2026-07-05']) {
  const marker={date,label:'Target mastered',phaseType:'targetMastered',targetIds:['a']};
  const plain=draw(series,[]),result=draw(series,[marker]);
  const target=result.points.find(point=>point.label==='A');
  assert.equal(result.markers.length,1);
  assert.ok(result.markers[0].x>target.x && result.markers[0].x-target.x<=16);
  assert.equal(result.markers[0].date,date);
  assert.deepEqual(result.points.map(point=>point.x),plain.points.map(point=>point.x));
 }
});
