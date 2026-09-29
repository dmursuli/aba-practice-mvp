import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {behaviorGraphMeasurement, behaviorMeasurementGate, buildBehaviorMeasurementAnalysis} from '../public/behavior-graph-measurements.js';

const labels={frequency:'Frequency',percentage:'Percentage',duration:'Duration (unit unspecified)',rate:'Rate (denominator unspecified)'};
const series=(types,values=types.map((_,i)=>i*10))=>[{name:'Synthetic',meta:{behaviorId:'b'},points:types.map((measurementType,i)=>({x:`2026-04-${String(i+1).padStart(2,'0')}`,measurementType,y:values[i]}))}];

test('behavior classification honors metadata, conflicts, and import provenance without plan inference',()=>{
  assert.equal(behaviorGraphMeasurement({frequency:0}),'frequency');
  assert.equal(behaviorGraphMeasurement({frequency:'0'}),'frequency');
  for(const type of Object.keys(labels)) {
    assert.equal(behaviorGraphMeasurement({frequency:0,historicalImportMeasurementType:type}),type);
  }
  assert.equal(behaviorGraphMeasurement({frequency:0,measurementType:'count'}),'frequency');
  for(const entry of [
    {frequency:1,historicalImportMeasurementType:'percentage',measurementType:'frequency'},
    {frequency:1,historicalImportMeasurementType:'rate',dataCollectionType:'duration'},
    {frequency:1,historicalImportMeasurementType:'unknown'},
    {frequency:1,historicalImportMeasurementType:'fidelity'},
    {frequency:1,historicalImportRowId:'row'},
    {frequency:1,historicalImportBatchId:'batch'},{}
  ]) assert.equal(behaviorGraphMeasurement(entry),null);
  assert.equal(behaviorGraphMeasurement({frequency:1},{source:'historical_import'}),null);
  assert.equal(behaviorGraphMeasurement({frequency:1},{historicalImport:{batchId:'batch'}}),null);
});

test('homogeneous types preserve numeric values, scaling, phases and averaging formulas',()=>{
  for(const [type,label] of Object.entries(labels)) {
    const data=series([type,type,type],[0,20,40]);
    const before=structuredClone(data);
    const gate=behaviorMeasurementGate(data);
    assert.equal(gate.blocked,false);
    assert.equal(gate.settings.yLabel,label);
    assert.equal(gate.settings.maxY,type==='percentage'?100:undefined);
    assert.equal(gate.settings.yStep,type==='percentage'?10:1);
    const analysis=buildBehaviorMeasurementAnalysis(data,{treatmentPhaseLine:{date:'2026-04-02'}});
    assert.equal(analysis.analyses[0].baselineLevel,0);
    assert.equal(analysis.analyses[0].treatmentLevel,30);
    assert.deepEqual(analysis.analyses[0].movingAveragePoints.map(p=>p.y),[0,10,20]);
    assert.equal(analysis.phaseBoundary.configuredDate,'2026-04-02');
    if(type!=='frequency') assert.doesNotMatch(analysis.analyses[0].interpretation,/frequency/i);
    assert.deepEqual(data,before);
  }
});

test('mixed single behaviors and overview axes are withheld from curves, smoothing and analysis',()=>{
  for(const types of [['frequency','percentage'],['frequency','duration'],['rate','duration']]) {
    for(const data of [series(types),types.flatMap(type=>series([type]))]) {
      assert.equal(behaviorMeasurementGate(data).blocked,true);
      assert.deepEqual(behaviorMeasurementGate(data).series,[]);
      assert.deepEqual(buildBehaviorMeasurementAnalysis(data).analyses,[]);
      assert.match(buildBehaviorMeasurementAnalysis(data).measurementNotice,/different measurement types/);
    }
  }
});

