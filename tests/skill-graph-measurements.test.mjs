import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {buildSkillMeasurementChart, skillGraphMeasurement, skillMeasurementSettings} from '../public/skill-graph-measurements.js';
import {buildGraphAnalysis, buildMovingAverageSeriesSet, buildClinicalGraphModel, buildChartLayout} from '../public/charts.js';

const program={id:'program',name:'Synthetic program',dataCollectionType:'frequency'};
const targets=[{id:'a',name:'Target A'},{id:'b',name:'Percent only'}];
const observations=[
  {targetId:'a',x:'2026-04-01',dataCollectionType:'percent_correct',independence:0},
  {targetId:'a',x:'2026-04-03',dataCollectionType:'percent_correct',independence:80},
  {targetId:'a',x:'2026-04-10',dataCollectionType:'frequency',frequency:'0'},
  {targetId:'a',x:'2026-04-12',dataCollectionType:'frequency',frequency:2},
  {targetId:'b',x:'2026-04-03',historicalImportMeasurementType:'percentage',independence:60}
];
const build=(points=observations,type)=>buildSkillMeasurementChart(program,targets,points,type);

test('skill observation metadata is resolved without current-plan inference and conflicts are excluded',()=>{
  for(const record of [
    {dataCollectionType:'frequency',historicalImportMeasurementType:'percentage',frequency:4},
    {dataCollectionType:'percent_correct',historicalImportMeasurementType:'frequency',independence:40},
    {dataCollectionType:'duration',independence:40},
    {historicalImportMeasurementType:'rate',frequency:3},
    {frequency:3}, {independence:40,frequency:3}, {}
  ]) assert.equal(skillGraphMeasurement(record),null);
  assert.equal(skillGraphMeasurement({independence:0,trials:5,correct:0}),'percent_correct');
  assert.equal(skillGraphMeasurement({historicalImportMeasurementType:'percentage',independence:0}),'percent_correct');
  assert.equal(skillGraphMeasurement({dataCollectionType:'frequency',frequency:null}),'frequency');
  const ambiguous=build([{targetId:'a',x:'2026-04-01',frequency:5}]);
  assert.equal(ambiguous.ambiguousCount,1);
  assert.equal(ambiguous.series.length,0);
});

test('single-unit programs select their only type; mixed histories partition before series and calculations',()=>{
  const before=structuredClone(observations);
  const percent=build(observations,'percent_correct'),frequency=build(observations,'frequency');
  assert.deepEqual(percent.measurementTypes,['percent_correct','frequency']);
  assert.deepEqual(percent.series[0].points.map(p=>[p.x,p.y]),[['2026-04-01',0],['2026-04-03',80]]);
  assert.deepEqual(frequency.series[0].points.map(p=>[p.x,p.y]),[['2026-04-10',0],['2026-04-12',2]]);
  assert.equal(frequency.series.length,1);
  assert.deepEqual(buildMovingAverageSeriesSet(percent.series)[0].points.map(p=>p.y),[0,40]);
  assert.deepEqual(buildMovingAverageSeriesSet(frequency.series)[0].points.map(p=>p.y),[0,1]);
  const options={treatmentPhaseLine:{date:'2026-04-02'},phaseMarkers:[{date:'2026-04-03',label:'Target mastered',phaseType:'targetMastered'}]};
  const analysis=buildGraphAnalysis(percent.series,options);
  assert.equal(analysis.analyses[0].baselineLevel,0);
  assert.equal(analysis.analyses[0].treatmentLevel,80);
  assert.equal(buildClinicalGraphModel(percent.series,options).phaseMarkers[0].date,'2026-04-03');
  assert.deepEqual(build(observations.slice(0,2)).measurementTypes,['percent_correct']);
  assert.deepEqual(build(observations.slice(2,4)).measurementTypes,['frequency']);
  assert.deepEqual(skillMeasurementSettings(percent),{mode:'percent_correct',maxY:100,yStep:10,yLabel:'Percent correct',emptyMessage:'No percentage data for this program'});
  assert.equal(skillMeasurementSettings(frequency).yLabel,'Frequency');
  assert.equal(skillMeasurementSettings(frequency).maxY,undefined);
  assert.deepEqual(observations,before);
});

