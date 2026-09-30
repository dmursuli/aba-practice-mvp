import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {graphNumericValue} from '../public/graph-values.js';
import {graphObservationProvider} from '../public/charts.js';
import {behaviorGraphMeasurement,behaviorMeasurementGate} from '../public/behavior-graph-measurements.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
function fixture(status='active',confirm=true) {
  let catalog=[{id:'stable',name:'Leaving seat',status}];
  const saves=[], confirmations=[], rows=[];
  const retired={open:false};
  const context=vm.createContext({structuredClone,graphNumericValue,graphObservationProvider,behaviorGraphMeasurement,
    escapeHtml:String,planMessage:{textContent:''},planReview:{querySelector:()=>retired},
    window:{prompt:()=> ' LEAVING SEAT ',confirm:message=>{confirmations.push(message);return confirm;}},
    currentPlanDraft:()=>({programs:[],behaviors:structuredClone(catalog)}),
    clientBehaviors:()=>catalog,behaviorEntriesForSession:s=>s.behaviors,
    savePlan:async(programs,behaviors,change)=>{saves.push({behaviors,change});catalog=structuredClone(behaviors);},
    trackPlanSave:promise=>promise,behaviorList:{innerHTML:''},sessionPreloadLimits:{behaviors:10},addBehaviorRow:id=>rows.push(id)
  });
  vm.runInContext(['handlePlanClick','renderPlanBehaviorSection','behaviorChartSeries','buildBehaviorChart','preloadBehaviorRows'].map(extract).join('\n'),context);
  const click=next=>context.handlePlanClick({target:{closest:selector=>selector==='[data-set-plan-behavior-status]'?{dataset:{setPlanBehaviorStatus:'stable',nextStatus:next}}:null}});
  return {context,click,saves,confirmations,rows,retired,catalog:()=>catalog};
}

test('retirement and reactivation preserve identity, historical graphs/report range, and collection eligibility',async()=>{
  const f=fixture();
  const sessions=[{id:'s1',date:'2026-04-01',behaviors:[{behaviorId:'stable',frequency:0}]},
    {id:'s2',date:'2026-05-01',behaviors:[{behaviorId:'stable',frequency:3}]}];
  const before=JSON.stringify(sessions);
  f.context.preloadBehaviorRows();assert.deepEqual(f.rows,['stable']);f.rows.length=0;
  await f.click('inactive');
  assert.deepEqual(f.catalog(),[{id:'stable',name:'Leaving seat',status:'inactive'}]);
  assert.match(f.confirmations[0],/preserving.*historical/);
  assert.equal(f.saves[0].change.type,'behavior-status-changed');
  assert.equal(f.saves[0].change.fromStatus,'active');assert.equal(f.saves[0].change.toStatus,'inactive');
  f.context.preloadBehaviorRows();assert.deepEqual(f.rows,[]);
  const historical=f.context.behaviorChartSeries(sessions);
  assert.equal(historical[0].points.length,2);
  assert.equal(behaviorMeasurementGate(historical).blocked,false);
  assert.equal(historical[0].points[0].y,0);
  const report=f.context.behaviorChartSeries(sessions.filter(s=>s.date<'2026-05-01'));
  assert.equal(report.length,1);assert.equal(report[0].points[0].y,0);
  assert.match(extract('renderReportBehaviorOverviewChart'),/behaviorChartSeries\(sessions\)/);
  assert.match(extract('drawBehaviorChartSet'),/behaviorChartSeries\(sessions\)/);
  await f.click('active');f.context.preloadBehaviorRows();
  assert.deepEqual(f.rows,['stable']);assert.equal(f.catalog().length,1);assert.equal(f.catalog()[0].id,'stable');
  assert.equal(f.saves[1].change.fromStatus,'inactive');assert.equal(f.saves[1].change.toStatus,'active');
  assert.equal(JSON.stringify(sessions),before);
});

test('cancel, legacy inactive presentation, and duplicate-name guidance do not delete or merge records',async()=>{
  const cancelled=fixture('active',false);await cancelled.click('inactive');assert.equal(cancelled.saves.length,0);
  const f=fixture('inactive');
  const html=f.context.renderPlanBehaviorSection(f.catalog());
  assert.match(html,/<details data-retired-behaviors>/);assert.match(html,/Retired — historical data retained/);
  assert.match(html,/Reactivate/);assert.doesNotMatch(html,/data-remove-plan-behavior|data-behavior-status/);
  await f.context.handlePlanClick({target:{closest:s=>s==='[data-add-plan-behavior]'?{}:null}});
  assert.equal(f.saves.length,0);assert.equal(f.retired.open,true);
  assert.match(f.context.planMessage.textContent,/Reactivate.*distinct descriptive name/);
  assert.equal(f.catalog()[0].id,'stable');
});

test('existing authorized plan save and new-collection filtering pathways remain in use',()=>{
  assert.match(extract('handlePlanClick'),/trackPlanSave\(savePlan\(programs, behaviors/);
  assert.doesNotMatch(extract('handlePlanClick'),/behaviors\.filter\(.*target\.id|behavior-removed/);
  for(const name of ['preloadBehaviorRows','addFirstAvailableBehaviorRow','syncBehaviorOptions'])
    assert.match(extract(name),/status !== "inactive"/);
  const endpoint=server.slice(server.indexOf('if (req.method === "PUT" && planMatch)'),server.indexOf('if (req.method === "POST" && url.pathname === "/api/sessions")'));
  assert.match(endpoint,/requireRole\(req, res, db, \["admin", "bcba"\]\)/);
  assert.match(endpoint,/canAccessClient/);assert.match(endpoint,/treatment-plan-updated/);
});
