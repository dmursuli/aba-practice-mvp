import crypto from 'node:crypto';
import { clinicalPhaseOf, programPhaseAt } from '../public/charts.js';
import { graphNumericValue } from '../public/graph-values.js';
import { historicalProgramDates, skillGraphMeasurement } from '../public/skill-graph-measurements.js';

export const BASELINE_REQUIRED = 'Collect at least one baseline observation before beginning treatment.';
export function programPhaseRecords(client, programId) {
  return client.profile?.graphPhaseLines?.[`skill:${programId}`] || [];
}
function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
function appendPhase(client, programId, phase, context, now, initial = false) {
  const key = `skill:${programId}`;
  const record = {id:crypto.randomUUID(), graphId:key, graphType:'skill', phaseType:'environmental',
    clinicalPhase:phase, label:phase === 'intervention' ? 'Treatment' : 'Baseline', date:context.sessionDate,
    effectiveAt:now, sessionId:context.sessionId || '', initial, source:'user', lineStyle:'solid',
    editable:false, createdAt:now, updatedAt:now};
  client.profile = {...client.profile, graphPhaseLines:{...client.profile?.graphPhaseLines,
    [key]:[...programPhaseRecords(client,programId),record]}};
  return record;
}
// Called only for newly submitted program IDs, never at startup or during reads.
export function initializeNewProgramPhases(client, previousIds, context, now = new Date().toISOString()) {
  for (const program of client.programs || []) {
    if (!previousIds.has(program.id) && !programPhaseRecords(client,program.id).length) {
      appendPhase(client,program.id,'baseline',context,now,true);
    }
  }
}
export function hasProgramBaseline(db, client, programId) {
  const records=programPhaseRecords(client,programId);
  return (db.sessions || []).filter(session=>session.clientId===client.id).some(session =>
    (session.programs || []).filter(program=>program.programId===programId).some(program =>
      (program.targets || [program]).some(point=>{
        const type=skillGraphMeasurement(point);
        const value=type && graphNumericValue(type==='frequency' ? point.frequency : point.independence);
        return type && value !== null && value >= 0 && (type==='frequency' ? Number.isInteger(value) : value<=100) && programPhaseAt(records,{...point,x:session.date,recordedAt:point.recordedAt || session.recordedAt})==='baseline';
      })));
}

