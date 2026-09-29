import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { graphObservationProvider } from '../public/charts.js';
const read = file => readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
let browser;
before(async()=>{ browser=await chromium.launch({headless:true}); });
after(async()=>{ await browser?.close(); });
async function fixture(t,touch=false) {
  const context=await browser.newContext({hasTouch:touch}); t.after(()=>context.close());
  const page=await context.newPage();
  await page.route('**/*',r=>r.abort());
  await page.setContent(`<style>${read('styles.css')}</style><main style="padding:14px"><canvas></canvas></main>`);
  await page.addScriptTag({type:'module',content:read('graph-values.js')+read('charts.js').replace(/^import .*;$/gm,'')+`
    const canvas=document.querySelector('canvas');
    const series=[{name:'Target A',points:[{x:'2026-09-01',y:0,provider:graphObservationProvider({therapist:'Recorded Provider'})},{x:'2026-09-01',y:60},{x:'2026-09-02',y:null},{x:'2026-09-23',y:80}]},
      {name:'Target B',points:[{x:'2026-09-01',y:60},{x:'2026-09-23',y:90}]}];
    const options={layoutMode:'graphs',yLabel:'Percent correct',maxY:100,showTrendLine:true,
      phaseMarkers:[{date:'2026-09-23',label:'Target mastered',detail:'Target A',phaseType:'targetMastered',position:'after-date'}]};
    window.draw=()=>drawLineChart(canvas,series,options);
    window.empty=()=>drawLineChart(canvas,[],options);
    window.explicit=()=>drawLineChart(canvas,series,{...options,treatmentPhaseLine:{date:'2026-09-23'}});
    window.genericMarker=()=>drawLineChart(canvas,series,{...options,phaseMarkers:[{date:'2026-09-23',label:'Objective changed',phaseType:'environmentalChange'}]});
    window.toggle=()=>redrawLineChartTrend(canvas,false);
    window.snapshot=()=>JSON.stringify(series);
    window.inspection=()=>canvas.__graphInspection.groups;
    window.position=(group=0,entry=0)=>{
      const p=canvas.__graphInspection.groups[group].entries[entry],r=canvas.getBoundingClientRect();
      return {x:r.left+p.x*r.width/(canvas.width/devicePixelRatio),y:r.top+(p.y??p.top)*r.height/(canvas.height/devicePixelRatio)};
    };
    window.draw();
  `});
  await page.waitForFunction(()=>window.inspection?.().length);
  return page;
}

test('hover, pinned click, coincident observations, missing values and marker metadata',async t=>{
  const page=await fixture(t);
  const before=await page.evaluate(()=>snapshot());
  const p=await page.evaluate(()=>position());
  await page.mouse.move(p.x,p.y);
  const details=page.locator('.graph-inspection-details');
  const tooltip=page.locator('.graph-hover-tooltip');
  assert.equal(await details.textContent(),'');
  assert.equal(await tooltip.isVisible(),true);
  assert.equal(await tooltip.locator('li').count(),1);
  assert.match(await tooltip.textContent(),/Target A — 0 Percent correct — Provider: Recorded Provider/);
  assert.doesNotMatch(await tooltip.textContent(),/Target B|60 Percent correct/);
  assert.match(await tooltip.textContent(),/2026/);
  await page.mouse.move(0,0);
  assert.equal(await tooltip.isVisible(),false);
  assert.equal(await details.textContent(),'');
  await page.mouse.click(p.x+10,p.y);
  const last=await page.evaluate(()=>position(1));
  await page.mouse.move(last.x,last.y);
  assert.equal(await details.locator('li').count(),3);
  assert.match(await tooltip.textContent(),/80 Percent correct/);
  assert.match(await details.textContent(),/0 Percent correct/);
  await page.mouse.move(0,0);
  assert.equal(await tooltip.isVisible(),false);
  assert.match(await details.textContent(),/0 Percent correct/);
  await page.mouse.click(last.x,last.y);
  assert.match(await details.textContent(),/Target mastered — Target A/);
  assert.match(await details.textContent(),/80 Percent correct/);
  assert.equal(await details.locator('li').count(),3);
  assert.doesNotMatch(await details.textContent(),/Objective|seconds|minutes/);
  assert.equal(await page.evaluate(()=>inspection().length),2);
  assert.equal(await page.evaluate(()=>snapshot()),before);
  await page.evaluate(()=>toggle());
  assert.match(await details.textContent(),/Target mastered/);
  assert.equal(await page.locator('canvas').getAttribute('title'),'');
});