test('typed missing values remain unavailable, zeros survive, and selected dates retain elapsed spacing',()=>{
  for(const type of ['percent_correct','frequency']) {
    const values=[0,'0',null,undefined,'','  ','invalid',NaN,Infinity];
    const chart=build(values.map((value,i)=>({targetId:'a',x:`2026-04-${String(i+1).padStart(2,'0')}`,dataCollectionType:type,[type==='frequency'?'frequency':'independence']:value})),type);
    assert.deepEqual(chart.series[0].points.map(p=>p.y),[0,0,...Array(7).fill(null)]);
    assert.deepEqual(buildMovingAverageSeriesSet(chart.series)[0].points.map(p=>p.y),[0,0,...Array(7).fill(null)]);
  }
  const dates=['2026-04-01','2026-04-03','2026-04-11'];
  const x=buildChartLayout(dates,64,720,null).dateXPositions;
  assert.ok(Math.abs((x[1]-x[0])/(x[2]-x[0])-0.2)<1e-9);
});

const read=file=>readFileSync(new URL(`../public/${file}`,import.meta.url),'utf8');
const app=read('app.js');
function extract(name) {
  const match=app.match(new RegExp(`^function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`,'m'));
  assert.ok(match,name);return match[0];
}
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});

async function fixture(t, points=observations) {
  const page=await browser.newPage();t.after(()=>page.close());
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>${read('styles.css')}</style><main class="graphs-shell" data-view-panel="graphs"><section class="graphs-panel"><div id="skills"></div></section></main><div id="modal" class="modal-shell hidden"><h2></h2><p></p><canvas></canvas><div id="modal-legend"></div><div id="modal-analysis"></div></div>`);
  const moduleSource=read('graph-values.js')+'\n'+read('skill-graph-measurements.js').replace(/^import .*;$/gm,'')+'\n'+read('charts.js').replace(/^import .*;$/gm,'');
  const names=['buildProgramSkillChart','skillChartSettings','buildSkillChartsByDomain','renderSkillCharts','renderSkillMeasurementControl','bindSkillMeasurementControls','drawSkillChartSet','openProgramGraphModal','handleGraphAnalysisControlChange'];
  await page.addScriptTag({type:'module',content:moduleSource+`
    const state={activeClientId:'client',skillGraphMeasurements:{},graphAnalysisRenderToken:0,activeGraphDomain:''};
    const skillCharts=document.querySelector('#skills');
    const programGraphModal=document.querySelector('#modal');
    const programGraphModalTitle=programGraphModal.querySelector('h2');
    const programGraphModalSubtitle=programGraphModal.querySelector('p');
    const programGraphModalCanvas=programGraphModal.querySelector('canvas');
    const programGraphModalLegend=document.querySelector('#modal-legend');
    const programGraphModalAnalysis=document.querySelector('#modal-analysis');
    const program=${JSON.stringify(program)}, targets=${JSON.stringify(targets)};
    const sessions=${JSON.stringify(points)}.map((entry,i)=>({id:'session-'+i,date:entry.x,entry}));
    const currentSessions=()=>sessions;
    const configuredTargetsForProgram=()=>targets;
    const targetEntries=session=>[{...session.entry,programId:program.id}];
    const isActualTargetEntry=()=>true;
    const clientPrograms=()=>[program];
    const groupedProgramsByDomain=programs=>[['Synthetic',programs]];
    const renderGraphDomainTabs=()=>{};
    const graphTrendKey=(kind,id)=>kind+':'+id;
    const trendLineEnabled=()=>true;
    const graphPhaseConfig=()=>({treatmentPhaseLine:{date:'2026-04-02'},phaseMarkers:[]});
    const masteryMarkersForProgram=()=>[];
    const renderGraphLegendMarkup=series=>'<div class="graph-legend">'+series.map(s=>s.name).join(', ')+'</div>';
    const renderSkillDataManagerMarkup=()=>'';
    const renderCustomPhaseLineManager=()=>'';
    const renderReportProgramInfo=()=>'';
    const renderGraphAnalysisMarkup=analysis=>'<p data-analysis>Baseline '+analysis.analyses[0]?.baselineLevel+'; Treatment '+analysis.analyses[0]?.treatmentLevel+'</p>';
    const renderReportGraphAnalysisMarkup=renderGraphAnalysisMarkup;
    const queueGraphAnalysisBatch=tasks=>tasks.forEach(task=>task());
    const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    ${names.map(extract).join('\n')}
    window.render=()=>renderSkillCharts(sessions);
    window.renderReport=()=>drawSkillChartSet(sessions,skillCharts,'report-program-chart',true);
    window.openSkillModal=()=>openProgramGraphModal(program.id);
    window.modalState=()=>programGraphModalCanvas.__clinicalGraphRenderState;
    window.graphState=()=>document.querySelector('canvas').__clinicalGraphRenderState;
    window.render();
  `});
  await page.waitForFunction(()=>window.graphState?.());
  return page;
}

test('mixed skill selector updates actual rendering, legend, axis, analysis and keyboard focus',async t=>{
  const page=await fixture(t);
  const picker=page.getByRole('combobox',{name:'Measurement'});
  assert.equal(await picker.count(),1);
  assert.equal(await picker.inputValue(),'percent_correct');
  assert.match(await page.locator('[data-analysis]').textContent(),/Baseline 0; Treatment 80/);
  assert.match(await page.locator('.graph-legend').textContent(),/Percent only/);
  assert.equal((await page.evaluate(()=>graphState().options)).maxY,100);
  await picker.selectOption('frequency');
  const frequency=await page.evaluate(()=>graphState());
  assert.equal(frequency.options.yLabel,'Frequency');
  assert.equal(frequency.options.maxY,undefined);
  assert.deepEqual(frequency.series[0].points.map(p=>p.y),[0,2]);
  assert.equal(await page.locator('[data-analysis]').count(),0);
  assert.match(await page.locator('#skills').textContent(),/Frequency observations are shown as raw counts/);
  assert.equal(await page.locator('.graph-legend').textContent(),'Target A');
  assert.equal(await picker.evaluate(node=>node===document.activeElement),true);
  await picker.selectOption('percent_correct');
  assert.equal((await page.evaluate(()=>graphState().options)).yLabel,'Percent correct');
  assert.equal(await page.locator('[data-analysis]').count(),1);
  for(const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.evaluate(()=>window.renderReport());
  await picker.selectOption('frequency');
  assert.deepEqual(await page.evaluate(()=>graphState().series[0].points.map(p=>p.dataCollectionType)),['frequency','frequency']);
});

test('single-type charts omit selector and ambiguous-only charts show an exclusion notice',async t=>{
  for(const points of [observations.slice(0,2),observations.slice(2,4),[{targetId:'a',x:'2026-04-01',frequency:4}]]) {
    const page=await fixture(t,points);
    assert.equal(await page.getByRole('combobox',{name:'Measurement'}).count(),0);
    if(points.length===1) {
      assert.match(await page.locator('[role="status"]').textContent(),/1 observation\(s\) excluded/);
      assert.equal((await page.evaluate(()=>graphState().series)).length,0);
    }
  }
});

test('skill modal switches measurements without mixing historical points',async t=>{
  const page=await fixture(t);
  await page.evaluate(()=>openSkillModal());
  await page.waitForFunction(()=>modalState()?.options.yLabel==='Percent correct');
  const picker=page.locator('#modal').getByRole('combobox',{name:'Measurement'});
  await picker.selectOption('frequency');
  await page.waitForFunction(()=>modalState()?.options.yLabel==='Frequency');
  assert.deepEqual(await page.evaluate(()=>modalState().series[0].points.map(p=>p.y)),[2,0]);
  assert.match(await page.locator('#modal-analysis').textContent(),/raw counts/);
  await picker.selectOption('percent_correct');
  await page.waitForFunction(()=>modalState()?.options.yLabel==='Percent correct');
  assert.equal(await page.locator('#modal [data-skill-measurement]').count(),1);
  assert.match(await page.locator('#modal-analysis').textContent(),/Baseline 0; Treatment 80/);
});
