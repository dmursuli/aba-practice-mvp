import {graphNumericValue} from '../public/graph-values.js';
import {skillGraphMeasurement} from '../public/skill-graph-measurements.js';

// Read-only inventory. Existing saved program/target IDs are the only identities.
export function historicalTargetInventory(client = {}, sessions = []) {
  const configured = new Map((client.programs || []).map(program => [program.id, program]));
  const groups = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session.clientId !== client.id || !/^\d{4}-\d{2}-\d{2}$/.test(session.date || '')
      || session.deleted || session.deletedAt || session.discarded || session.discardedAt) continue;
    for (const group of session.programs || []) {
      if (!group.programId) continue;
      const current = configured.get(group.programId);
      for (const point of group.targets || [group]) {
        if (!point.targetId || point.targetId === group.programId) continue;
        const type = skillGraphMeasurement(point);
        const value = type && graphNumericValue(type === 'frequency' ? point.frequency : point.independence);
        if (!type || value === null || value < 0 || (type === 'frequency' ? !Number.isInteger(value) : value > 100)) continue;
        if (!groups.has(group.programId)) groups.set(group.programId, {
          id:group.programId, name:current?.name || group.programName || group.name || point.programName || group.programId,
          domain:current?.domain || group.domain || 'Historical', dates:new Set(), targets:new Map()
        });
        const entry = groups.get(group.programId);
        entry.dates.add(session.date);
        if ((current?.targets || []).some(target => target.id === point.targetId)) continue;
        if (!entry.targets.has(point.targetId)) entry.targets.set(point.targetId, {
          id:point.targetId, name:point.targetName || point.name || point.targetId
        });
      }
    }
  }
  return [...groups.values()].filter(group => group.targets.size).map(group => ({
    id:group.id, name:group.name, domain:group.domain,
    historicalDates:[...group.dates].sort(), targets:[...group.targets.values()]
  }));
}
