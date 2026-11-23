export function sessionDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return 0;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return Math.max(0, end - start);
}

export function billingUnits(minutes) {
  if (!minutes) return 0;
  return Math.max(1, Math.round(minutes / 15));
}


const codes = ['97153','97155','97156','97151'];
const round = value => Math.round(value*100)/100;
const dateOnly = value => String(value || '').slice(0,10);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '');

// Consume existing encounter records only. No ledger, cached usage, or writes.
export function authorizationUtilization(client, sessions = [], period = client.profile?.authorization || {}) {
  const encounters = new Map();
  const representations = [
    ...sessions.filter(record=>record.clientId===client.id && !record.clinicalDataOnly).map(record=>({record,history:false})),
    ...['97151','97155'].flatMap(code=>(client[`note${code}History`] || [])
      .filter(record=>!record.clientId || record.clientId===client.id).map(record=>({record,history:true})))
  ];
  for (const source of representations) {
    const record=source.record;
    // serviceType is the persisted code for direct/parent sessions. No note-text inference.
    const code=String(record.serviceCode || (record.serviceType==='parent-training' ? '97156' : record.serviceType || (source.history ? '' : '97153')));
    if (!codes.includes(code)) continue;
    const date=dateOnly(record.date);
    const id=record.sessionId || record.id;
    const identity=id ? `${code}:id:${id}` : `${code}:time:${date}:${record.startTime}:${record.endTime}:${record.therapist || record.providerSignature || ''}:${record.setting || ''}`;
    const previous=encounters.get(identity);
    const revision=String(record.updatedAt || record.lastSavedAt || record.createdAt || '');
    if (!previous || revision>previous.revision || (revision===previous.revision && source.history)) {
      encounters.set(identity,{...source,code,date,revision});
    }
  }
  const rows=[];
  for (const {record,history,code,date} of encounters.values()) {
    const status=String(record.noteStatus || record.status || '').trim().toLowerCase();
    if (record.deleted || record.deletedAt || record.discarded || record.discardedAt
      || ['deleted','discarded','abandoned','cancelled','canceled','invalid'].includes(status)
      || ['deleted','discarded','abandoned','cancelled','canceled','invalid'].includes(String(record.status || '').toLowerCase())) continue;
    // Same finalized/amended rule as SOAP history; legacy notes are explicitly
    // recognized by the existing legacy ID convention. Drafts are not usage.
    const complete=status==='amended' || status==='finalized' || record.finalized
      || (history && String(record.id || '').startsWith('legacy-'));
    if (!complete || !String(history ? record.note || '' : record.soapNote || '').trim()) continue;
    if (!validDate(date) || !validDate(period.startDate) || !validDate(period.endDate)
      || date<period.startDate || date>period.endDate) continue;
    if (!validTime(record.startTime) || !validTime(record.endTime)) continue;
    const minutes=sessionDurationMinutes(record.startTime,record.endTime);
    if (!Number.isFinite(minutes) || minutes<=0) continue;
    rows.push({code,minutes,units:billingUnits(minutes)});
  }
  return codes.map(code=>{
    const approved=period.services?.[code] || {};
    const approvedHours=Number(approved.hours || 0),approvedUnits=Number(approved.units || 0);
    const usedMinutes=rows.filter(row=>row.code===code).reduce((sum,row)=>sum+row.minutes,0);
    const usedUnits=rows.filter(row=>row.code===code).reduce((sum,row)=>sum+row.units,0);
    const usedHours=round(usedMinutes/60);
    return {code,usedMinutes,usedHours,usedUnits,approvedHours,approvedUnits,
      remainingHours:round(Math.max(approvedHours-usedHours,0)),remainingUnits:Math.max(approvedUnits-usedUnits,0),
      percentUsed:approvedUnits>0 ? Math.round(usedUnits/approvedUnits*100) : approvedHours>0 ? Math.round(usedHours/approvedHours*100) : 0};
  });
}
