import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { buildPixelDateTicks, layoutDateTicks, layoutPhaseLabels, buildChartLayout, buildClinicalGraphModel, buildMovingAverageSeriesSet } from '../public/charts.js';
const source = readFileSync(new URL('../public/charts.js', import.meta.url), 'utf8');
const valuesSource = readFileSync(new URL('../public/graph-values.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const measure = text => text.length * 6;
const dates = count => Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));

for (const [name, values] of Object.entries({ sparse: ['2026-01-01','2026-02-01','2026-03-01'], dense: dates(200), irregular: ['2024-01-01','2024-01-02','2024-01-03','2025-03-15','2026-09-23'], single: ['2026-01-01'], empty: [] })) {
  test(`${name} pixel ticks stay separated, in bounds, and preserve endpoint dates where space permits`, () => {
    for (const width of [200, 720, 1156]) {
      const positions = buildChartLayout(values, 64, width, null).dateXPositions;
      const ticks = buildPixelDateTicks(values, positions, measure, 8, width + 76);
      for (let i = 0; i < ticks.length; i++) {
        const tick = ticks[i];
        assert.equal(tick.date, values[tick.index]);
        assert.ok(tick.labelX - tick.labelWidth / 2 >= 8);
        assert.ok(tick.labelX + tick.labelWidth / 2 <= width + 76);
        if (i) assert.ok(tick.labelX - tick.labelWidth / 2 >= ticks[i - 1].labelX + ticks[i - 1].labelWidth / 2 + 10);
      }
      if (values.length) {
        assert.equal(ticks[0].date, values[0]);
        assert.equal(ticks.at(-1).date, values.at(-1));
      } else assert.deepEqual(ticks, []);
      if (name === 'sparse') assert.equal(ticks.length, values.length);
    }
  });
}

test('label layout wraps long phase names without collisions or moving anchors', () => {
  const labels = ['Baseline', 'Treatment', 'Target mastered', 'Objective changed', 'Long environmental phase label near the right edge', 'Unbroken'.repeat(12)].map((text, i) => ({ text, anchorX: 70 + i * 5 }));
  for (const width of [130, 720, 1156]) {
    const positioned = layoutPhaseLabels(labels, 64, 64 + width, measure);
    positioned.forEach((label, i) => {
      assert.equal(label.anchorX, labels[i].anchorX);
      assert.equal(label.lines.join('').replaceAll(' ', ''), labels[i].text.replaceAll(' ', ''));
      assert.ok(label.left >= 64 && label.left + label.width <= 64 + width);
      positioned.slice(i + 1).forEach(other => {
        assert.ok(label.left + label.width <= other.left || other.left + other.width <= label.left || label.top + label.height <= other.top || other.top + other.height <= label.top);
      });
    });
  }
});

test('elapsed spacing, same-day observations, mastery model and smoothing are independent of layout mode', () => {
  const series = [{ name: 'Synthetic', points: [{ x:'2026-01-01', y:0 }, { x:'2026-01-01', y:20 }, { x:'2026-01-02', y:50 }, { x:'2026-01-11', y:100 }] }];
  const options = { phaseMarkers: [{ date:'2026-01-11', label:'Target mastered', phaseType:'targetMastered', position:'after-date' }] };
  const before = JSON.stringify(series);
  const model = buildClinicalGraphModel(series, options);
  assert.deepEqual(buildClinicalGraphModel(series, { ...options, layoutMode:'graphs' }), model);
  assert.deepEqual(buildMovingAverageSeriesSet(series, options), buildMovingAverageSeriesSet(series, { ...options, layoutMode:'graphs' }));
  const x = buildChartLayout(model.dates, 64, 720, model.phaseBoundary, model.phaseMarkers).dateXPositions;
  assert.ok(Math.abs((x[1] - x[0]) / (x[2] - x[0]) - 0.1) < 1e-9);
  assert.equal(model.dates.length, 3);
  assert.equal(series[0].points.length, 4);
  assert.equal(JSON.stringify(series), before);
});

let browser;
before(async () => { browser = await chromium.launch({ headless:true }); });
after(async () => { await browser?.close(); });
async function fixture(t) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  t.after(() => page.close());
  await page.route('**/*', route => route.abort());
  await page.setContent(`<style>${css}</style><main class="graphs-shell" data-view-panel="graphs"><section class="graphs-panel"><article class="chart-panel"><canvas id="chart"></canvas></article></section></main>`);
  await page.addScriptTag({ type:'module', content:source.replace('import { graphNumericValue } from "./graph-values.js";', valuesSource) + '\nwindow.draw = drawLineChart;' });
  await page.waitForFunction(() => window.draw);
  return page;
}