test('ambiguous records never enter numeric interpretation; missing values and explicit zeros keep existing semantics',()=>{
  const data=series(['frequency',null,'frequency','frequency','frequency'],[0,999,null,'0',Infinity]);
  const gate=behaviorMeasurementGate(data);
  assert.equal(gate.blocked,false);
  assert.equal(gate.ambiguousCount,1);
  assert.deepEqual(gate.series[0].points.map(p=>p.y),[0,null,'0',Infinity]);
  const analysis=buildBehaviorMeasurementAnalysis(data,{treatmentPhaseLine:{date:'2026-04-02'}});
  assert.equal(analysis.analyses[0].baselineLevel,0);
  assert.equal(analysis.analyses[0].treatmentLevel,0);
  assert.deepEqual(analysis.analyses[0].movingAveragePoints.map(p=>p.y),[0,null,0,null]);
  assert.equal(behaviorMeasurementGate(series([null])).blocked,true);
  assert.deepEqual(buildBehaviorMeasurementAnalysis(series([null])).analyses,[]);
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
async function fixture(t) {
  const page=await browser.newPage();t.after(()=>page.close());
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>${read('styles.css')}</style><div class="graphs-shell"><div id="charts"></div><div id="overview"></div></div>`);
  const modules=['graph-values.js','charts.js','behavior-graph-measurements.js'].map(file=>read(file).replace(/^import .*;$/gm,'')).join('\n');
  const names=['behaviorChartSeries','buildBehaviorChart','drawBehaviorChartSet','renderReportBehaviorOverviewChart','renderBehaviorGraphLegendMarkup','renderGraphLegendMarkup','renderGraphAnalysisMarkup','renderReportGraphAnalysisMarkup','renderGraphMetricCell','formatAnalysisMetric'];
  await page.addScriptTag({type:'module',content:modules+`
    const state={graphAnalysisRenderToken:0,behaviorGraphAnalyzeAllData:false,behaviorGraphShowPoints:true};
    const reportForm={elements:{startDate:{value:''}}};
    let sessions=[];
    const clientBehaviors=()=>[{id:'b',name:'Behavior B'},{id:'c',name:'Behavior C'}];
    const behaviorEntriesForSession=session=>session.behaviors;
    const currentSessions=()=>sessions;
    const behaviorGraphRange=()=>({startDate:'',endDate:'',label:'All data'});
    const visibleBehaviorIds=()=>['b','c'];
    const graphTrendKey=(prefix,id)=>prefix+':'+id;
    const trendLineEnabled=()=>true;
    const graphPhaseConfig=()=>({treatmentPhaseLine:{date:'2026-04-02'},phaseMarkers:[]});
    const renderCustomPhaseLineManager=()=>'';
    const renderBehaviorDataManagerMarkup=()=>'';
    const anySeriesDataBeforeRange=()=>false;
    const queueGraphAnalysisBatch=tasks=>tasks.forEach(task=>task());
    const buildCompactGraphAnalysisSentence=entry=>entry.interpretation;
    const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    ${names.map(extract).join('\n')}
    window.render=(records,allRecords=null)=>{
      sessions=records; state.behaviorGraphAnalyzeAllData=Boolean(allRecords);
      const allSeries=allRecords ? behaviorChartSeries(allRecords) : behaviorChartSeries(records);
      drawBehaviorChartSet(records,document.querySelector('#charts'),'behavior-test',{layoutMode:'graphs',allSeries});
      renderReportBehaviorOverviewChart(document.querySelector('#overview'),records);
    };
    window.drawSafety=drawBehaviorMeasurementChart;
  `});
  await page.waitForFunction(()=>window.render);
  return page;
}
const records=types=>types.map((type,i)=>({id:`s${i}`,date:`2026-04-${String(i+1).padStart(2,'0')}`,behaviors:[{behaviorId:'b',frequency:i*20,historicalImportMeasurementType:type}]}));

test('real behavior renderers use unit labels and scales; mixed/ambiguous graphs have nonnumeric states',async t=>{
  const page=await fixture(t);
  for(const [type,label] of Object.entries(labels)) {
    await page.evaluate(data=>render(data),records([type,type]));
    const rendered=await page.locator('#charts canvas').evaluate(canvas=>({hidden:canvas.classList.contains('hidden'),state:canvas.__clinicalGraphRenderState}));
    assert.equal(rendered.hidden,false);
    assert.equal(rendered.state.options.yLabel,label);
    assert.equal(rendered.state.options.maxY,type==='percentage'?100:undefined);
    assert.equal(rendered.state.series[0].points[0].y,0);
    assert.match(await page.locator('#charts [data-graph-analysis]').textContent(),new RegExp(label.replace(/[()]/g,'\\$&')));
  }
  for(const types of [['frequency','percentage'],['frequency','duration'],['rate','duration'],['unknown','unknown']]) {
    await page.evaluate(data=>render(data),records(types));
    for(const selector of ['#charts','#overview']) {
      assert.equal(await page.locator(`${selector} canvas`).isVisible(),false);
      assert.match(await page.locator(`${selector} [data-behavior-measurement-notice]`).textContent(),/different measurement|unclear or conflicting/);
      const rendered=await page.locator(`${selector} canvas`).evaluate(canvas=>canvas.__clinicalGraphRenderState);
      assert.deepEqual(rendered.series,[]);
      assert.equal(rendered.options.showTrendLine,false);
    }
    assert.equal(await page.locator('#charts [data-graph-analysis]').count(),0);
  }
});

test('overview blocks different homogeneous behaviors; Analyze all data is gated independently of visible range',async t=>{
  const page=await fixture(t);
  const data=records(['frequency','percentage']);
  data[1].behaviors[0].behaviorId='c';
  await page.evaluate(data=>render(data),data);
  assert.equal(await page.locator('#charts canvas:visible').count(),2);
  assert.equal(await page.locator('#overview canvas').isVisible(),false);
  const mixed=records(['frequency','percentage']);
  await page.evaluate(data=>render([data[0]],data),mixed);
  assert.equal(await page.locator('#charts canvas').isVisible(),true);
  assert.equal(await page.locator('#charts [data-graph-analysis]').count(),0);
  assert.match(await page.locator('#charts [data-behavior-analysis]').textContent(),/different measurement types/);
});

test('every behavior canvas and analysis entry point uses the gate',()=>{
  for(const name of ['openBehaviorGraphModal','renderCharts','drawBehaviorChartSet','renderReportBehaviorOverviewChart']) {
    assert.match(extract(name),/drawBehaviorMeasurementChart\(/);
  }
  for(const name of ['openBehaviorGraphModal','renderCharts','drawBehaviorChartSet']) assert.match(extract(name),/buildBehaviorMeasurementAnalysis\(/);
});
