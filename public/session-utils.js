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
