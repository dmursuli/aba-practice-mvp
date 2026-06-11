export function removeTargetPointFromSession(session, programId, targetId) {
  const programs = Array.isArray(session?.programs) ? session.programs : [];
  let removed = false;

  const nextPrograms = programs
    .map((program) => {
      if (program.programId !== programId) return program;
      const nextTargets = (program.targets || []).filter((target) => {
        const match = target.targetId === targetId;
        if (match) removed = true;
        return !match;
      });
      return {
        ...program,
        targets: nextTargets
      };
    })
    .filter((program) => (program.targets || []).length);

  return {
    removed,
    session: removed ? { ...session, programs: nextPrograms } : session
  };
}

export function removeBehaviorPointFromSession(session, behaviorId) {
  const behaviors = Array.isArray(session?.behaviors) ? session.behaviors : [];
  const nextBehaviors = behaviors.filter((behavior) => behavior.behaviorId !== behaviorId);
  const removed = nextBehaviors.length !== behaviors.length;
  return {
    removed,
    session: removed ? { ...session, behaviors: nextBehaviors } : session
  };
}

export function duplicateTargetIdsFromPrograms(programs = []) {
  const seen = new Set();
  const duplicates = new Set();
  (programs || []).forEach((program) => {
    const targets = Array.isArray(program?.targets) ? program.targets : [program];
    targets.forEach((target) => {
      const targetId = String(target?.targetId || "").trim();
      if (!targetId) return;
      if (seen.has(targetId)) duplicates.add(targetId);
      seen.add(targetId);
    });
  });
  return [...duplicates];
}

export function duplicateBehaviorIds(behaviors = []) {
  const seen = new Set();
  const duplicates = new Set();
  (behaviors || []).forEach((behavior) => {
    const behaviorId = String(behavior?.behaviorId || "").trim();
    if (!behaviorId) return;
    if (seen.has(behaviorId)) duplicates.add(behaviorId);
    seen.add(behaviorId);
  });
  return [...duplicates];
}

export function dedupeTargetEntries(entries = []) {
  const seen = new Set();
  return (entries || []).filter((entry) => {
    const targetId = String(entry?.targetId || "").trim();
    if (!targetId) return false;
    if (seen.has(targetId)) return false;
    seen.add(targetId);
    return true;
  });
}

export function dedupeBehaviorEntries(entries = []) {
  const seen = new Set();
  return (entries || []).filter((entry) => {
    const behaviorId = String(entry?.behaviorId || "").trim();
    if (!behaviorId) return false;
    if (seen.has(behaviorId)) return false;
    seen.add(behaviorId);
    return true;
  });
}

export function availableTargetsForSession(targets = [], selectedTargetIds = new Set(), currentTargetId = "") {
  return (targets || []).filter((target) => {
    const targetId = String(target?.id || target?.targetId || "").trim();
    if (!targetId) return false;
    return targetId === currentTargetId || !selectedTargetIds.has(targetId);
  });
}

export function availableBehaviorsForSession(behaviors = [], selectedBehaviorIds = new Set(), currentBehaviorId = "") {
  return (behaviors || []).filter((behavior) => {
    const behaviorId = String(behavior?.id || behavior?.behaviorId || "").trim();
    if (!behaviorId) return false;
    return behaviorId === currentBehaviorId || !selectedBehaviorIds.has(behaviorId);
  });
}
