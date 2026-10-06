import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sanitizeAssessmentDocumentRefs } from '../public/report-utils.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
const ref=(id,name=id+'.png')=>({fileId:id,originalFileName:name});
function fixture() {
  const client={profile:{documents:[{id:'a'},{id:'b'},{id:'c'},{id:'std'},{id:'unrelated'}],funderReport:{clinicalSnapshot:{version:1},assessmentDocuments:{assessmentGrid:[ref('a'),ref('b'),ref('c')],standardizedAssessmentGrid:[ref('std')]}}}};
  const state={reportAssessmentDocuments:structuredClone(client.profile.funderReport.assessmentDocuments),graphTrendVisibility:{}};
  const ctx=vm.createContext({state,sanitizeAssessmentDocumentRefs,currentClient:()=>client,canEditClinical:()=>true,window:{confirm:()=>true},
    reportAssessmentFieldConfig:name=>['assessmentGrid','standardizedAssessmentGrid'].includes(name)?{label:name}:null,
    reportAssessmentDocumentRefsFromClient:()=>{throw Error('must not regenerate references');},
    markReportDraftDirty:()=>{},renderReportAssessmentDraftFiles:()=>{},currentView:()=> 'plan',funderExportStatus:{},
    handleSaveFunderReportDraft:async()=>{client.profile.funderReport.assessmentDocuments=structuredClone(state.reportAssessmentDocuments);return true;},
    reportForm:{elements:[]},graphPhaseLineStoreForClient:()=>({}),sanitizeCustomPhaseLines:()=>({}),reportGraphPreferenceKeys:()=>[],
    fadePlanRows:{},serviceHourRows:{},defaultFadePlanRows:()=>[],defaultServiceHourRows:()=>[],addFadePlanRow:()=>{},addServiceHourRow:()=>{}});
  vm.runInContext(['reportAssessmentRefs','setReportAssessmentRefs','handleReportAttachmentRemove','applyFunderReportDraft'].map(extract).join('\n'),ctx);
  return {ctx,client,state};
}
test('sequential removal, last-item removal and reopen never regenerate refs or touch other documents',async()=>{
  const {ctx,client,state}=fixture();const docs=structuredClone(client.profile.documents);
  for(const id of ['a','b','c']) {
    await ctx.handleReportAttachmentRemove('assessmentGrid',id);
    ctx.applyFunderReportDraft(client.profile.funderReport);
    assert.ok(!ctx.reportAssessmentRefs('assessmentGrid').some(r=>r.fileId===id));
  }
  assert.equal(ctx.reportAssessmentRefs('assessmentGrid').length,0);
  assert.equal(ctx.reportAssessmentRefs('standardizedAssessmentGrid')[0].fileId,'std');
  await ctx.handleReportAttachmentRemove('standardizedAssessmentGrid','std');
  ctx.applyFunderReportDraft(client.profile.funderReport);
  assert.equal(ctx.reportAssessmentRefs('standardizedAssessmentGrid').length,0);
  assert.deepEqual(client.profile.documents,docs);
  assert.deepEqual(client.profile.funderReport.clinicalSnapshot,{version:1});
  assert.equal(state.reportAttachmentRemovalPending,false);
});
test('failed removal save restores references and authorization prevents removal',async()=>{
  const {ctx}=fixture();ctx.handleSaveFunderReportDraft=async()=>false;
  await ctx.handleReportAttachmentRemove('assessmentGrid','a');assert.equal(ctx.reportAssessmentRefs('assessmentGrid').length,3);
  ctx.canEditClinical=()=>false;await ctx.handleReportAttachmentRemove('assessmentGrid','a');assert.equal(ctx.reportAssessmentRefs('assessmentGrid').length,3);
});
test('images render inline, documents stay links, and unavailable references are nonfatal',()=>{
  const documents={png:{url:'/file/png',contentType:'image/png'},jpg:{url:'/file/jpg',contentType:'image/jpeg'},pdf:{url:'/file/pdf',contentType:'application/pdf'},noUrl:{contentType:'image/png'}};
  const ctx=vm.createContext({currentClientDocumentById:id=>documents[id],escapeHtml:String});
  vm.runInContext(['assessmentDocumentCanRenderInline','reportFilePreview'].map(extract).join('\n'),ctx);
  for(const id of ['png','jpg']) {const html=ctx.reportFilePreview([ref(id)],'Grid');assert.match(html,/<img src="\/file\//);assert.doesNotMatch(html,/<details/);assert.match(html,/<figcaption/);}
  const pdf=ctx.reportFilePreview([ref('pdf','test.pdf')],'Grid');assert.match(pdf,/<a href="\/file\/pdf"/);assert.doesNotMatch(pdf,/<img/);
  for(const id of ['missing','noUrl']) {const html=ctx.reportFilePreview([ref(id)],'Grid');assert.match(html,/stored file reference missing/);assert.doesNotMatch(html,/<img/);}
});
test('report phase details are suppressed before reading live phase state',()=>{
  const ctx=vm.createContext({});vm.runInContext(extract('renderCustomPhaseLineManager'),ctx);
  assert.equal(ctx.renderCustomPhaseLineManager('skill:p',[],{readOnly:true,phaseConfig:{treatmentPhaseLine:{date:'2026-01-01'},phaseMarkers:[{label:'Mastered'}]}}),'');
  assert.match(extract('renderCustomPhaseLineManager'),/data-phase-line-form/);
});
test('export embeds attachment images only in exported HTML and shares print preparation',async()=>{
  const image={src:'https://local.test/file/png',alt:'Grid',closest:()=>({})};
  const ctx=vm.createContext({fetch:async()=>({ok:true,blob:async()=>({})}),blobToDataUrl:async()=> 'data:image/png;base64,test'});
  vm.runInContext(extract('inlineReportImages'),ctx);
  await ctx.inlineReportImages({querySelectorAll:()=>[image]});assert.equal(image.src,'data:image/png;base64,test');
  assert.match(extract('prepareFunderReportForExport'),/loadDeferredReportAttachmentImages/);
  assert.match(extract('handlePrintFunderReport'),/await prepareFunderReportForExport/);
  assert.match(extract('handleDownloadFunderReport'),/await prepareFunderReportForExport/);
  assert.match(extract('funderReportHtml'),/await inlineReportImages\(clone\)/);
  assert.match(extract('renderFunderReportPreview'),/Image preview unavailable/);
});

test('inline image keeps aspect ratio and fits narrow preview and print widths',async()=>{
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const imageUrl='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="white"/></svg>');
    const ctx=vm.createContext({currentClientDocumentById:()=>({url:imageUrl,contentType:'image/png'}),escapeHtml:String});
    vm.runInContext(['assessmentDocumentCanRenderInline','reportFilePreview'].map(extract).join('\n'),ctx);
    const styles=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
    await page.setContent(`<style>${styles}</style><div class="report-document">${ctx.reportFilePreview([ref('grid')],'Grid')}</div>`);
    for(const width of [1024,390,320]) {
      await page.setViewportSize({width,height:900});
      for(const media of ['screen','print']) {
        await page.emulateMedia({media});
        await page.locator('img').evaluate(img=>img.decode());
        const dimensions=await page.locator('img').evaluate(img=>({w:img.getBoundingClientRect().width,h:img.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}));
        assert.equal(dimensions.overflow,false);
        assert.ok(Math.abs((dimensions.w-2)/(dimensions.h-2)-2)<0.03);
      }
    }
  } finally {await browser.close();}
});