test('scoped canvas fills Graphs width, handles labels and raw observations, and never overflows', async t => {
  const page = await fixture(t);
  for (const width of [1920,1440,1024,768,390,320]) {
    await page.setViewportSize({ width, height:1000 });
    const result = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const text = [], points = [];
      const originalText = ctx.fillText.bind(ctx), originalArc = ctx.arc.bind(ctx);
      ctx.fillText = (value,x,y,...rest) => { const m = ctx.getTransform(), metrics = ctx.measureText(String(value));
        const corners = [[-metrics.actualBoundingBoxLeft,-metrics.actualBoundingBoxAscent],[metrics.actualBoundingBoxRight,-metrics.actualBoundingBoxAscent],[-metrics.actualBoundingBoxLeft,metrics.actualBoundingBoxDescent],[metrics.actualBoundingBoxRight,metrics.actualBoundingBoxDescent]].map(([dx,dy])=>({x:m.a*(x+dx)+m.c*(y+dy)+m.e,y:m.b*(x+dx)+m.d*(y+dy)+m.f}));
        text.push({ value:String(value), x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,width:metrics.width,left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y)),angle:Math.atan2(m.b,m.a) }); originalText(value,x,y,...rest); };
      ctx.arc = (x,y,...rest) => { points.push({x,y}); originalArc(x,y,...rest); };
      const series = [{ name:'Synthetic', points:[{x:'2026-01-01',y:0},{x:'2026-01-01',y:40},{x:'2026-01-02',y:50},{x:'2026-03-31',y:100}] }];
      const options = {layoutMode:'graphs',maxY:100,yStep:10,phaseMarkers:[{date:'2026-01-02',label:'Target mastered',phaseType:'targetMastered',position:'after-date'},{date:'2026-02-01',label:'A long environmental phase label',phaseType:'environmentalChange'},{date:'2026-02-02',label:'Another nearby phase',phaseType:'environmentalChange'}]};
      const before = JSON.stringify({series,options});
      draw(canvas, series, options);
      ctx.fillText = originalText; ctx.arc = originalArc;
      return { text,points,width:canvas.width,height:canvas.height,displayWidth:canvas.getBoundingClientRect().width,maxWidth:canvas.style.maxWidth,overflow:document.documentElement.scrollWidth>innerWidth,unchanged:before===JSON.stringify({series,options}) };
    });
    assert.equal(result.overflow,false);
    assert.equal(result.maxWidth,'1040px');
    assert.ok(result.width <= 1040 && Math.abs(result.width - result.displayWidth) < 1);
    if (width >= 1440) assert.ok(result.width >= 980);
    assert.equal(result.points.length,4);
    assert.equal(result.points[0].x,result.points[1].x);
    assert.ok(result.points[0].y > result.points[3].y);
    assert.equal(result.unchanged,true);
    assert.ok(result.text.some(item=>item.value==='100'));
    const dates = result.text.filter(item=>/^\d+\/\d+\/\d{4}$/.test(item.value));
    dates.forEach((item,i)=> { assert.ok(item.left >= 0 && item.right <= result.width && item.bottom <= result.height); if(i) assert.ok(item.left >= dates[i-1].right+2); });
    const annotations = result.text.filter(item=>item.y < Math.min(...result.points.map(point=>point.y)));
    annotations.forEach(item=>assert.ok(item.x>=0 && item.x+item.width<=result.width));
    annotations.forEach((item,i)=>annotations.slice(i+1).forEach(other=>assert.ok(Math.abs(item.y-other.y)>=15 || item.x+item.width<=other.x || other.x+other.width<=item.x)));
  }
});

test('legacy consumers retain dimensions; frequency axes, single-point and no-data behavior remain intact', async t => {
  const page = await fixture(t);
  await page.setViewportSize({width:1440,height:1000});
  const result = await page.evaluate(() => {
    const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');
    const text=[]; const original=ctx.fillText.bind(ctx);
    ctx.fillText=(value,...args)=>{ text.push(String(value)); original(value,...args); };
    draw(canvas,[{name:'Count',points:[{x:'2026-01-01',y:0},{x:'2026-02-01',y:12}]}],{yStep:1,graphType:'behavior'});
    const legacy={maxWidth:canvas.style.maxWidth,width:canvas.width,height:canvas.height,ticks:text.filter(x=>/^\d+$/.test(x))};
    text.length=0;
    draw(canvas,[{name:'Count',points:[{x:'2026-01-01',y:0},{x:'2026-02-01',y:12}]}],{layoutMode:'graphs',yStep:1,graphType:'behavior'});
    const ticks=text.filter(x=>/^\d+$/.test(x));
    text.length=0;
    draw(canvas,[{name:'Single',points:[{x:'2026-01-01',y:0}]}],{layoutMode:'graphs',maxY:100});
    const singleText=[...text];
    text.length=0; draw(canvas,[],{layoutMode:'graphs'});
    return {legacy,ticks,singleText,emptyText:text};
  });
  assert.equal(result.legacy.maxWidth,'804px'); assert.equal(result.legacy.width,804); assert.equal(result.legacy.height,440);
  assert.deepEqual(result.ticks,result.legacy.ticks);
  assert.ok(result.singleText.includes('1/1/2026')); assert.ok(!result.singleText.includes('Treatment'));
  assert.ok(result.emptyText.includes('No session data yet'));
});