test('keyboard controller, focus, clear and empty redraw',async t=>{
  const page=await fixture(t);
  const select=page.getByRole('combobox',{name:'Inspect graph observations by date'});
  await page.keyboard.press('Tab');
  assert.equal(await select.evaluate(el=>el===document.activeElement),true);
  await select.press('ArrowDown');
  assert.match(await page.getByRole('status').textContent(),/Target A/);
  await select.selectOption('1');
  assert.match(await page.getByRole('status').textContent(),/Target mastered/);
  await page.getByRole('button',{name:'Clear selection'}).click();
  assert.equal(await page.locator('.graph-inspection-details').textContent(),'');
  assert.equal(await select.evaluate(el=>el===document.activeElement),true);
  await select.selectOption('0');
  await select.press('Escape');
  assert.equal(await select.inputValue(),'-1');
  await page.evaluate(()=>empty());
  assert.equal(await select.isVisible(),false);
  await page.evaluate(()=>draw());
  assert.equal(await select.inputValue(),'-1');
});

test('touch selection and compact responsive surface',async t=>{
  const page=await fixture(t,true);
  for(const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>draw());
    const p=await page.evaluate(()=>position());
    await page.touchscreen.tap(p.x+12,p.y);
    assert.match(await page.getByRole('status').textContent(),/Target A — 0/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('.graph-inspection select').count(),1);
    await page.getByRole('button',{name:'Clear selection'}).click();
  }
});


test('marker hit path exposes only supplied details and phases use existing classification',async t=>{
  const page=await fixture(t);
  const marker=await page.evaluate(()=>position(1,2));
  await page.mouse.click(marker.x,marker.y+12);
  assert.match(await page.getByRole('status').textContent(),/Target mastered — Target A/);
  await page.evaluate(()=>genericMarker());
  const select=page.getByRole('combobox',{name:'Inspect graph observations by date'});
  assert.equal(await select.inputValue(),'-1');
  await select.selectOption('1');
  const markerRow=page.locator('.graph-inspection-details li').last();
  assert.match(await markerRow.textContent(),/Objective changed$/);
  assert.doesNotMatch(await markerRow.textContent(),/Target A|mastered|criterion/);
  await page.evaluate(()=>explicit());
  await select.selectOption('0');
  assert.match(await page.getByRole('status').textContent(),/Phase: Baseline/);
  await select.press('ArrowRight');
  assert.match(await page.getByRole('status').textContent(),/Phase: Treatment/);
});


test('recorded provider name is carried only when it represents collection, never an import actor',()=>{
  assert.equal(graphObservationProvider({therapist:'  Collector Name  '}),'Collector Name');
  for(const session of [{}, {therapist:''}, {therapist:' '}, {therapist:12},
    {therapist:'Importer',historicalImport:{}}, {therapist:'Importer',historicalImportBatchId:'batch'},
    {therapist:'Importer',source:'historical-import'}, {therapist:'Importer',source:'historical_import'}]) {
    assert.equal(graphObservationProvider(session),null);
  }
  assert.equal(graphObservationProvider({therapist:'Importer'},{historicalImportMeasurementType:'frequency'}),null);
});

test('hover overlay stays within canvas edges and adds no focus target',async t=>{
  const page=await fixture(t);
  for(const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>draw());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    for(const group of [0,1]) {
      const p=await page.evaluate(g=>position(g),group);
      await page.mouse.move(0,0);
      await page.mouse.move(p.x,p.y);
      const tooltip=page.locator('.graph-hover-tooltip');
      assert.equal(await tooltip.isVisible(),true);
      const b=await tooltip.boundingBox(),c=await page.locator('canvas').boundingBox();
      assert.ok(b.x>=c.x && b.y>=c.y && b.x+b.width<=c.x+c.width+1 && b.y+b.height<=c.y+c.height+1);
      assert.equal(await tooltip.locator('button,input,select,[tabindex]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
  }
});


test('hover picks one nearest series point and resolves coincident points in render order',async t=>{
  const page=await fixture(t);
  const tooltip=page.locator('.graph-hover-tooltip');
  const overlap=await page.evaluate(()=>position(0,1));
  for(let i=0;i<2;i++) {
    await page.mouse.move(0,0);
    await page.mouse.move(overlap.x,overlap.y);
    assert.equal(await tooltip.locator('li').count(),1);
    assert.match(await tooltip.textContent(),/Target A — 60 Percent correct/);
    assert.doesNotMatch(await tooltip.textContent(),/Target B|Provider:/);
  }
  await page.mouse.click(overlap.x,overlap.y);
  assert.equal(await page.locator('.graph-inspection-details li').count(),3);
  assert.match(await page.locator('.graph-inspection-details').textContent(),/Target B/);
  const point=await page.evaluate(()=>position(1,1));
  await page.mouse.move(point.x,point.y+8);
  assert.equal(await tooltip.locator('li').count(),1);
  assert.match(await tooltip.textContent(),/Target B — 90 Percent correct/);
  assert.doesNotMatch(await tooltip.textContent(),/Target A|80 Percent correct/);
  assert.equal(await page.locator('.graph-inspection-details li').count(),3);
});
