import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildGraphAnalysis, buildChartLayout, deriveProgramPhases, buildClinicalGraphModel } from '../public/charts.js';
import { buildSkillMeasurementChart } from '../public/skill-graph-measurements.js';
import { readDbFromPostgres, closePostgresPool } from '../lib/postgres-store.mjs';

const point = (targetId, day, y, extra = {}) => ({targetId, sessionId:`s${day}`, x:`2026-01-${String(day).padStart(2,'0')}`, independence:y, ...extra});
const program = {id:'p',targets:[{id:'a',name:'Early'},{id:'b',name:'Later'}]};
const history = [point('a',1,null),point('a',2,20),point('a',3,40),point('b',10,0),point('b',11,null),point('b',12,60),point('b',13,90),point('b',14,'')];
const chart = (observations = history) => buildSkillMeasurementChart(program,program.targets,observations,undefined);

test('unconfigured historical programs stay unclassified regardless of observation order or target introduction', () => {
  const before=structuredClone(history);
  const full=chart();
  const phases=deriveProgramPhases(full.series);
  assert.ok(phases.every(series=>series.points.every(point=>point.effectiveProgramPhase===null)));
  const result=buildGraphAnalysis(full.series).analyses[1];
  assert.equal(result.baselineLevel,null);
  assert.equal(result.treatmentLevel,null);
  assert.equal(result.currentLevel,90);
  assert.equal(result.changeFromBaseline,null);
  assert.equal(buildClinicalGraphModel(full.series).phaseBoundary,null);
  assert.deepEqual(history,before);
});

test('explicit phases override fallback, mastery does not; current level includes maintenance observations', () => {
  const series=[{name:'Target',points:[1,2,3,4,5,6].map((day)=>({...point('a',day,day*10),y:day*10}))}];
  const options={phaseMarkers:[
    {id:'base',date:'2026-01-01',label:'Baseline',phaseType:'baseline'},
    {id:'treat',date:'2026-01-03',label:'Intervention',phaseType:'intervention'},
    {id:'master',date:'2026-01-04',label:'Target mastered',phaseType:'targetMastered'},
    {id:'maint',date:'2026-01-06',label:'Maintenance',phaseType:'maintenance'}
  ]};
  const before=structuredClone({series,options});
  const result=buildGraphAnalysis(series,options).analyses[0];
  assert.equal(result.baselineLevel,15);
  assert.equal(result.treatmentLevel,40);
  assert.equal(result.currentLevel,60);
  assert.equal(result.trendDirection,'Increasing');
  assert.deepEqual({series,options},before);
  const withoutMastery={phaseMarkers:options.phaseMarkers.filter(p=>p.id!=='master')};
  assert.equal(buildGraphAnalysis(series,withoutMastery).analyses[0].treatmentLevel,40);
});

for (const [values,expected] of [ [[10,20,30],'Increasing'], [[30,20,10],'Decreasing'], [[20,20,20],'Stable'], [[0,100,0,100,0,100],'Variable'], [[50,51,52],'Stable'], [[50,52,54],'Increasing'], [[54,52,50],'Decreasing'], [[10,20],'Insufficient data'], [[10],'Insufficient data'] ]) {
  test(`regression trend ${expected} from ${values.join(',')}`, () => {
    const series=[{name:'Target',points:[0,...values].map((y,i)=>({x:`2026-01-${String(i+1).padStart(2,'0')}`,y}))}];
    assert.equal(buildGraphAnalysis(series,{treatmentPhaseLine:{date:"2026-01-02"}}).analyses[0].trendDirection,expected);
  });
}

test('weeks between observations occupy equal sequence intervals without changing date strings', () => {
  const dates=['2026-07-01','2026-07-02','2026-08-01','2026-09-29'];
  const before=[...dates];
  const positions=buildChartLayout(dates,0,800,null).dateXPositions;
  for(let i=2;i<positions.length;i++) assert.ok(Math.abs((positions[i]-positions[i-1])-(positions[1]-positions[0]))<1e-9);
  assert.deepEqual(dates,before);
});

test('existing JSON and Postgres clinical records survive graph initialization byte-for-byte / deep-equal', async () => {
  const fixture={clients:[{id:'c',treatmentPlan:{id:'plan',programs:[program]},graphPhaseLines:{'skill:p':[{id:'phase',date:'2026-01-03',phaseType:'treatment'}]},soapNotes:[{id:'note',text:'Synthetic existing note'}]}],sessions:history.map((entry,i)=>({id:`record-${i}`,clientId:'c',date:entry.x,observations:[entry]})),clientUserAssignments:[]};
  const directory=await mkdtemp(join(tmpdir(),'graph-safety-'));
  const dbPath=join(directory,'existing.json');
  const bytes=JSON.stringify(fixture,null,2);
  await writeFile(dbPath,bytes);
  try {
    // Execute the application's actual JSON read path without booting a server.
    const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
    const readFunction=source.match(/^async function readDb\(\) \{[\s\S]*?^}/m)[0];
    const context=vm.createContext({dataStore:'json',readFile,dbPath,JSON});
    vm.runInContext(readFunction,context);
    const jsonDb=await context.readDb();
    const queries=[];
    class Pool {
      async connect(){return {query:async(sql)=>{
        queries.push(sql);
        if(sql.includes('select data from app_state')) return {rows:[{data:structuredClone(fixture)}]};
        if(sql.includes('from client_user_assignments')) return {rows:[]};
        assert.match(sql,/create table if not exists/);
        return {rows:[]};
      },release(){}};}
      async end(){}
    }
    const postgresDb=await readDbFromPostgres({Pool});
    for(const db of [jsonDb,postgresDb]) {
      const observations=db.sessions.flatMap(s=>s.observations);
      const built=buildSkillMeasurementChart(program,program.targets,observations);
      buildClinicalGraphModel(built.series);
      buildGraphAnalysis(built.series,{treatmentPhaseLine:db.clients[0].graphPhaseLines['skill:p'][0]});
      assert.deepEqual(db,fixture);
    }
    assert.equal(await readFile(dbPath,'utf8'),bytes);
    assert.ok(!queries.some(sql=>/insert|update|delete|truncate|drop/i.test(sql.replace(/updated_at/g,''))));
  } finally {await closePostgresPool();await rm(directory,{recursive:true,force:true});}
});