test('only Graphs entry points opt into the responsive mode', () => {
  assert.equal((app.match(/layoutMode: "graphs"/g)||[]).length,5);
  assert.equal((app.match(/layoutMode: options.layoutMode/g)||[]).length,2);
  for (const key of ['drawBehaviorChartSet(sessions, container, "report-behavior-chart"','drawParentTrainingChartSet(sessions, container, "report-parent-training-chart"']) {
    const start=app.indexOf(key); assert.ok(start>=0); assert.doesNotMatch(app.slice(start,app.indexOf('});',start)),/layoutMode/);
  }
});

test('date orientation adapts to density and angled bounds retain more ticks where space permits', () => {
  const sparse = ['2026-01-01','2026-02-01','2026-03-01'];
  assert.equal(layoutDateTicks(sparse, [64,500,1000], measure,8,1032).angle,0);
  const dense = dates(100);
  const positions = buildChartLayout(dense,64,956,null).dateXPositions;
  const horizontal = buildPixelDateTicks(dense,positions,measure,8,1032);
  const layout = layoutDateTicks(dense,positions,measure,8,1032);
  assert.equal(layout.angle,-Math.PI/6);
  assert.ok(layout.ticks.length > horizontal.length);
  assert.equal(layout.ticks[0].date,dense[0]);
  assert.equal(layout.ticks.at(-1).date,dense.at(-1));
  layout.ticks.forEach((tick,i) => {
    assert.ok(tick.labelX-tick.labelWidth/2>=8 && tick.labelX+tick.labelWidth/2<=1032);
    if(i) assert.ok(tick.labelX-tick.labelWidth/2 >= layout.ticks[i-1].labelX+layout.ticks[i-1].labelWidth/2+4);
  });
});

test('dense rotated dates remain unclipped and separated at desktop, tablet and mobile widths', async t => {
  const page = await fixture(t);
  for (const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    const result = await page.evaluate(values => {
      const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),labels=[];
      const original=ctx.fillText.bind(ctx);
      ctx.fillText=(value,x,y,...rest)=>{
        if (/^\d+\/\d+\/\d{4}$/.test(value)) {
          const m=ctx.getTransform(),b=ctx.measureText(value);
          const corners=[[-b.actualBoundingBoxLeft,-b.actualBoundingBoxAscent],[b.actualBoundingBoxRight,-b.actualBoundingBoxAscent],[-b.actualBoundingBoxLeft,b.actualBoundingBoxDescent],[b.actualBoundingBoxRight,b.actualBoundingBoxDescent]].map(([dx,dy])=>({x:m.a*(x+dx)+m.c*(y+dy)+m.e,y:m.b*(x+dx)+m.d*(y+dy)+m.f}));
          labels.push({value,angle:Math.atan2(m.b,m.a),left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))});
        }
        original(value,x,y,...rest);
      };
      draw(canvas,[{name:'Synthetic dense',points:values.map((x,i)=>({x,y:i%101}))}],{layoutMode:'graphs',maxY:100});
      ctx.fillText=original;
      const panel=document.querySelector('.graphs-panel').getBoundingClientRect();
      return {labels,width:canvas.width,height:canvas.height,overflow:document.documentElement.scrollWidth>innerWidth,panelWidth:panel.width,panelLeft:panel.left,panelRight:panel.right,viewport:innerWidth};
    },dates(120));
    assert.equal(result.overflow,false);
    assert.ok(result.panelWidth<=1120);
    assert.ok(Math.abs(result.panelLeft-(result.viewport-result.panelRight))<1);
    assert.ok(result.labels.length>=2);
    result.labels.forEach((label,i)=>{
      assert.ok(Math.abs(label.angle+Math.PI/6)<1e-6);
      assert.ok(label.left>=0 && label.right<=result.width && label.top>=0 && label.bottom<=result.height);
      if(i) assert.ok(label.left>=result.labels[i-1].right+2);
    });
    assert.equal(result.labels[0].value,'1/1/2026');
    assert.equal(result.labels.at(-1).value,'4/30/2026');
  }
});
