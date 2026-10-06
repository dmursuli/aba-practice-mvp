import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sanitizeClinicalSnapshot,snapshotPhaseConfig,reportSnapshotDisclosure} from '../public/report-snapshot.js';
import {buildFunderDraftRecord,hasMeaningfulFunderReportDraft,summarizeSkillAcquisitionReport} from '../public/report-utils.js';
import {explicitParentTrainingGoalState,parentTrainingGoalMasteryDate,parentTrainingGoalKey,filterMasteredGoalsForPeriod,summarizeParentTrainingReport} from '../public/parent-training-report.js';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const extract=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^}`, 'm'))[0];
const raw={version:1,clientId:'client',capturedAt:'2026-09-30',clientName:'Captured client',preparationDate:'2026-09-30',programs:[{id:'p',name:'Captured program',objective:'Captured objective',status:'active',targets:[{id:'t',name:'Captured target',status:'mastered',maintenanceDate:'2026-04-01'},{id:'legacy',name:'Legacy target',status:'maintenance'}]}],behaviors:[{id:'b',name:'Captured behavior',status:'inactive'}],caregiverGoals:[{id:'g',goalName:'Captured caregiver goal',targetName:'Target',status:'active'}],masteryCriteria:{thresholdPercent:90,consecutiveSessions:2},phases:{'skill:p':{treatmentPhaseLine:{date:'2026-03-01'},phaseMarkers:[{date:'2026-04-01',label:'Target mastered',detail:'Captured target'}]}},defaults:{background:'Captured background'}};

test('snapshot allowlist excludes raw observations and retains report configuration',()=>{
  const snap=sanitizeClinicalSnapshot({...raw,sessions:[{y:12}],programs:raw.programs.map(p=>({...p,observations:[1]}))});
  assert.equal(snap.sessions,undefined);assert.equal(snap.programs[0].observations,undefined);
  assert.equal(snap.programs[0].targets[0].programId,'p');
  assert.deepEqual(buildFunderDraftRecord({existingDraft:{clinicalSnapshot:snap},sections:{background:'Manual'}}).clinicalSnapshot,snap);
  assert.match(reportSnapshotDisclosure(null,true),/Legacy draft/);
  assert.match(reportSnapshotDisclosure(snap),/not finalized or immutable/);
  assert.equal(snapshotPhaseConfig(snap,'unknown').treatmentPhaseLine,null);
});

test('actual report models keep captured programs, caregiver state and statuses despite live changes',()=>{
  const snap=sanitizeClinicalSnapshot(raw);
  const live={id:'client',profile:{funderReport:{clinicalSnapshot:snap}}};
  const context=vm.createContext({currentClient:()=>live,reportSnapshotDisclosure,hasMeaningfulFunderReportDraft,
    clientPrograms:()=>[{id:'p',name:'New live',targets:[]}],currentSessions:()=>[],currentMasteryCriteria:()=>({thresholdPercent:1}),
    currentParentTrainingGoals:()=>[{goalName:'New live caregiver',status:'mastered'}],parentTrainingSessionsForRange:()=>[],
    explicitParentTrainingGoalState,parentTrainingGoalMasteryDate,parentTrainingGoalKey,filterMasteredGoalsForPeriod,summarizeParentTrainingReport,
    summarizeSkillAcquisitionReport,escapeHtml:String});
  vm.runInContext(['reportClinicalContext','skillAcquisitionReportModel','parentTrainingReportModel','renderReportProgramInfo'].map(extract).join('\n'),context);
  const markup=context.renderReportProgramInfo(snap.programs[0]);
  assert.match(markup,/Captured objective/);assert.match(markup,/Mastered \/ maintenance targets:/);
  assert.match(markup,/Captured target, Legacy target/);
  const caregiver=context.parentTrainingReportModel('2026-01-01','2026-12-31');
  assert.ok(JSON.stringify(caregiver.activeGoals).includes('Captured caregiver goal'));
  assert.ok(!JSON.stringify(caregiver).includes('New live caregiver'));
  assert.ok(!JSON.stringify(context.skillAcquisitionReportModel('2026-01-01','2026-12-31')).includes('New live'));
});

test('save captures only new drafts; ordinary saves retain context; deliberate refresh preserves narrative',async()=>{
  let client={id:'client',profile:{funderReport:{}}};let captured=0;let authorized=true;let confirmed=true;
  const ctx=vm.createContext({canEditClinical:()=>authorized,currentClient:()=>client,hasMeaningfulFunderReportDraft,
    currentFunderReportDraft:()=>({...client.profile.funderReport,background:'Manual narrative'}),
    captureReportClinicalSnapshot:()=>{captured++;return sanitizeClinicalSnapshot(raw);},
    updateClientProfile:async(id,payload)=>({...client,profile:{funderReport:payload.funderReport}}),
    currentClientProfilePayload:()=>({}),replaceClient:updated=>{client=updated;},state:{},
    parentTrainingGoalKey,reportDraftSnapshot:JSON.stringify,updateResumeDraftButtonState:()=>{},estimateJsonBytes:()=>100,
    funderExportStatus:{textContent:''},currentView:()=> 'plan',window:{confirm:()=>confirmed}});
  vm.runInContext(['currentReportIncludedContent','handleSaveFunderReportDraft','handleRefreshReportClinicalSnapshot'].map(extract).join('\n'),ctx);
  await ctx.handleSaveFunderReportDraft();assert.equal(captured,1);
  await ctx.handleSaveFunderReportDraft();assert.equal(captured,1);
  confirmed=false;await ctx.handleRefreshReportClinicalSnapshot();assert.equal(captured,1);
  confirmed=true;await ctx.handleRefreshReportClinicalSnapshot();assert.equal(captured,2);
  assert.equal(client.profile.funderReport.background,'Manual narrative');
  assert.deepEqual(Array.from(client.profile.funderReport.includedContent.programIds),['p']);
  client.profile.funderReport={background:'Legacy'};await ctx.handleSaveFunderReportDraft();assert.equal(captured,2);
  assert.equal(client.profile.funderReport.clinicalSnapshot,undefined);
  authorized=false;await ctx.handleRefreshReportClinicalSnapshot();assert.equal(captured,2);
});

test('report context reaches lazy, print, export and phase annotation paths without global client replacement',()=>{
  assert.match(extract('drawFunderReportCharts'),/spec.kind, context/);
  assert.match(extract('drawFunderReportCharts'),/dataset.reportChartKind, context/);
  assert.match(extract('prepareFunderReportForExport'),/drawFunderReportCharts/);
  assert.match(extract('handlePrintFunderReport'),/prepareFunderReportForExport/);
  assert.match(extract('handleDownloadFunderReport'),/prepareFunderReportForExport/);
  for(const name of ['drawSkillChartSet','drawBehaviorChartSet','drawParentTrainingChartSet','renderReportBehaviorOverviewChart']) {
    assert.match(extract(name),/snapshotPhaseConfig/);assert.match(extract(name),/phaseConfig: .*phaseConfig|phaseConfig: context \? behaviorOverviewPhaseConfig/);
    assert.doesNotMatch(extract(name),/state\.clients\s*=|state\.activeClientId\s*=/);
  }
  assert.match(extract('buildFunderReportPreviewMarkup'),/context\?\.preparationDate/);
  assert.match(extract('buildFunderReportPreviewMarkup'),/context\.defaults\[key\]/);
});

test('regenerated report summary uses captured client identity while observations remain live',()=>{
  const ctx=vm.createContext({currentClient:()=>({name:'Renamed live client'}),reportClinicalContext:()=>sanitizeClinicalSnapshot(raw),filteredReportSessions:()=>[{},{}],funderReportMetrics:()=>({averageIndependence:0})});
  vm.runInContext(extract('buildReportProgressSummary'),ctx);
  assert.match(ctx.buildReportProgressSummary(),/Captured client completed 2 documented sessions/);
  assert.doesNotMatch(ctx.buildReportProgressSummary(),/Renamed live client/);
});

test('reopening restores narrative and produces stable preview after live client and defaults change',()=>{
  const snap=sanitizeClinicalSnapshot(raw);
  const draft={clinicalSnapshot:snap,startDate:'2026-01-01',endDate:'2026-09-30',medicalConcerns:'Saved narrative',skillAcquisitionSummary:'Saved skills',parentTrainingSummary:'Saved caregiver summary'};
  const client={id:'client',name:'Original live name',profile:{funderReport:draft}};
  const elements=['startDate','endDate','background','medicalConcerns','skillAcquisitionSummary','parentTrainingSummary'].map(name=>({name,value:'',dataset:{}}));
  let liveDefault='Original live default';
  const ctx=vm.createContext({currentClient:()=>client,reportForm:{elements},
    FormData:class {constructor(form){this.form=form;}get(name){return this.form.elements.find(f=>f.name===name)?.value||'';}},
    reportSnapshotDisclosure,hasMeaningfulFunderReportDraft,escapeHtml:String,formatDate:String,reportParagraph:String,
    filteredReportSessions:()=>[],funderReportMetrics:()=>({averageIndependence:0,targetsReviewed:0,totalBehaviorFrequency:0}),
    sanitizeAssessmentDocumentRefs:()=>({assessmentGrid:[],standardizedAssessmentGrid:[]}),
    graphPhaseLineStoreForClient:()=>({'live-key':[{date:'2026-10-01'}]}),reportAssessmentDocumentRefsFromClient:()=>[],
    reportGraphPreferenceKeys:()=>[],state:{graphTrendVisibility:{}},fadePlanRows:{},serviceHourRows:{},
    defaultFadePlanRows:()=>[],defaultServiceHourRows:()=>[],addFadePlanRow:()=>{},addServiceHourRow:()=>{},renderReportAssessmentDraftFiles:()=>{},
    isLegacyGeneratedSkillAcquisitionSummary:()=>false,isLegacyGeneratedParentTrainingSummary:()=>false,
    safeReportFilePreview:()=>'',renderParentTrainingProgressSummary:String,renderParentTrainingReportSummary:()=>'',
    renderDischargeCriteria:()=>'',renderFadePlanTable:()=>'',renderServiceHoursTable:()=>''});
  for(const name of ['defaultBackgroundInformation','defaultMedicalConcerns','defaultReasonForReferral','defaultImpactOfBehaviors','defaultFamilyStrengths','defaultInitialObservations','defaultInstructionalGoalsInfo','defaultGeneralizationMaintenance','defaultBarriersToTreatmentSummary','defaultRecommendations','defaultMedicalNecessity']) ctx[name]=()=>liveDefault;
  vm.runInContext(['reportClinicalContext','reportContextDisclosure','applyFunderReportDraft','buildFunderReportPreviewMarkup'].map(extract).join('\n'),ctx);
  ctx.applyFunderReportDraft(draft);
  const original=ctx.buildFunderReportPreviewMarkup();
  client.name='Changed live name';liveDefault='Changed live default';
  client.programs=[{id:'new',name:'New live program'}];client.behaviors=[];
  elements.forEach(field=>{field.value='';});
  ctx.applyFunderReportDraft(draft);
  assert.equal(ctx.buildFunderReportPreviewMarkup(),original);
  assert.match(original,/Captured client/);assert.match(original,/Captured background/);
  assert.match(original,/Saved narrative/);assert.match(original,/2026-09-30/);
  assert.deepEqual(client.profile.funderReport.clinicalSnapshot,snap);
  assert.ok(ctx.state.reportCustomPhaseLines['live-key'],'restoring report does not erase live graph phases');
  delete draft.clinicalSnapshot;
  const legacy=ctx.buildFunderReportPreviewMarkup();
  assert.match(legacy,/Legacy draft/);assert.match(legacy,/Changed live name/);assert.match(legacy,/Changed live default/);
  assert.equal(draft.clinicalSnapshot,undefined);
});