// Mutate only the requested program's new phase records, the active session's
// newly appended observations, and append-only 97155 change history. No SOAP write.
export function applyProgramClinicalAction(db, clientId, programId, payload, actor, now = new Date().toISOString()) {
  if (!['admin','bcba'].includes(actor?.role)) fail('Only authorized treatment-planning roles may change program phases or save 97155 probes.',403);
  const client=db.clients.find(client=>client.id===clientId);
  const program=client?.programs?.find(program=>program.id===programId);
  if (!program) fail('Program not found.',404);
  const context=payload.sessionContext || {};
  if (!context.sessionId || !/^\d{4}-\d{2}-\d{2}$/.test(context.sessionDate || '') || context.clientId!==clientId) fail('An active 97155 session and clinical date are required.');
  const note=(client.note97155History || []).find(note=>(note.sessionId || note.id)===context.sessionId);
  const noteStatus=String(note?.noteStatus || note?.status || '').trim().toLowerCase();
  if (note && (note.finalized || note.finalizedAt || note.amendedAt || String(note.id || '').startsWith('legacy-') || !['draft',''].includes(noteStatus))) fail('This 97155 note is closed. Start a new clinical session.',409);
  if (note?.lastSavedBy && note.lastSavedBy!==actor.id) fail('This active 97155 session belongs to another provider.',403);
  if (note && note.date!==context.sessionDate) fail('The active session date cannot change.',409);
  let session=(db.sessions || []).find(session=>session.id===context.sessionId);
  if (session && (session.clientId!==clientId || session.date!==context.sessionDate || !session.clinicalDataOnly || session.createdBy!==actor.id)) fail('The active clinical session does not match.',409);
  const phase=programPhaseAt(programPhaseRecords(client,programId),{x:context.sessionDate,recordedAt:now});
  let change;
  if (payload.action==='classify-historical') {
    if (payload.confirmed !== true) fail('Confirm the historical clinical phase decision before saving.');
    if (programPhaseRecords(client,programId).some(record=>clinicalPhaseOf(record))) fail('This program already has an explicit clinical phase. Review the existing phases instead.',409);
    const dates=historicalProgramDates(programId,(db.sessions || []).filter(session=>session.clientId===clientId));
    if (!dates.length) fail('No eligible recorded observations exist for this program.');
    if (!['first','date'].includes(payload.boundaryMode)) fail('Choose a historical Treatment boundary.');
    const singleHistoricalDate=payload.boundaryMode==='first' && dates.length===1;
    const date=payload.boundaryMode==='first' ? (dates[1] || dates[0]) : payload.startDate;
    if (!dates.includes(date)) fail('Choose a date containing an eligible recorded observation.');
    if (typeof payload.baselineBefore !== 'boolean') fail('Explicitly choose whether earlier observations are Baseline.');
    const baselineBefore=payload.boundaryMode==='first' || payload.baselineBefore;
    const key=`skill:${programId}`;
    const record={id:crypto.randomUUID(),graphId:key,graphType:'skill',phaseType:'environmental',
      clinicalPhase:'intervention',label:'Treatment',date,historicalDecision:true,baselineBefore,
      ...(singleHistoricalDate ? {effectiveAt:now,position:'after-date'} : {}),
      decidedBy:actor.id,decidedAt:now,sessionId:context.sessionId,source:'user',editable:false,lineStyle:'solid',
      createdAt:now,updatedAt:now,
      note:singleHistoricalDate
        ? `BCBA-entered historical classification. All historical observations on ${date} are Baseline; Treatment established afterward at confirmation.`
        : `BCBA-entered historical classification. Treatment from ${date}; earlier observations ${baselineBefore?'are Baseline':'remain unclassified'}.`};
    const additions=[];
    if (singleHistoricalDate) {
      // Date-only Baseline covers historical observations without inventing times.
      // The real confirmation time activates Treatment, even on today's date.
      const {effectiveAt,position,...baseline}=record;
      additions.push({...baseline,id:crypto.randomUUID(),clinicalPhase:'baseline',label:'Baseline',initial:true});
    }
    additions.push(record);
    client.profile={...client.profile,graphPhaseLines:{...client.profile?.graphPhaseLines,[key]:[...programPhaseRecords(client,programId),...additions]}};
    change={type:'program-phase-changed',toValue:'Treatment',note:record.note};
  } else if (payload.action==='start-treatment') {
    if (phase!=='baseline') fail('Start Treatment is available only while the program is in Baseline.',409);
    if (!hasProgramBaseline(db,client,programId)) fail(BASELINE_REQUIRED);
    appendPhase(client,programId,'intervention',context,now);
    change={type:'program-phase-changed',fromValue:'Baseline',toValue:'Treatment',note:'Baseline performance reviewed; treatment explicitly started.'};
  } else if (payload.action==='establish-baseline') {
    if (phase) fail('This program already has an explicit phase.',409);
    appendPhase(client,programId,'baseline',context,now,true);
    change={type:'program-phase-changed',toValue:'Baseline',note:'Baseline established prospectively.'};
  } else if (payload.action==='save-observation') {
    if (!phase) fail('Establish a program phase before saving a 97155 observation.');
    const target=program.targets?.find(target=>target.id===payload.targetId);
    if (!target) fail('Select a target in this program.');
    const value=graphNumericValue(payload.value);
    const type=program.dataCollectionType==='frequency' ? 'frequency' : 'percent_correct';
    if (value===null || value<0 || (type==='percent_correct' && value>100) || (type==='frequency' && !Number.isInteger(value))) fail('Enter a valid observation (0–100 percent or a nonnegative whole frequency).');
    if (!session) {
      session={id:context.sessionId,clientId,agency:client.agency,date:context.sessionDate,serviceType:'97155',serviceCode:'97155',clinicalDataOnly:true,
        status:'draft',createdBy:actor.id,therapist:actor.name || actor.username,createdAt:now,
        startTime:context.startTime || '',endTime:context.endTime || '',setting:context.setting || '',programs:[],behaviors:[]};
      (db.sessions ||= []).push(session);
    }
    let group=session.programs.find(group=>group.programId===programId);
    if (!group) {group={programId,targets:[]};session.programs.push(group);}
    group.targets.push({id:crypto.randomUUID(),targetId:target.id,dataCollectionType:type,
      [type==='frequency'?'frequency':'independence']:value,recordedAt:now,phase,
      phaseRecordId:programPhaseRecords(client,programId).filter(record => clinicalPhaseOf(record) && record.date<=context.sessionDate && (!record.effectiveAt || record.effectiveAt<=now)).slice().sort((a,b)=>a.date.localeCompare(b.date) || String(a.effectiveAt || '').localeCompare(String(b.effectiveAt || ''))).at(-1)?.id});
    change={type:'program-observation-recorded',targetId:target.id,targetName:target.name,
      fromValue:phase,toValue:String(value),note:`${phase==='baseline'?'Baseline probe':'Clinical observation'} recorded: ${value}${type==='percent_correct'?'%':' count'}.`};
  } else fail('Unsupported program action.');
  const entry={id:crypto.randomUUID(),clientId,sessionId:context.sessionId,sessionDate:context.sessionDate,date:context.sessionDate,
    serviceCode:'97155',context:'treatment-planning',timestamp:now,programId,programName:program.name,...change};
  client.planChangeLog=[...(client.planChangeLog || []),entry];
  return {client,session:session || null};
}

// The general graph editor cannot bypass the timed 97155 workflow or remove its
// provenance. Clinicians can append supported phase annotations prospectively.
export function validateManagedPhaseEdit(client, next) {
  for (const [key, records] of Object.entries(client.profile?.graphPhaseLines || {})) {
    const managed=records.filter(record=>record.effectiveAt || record.historicalDecision);
    if (!managed.length) continue;
    const incoming=next[key] || [];
    for (const record of managed) {
      const match=incoming.find(item=>item.id===record.id);
      if (!match || Object.entries(record).some(([field,value])=>match[field]!==value)) fail('Timed program phases must be retained. Use the program clinical workflow to add a phase transition.',409);
    }
    const added=incoming.filter(record=>!records.some(old=>old.id===record.id));
    if (added.some(record=>clinicalPhaseOf(record)==='intervention')) fail('Use Start Treatment in Treatment Planning to begin intervention.',409);
  }
}
