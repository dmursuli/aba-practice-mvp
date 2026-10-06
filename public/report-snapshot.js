// Report configuration only. Never accept raw observations or session histories.
const text = value => typeof value === 'string' ? value : '';
const fields = (value, keys) => Object.fromEntries(keys.map(key => [key, text(value?.[key])]));
const list = value => Array.isArray(value) ? value : [];
const dates = ['masteredDate','masteryDate','maintenanceDate','masteredAt','completedAt','statusChangedAt'];
export const REPORT_DEFAULT_FIELDS = ['background','medicalConcerns','reasonReferral','impactBehaviors','familyStrengths','initialObservations','instructionalGoalsInfo','generalizationMaintenance','barriersToTreatmentSummary','recommendations','medicalNecessity','dischargeCriteria'];
const marker = value => ({...fields(value,['id','date','label','detail','targetName','objectiveName','note','phaseType','lineStyle','position','sourceType']),
  hidden:value?.hidden===true,deleted:value?.deleted===true,targetIds:list(value?.targetIds).map(text)});
export function sanitizeClinicalSnapshot(value) {
  if (!value || value.version !== 1) return null;
  return {
    version:1,...fields(value,['capturedAt','capturedBy','clientId','sourcePlanUpdatedAt','clientName','preparationDate']),
    reportingPeriod:fields(value.reportingPeriod,['startDate','endDate']),
    programs:list(value.programs).map(program=>({...fields(program,['id','name','domain','objective','status','dataCollectionType',...dates]),
      targets:list(program.targets).map(target=>({...fields(target,['id','name','status','dateAdded',...dates]),programId:text(program.id)}))})),
    behaviors:list(value.behaviors).map(behavior=>fields(behavior,['id','name','status'])),
    caregiverGoals:list(value.caregiverGoals).map(goal=>({...fields(goal,['id','parentTrainingGoalId','goalId','targetId','goalName','targetName','domain','trainingFocus','status',...dates]),...Object.fromEntries(['active','mastered'].filter(key=>typeof goal[key]==='boolean').map(key=>[key,goal[key]]))})),
    masteryCriteria:Object.fromEntries(['thresholdPercent','consecutiveSessions','stagnantConsecutiveSessions','stagnantMinimumGain'].flatMap(key=>Number.isFinite(value.masteryCriteria?.[key])?[[key,value.masteryCriteria[key]]]:[])),
    planChangeLog:list(value.planChangeLog).filter(change=>['program-status-changed','target-status-changed'].includes(change?.type)).map(change=>fields(change,['id','date','type','programId','programName','targetId','targetName','domain','fromStatus','toStatus','objective'])),
    phases:Object.fromEntries(Object.entries(value.phases || {}).map(([key,config])=>[key,{
      treatmentPhaseLine:config?.treatmentPhaseLine?marker(config.treatmentPhaseLine):null,
      phaseMarkers:list(config?.phaseMarkers).map(marker)
    }])),
    defaults:fields(value.defaults,REPORT_DEFAULT_FIELDS)
  };
}
export function snapshotPhaseConfig(snapshot, key) {
  return snapshot?.phases?.[key] || {treatmentPhaseLine:null,phaseMarkers:[]};
}
export function reportSnapshotDisclosure(snapshot, legacy=false) {
  if (!snapshot) return legacy
    ? 'Legacy draft — some clinical content is generated from current treatment configuration. This is not a frozen historical report.'
    : 'Clinical configuration will be captured when this new draft is first saved.';
  return `Clinical configuration captured ${snapshot.capturedAt}. This reflects configuration at capture time, not proof of configuration during the reporting period. Session corrections, additions or deletions may change numeric results. This draft is not finalized or immutable.`;
}
