function cleanParentText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function parentTrainingGoalKey(goal = {}) {
  return `${cleanParentText(goal.goalName).toLowerCase()}::${cleanParentText(goal.targetName).toLowerCase()}`;
}

export function parentTrainingGoalLabel(goal = {}) {
  const goalName = cleanParentText(goal.goalName);
  const targetName = cleanParentText(goal.targetName);
  if (goalName && targetName) return `${goalName} - ${targetName}`;
  return goalName || targetName || "Parent training goal";
}

export function parentTrainingGoalIdentity(goal = {}) {
  return goal.parentTrainingGoalId
    || goal.goalId
    || goal.targetId
    || parentTrainingGoalKey(goal);
}

export function filterMasteredGoalsForPeriod(goals = [], startDate = "", endDate = "") {
  const seen = new Set();
  return goals.filter((goal) => {
    const masteredDate = goal.masteredDate || goal.date || "";
    if (startDate && masteredDate && masteredDate < startDate) return false;
    if (endDate && masteredDate && masteredDate > endDate) return false;
    const identity = parentTrainingGoalIdentity(goal);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function summarizePerformance(averageFidelity) {
  if (averageFidelity >= 85) return "strong";
  if (averageFidelity >= 70) return "steady";
  if (averageFidelity >= 50) return "emerging";
  return "limited";
}

export function summarizeParentTrainingReport({
  parentSessions = [],
  currentGoals = [],
  goalReviewsByKey = {},
  masteredGoalsDuringPeriod = []
} = {}) {
  const normalizedSessions = [...parentSessions].sort((a, b) => a.date.localeCompare(b.date));
  const sessionGoalEntries = normalizedSessions.flatMap((session) => (
    (session.parentGoals || []).map((goal) => ({
      goalName: cleanParentText(goal.goalName),
      targetName: cleanParentText(goal.targetName),
      fidelity: Number(goal.fidelity || 0),
      date: session.date,
      caregiverName: cleanParentText(session.parentTraining?.caregiverName),
      trainingFocus: cleanParentText(session.parentTraining?.trainingFocus)
    }))
  ));
  const caregivers = [...new Set(normalizedSessions.map((session) => cleanParentText(session.parentTraining?.caregiverName)).filter(Boolean))];
  const focusAreas = [...new Set(normalizedSessions.map((session) => cleanParentText(session.parentTraining?.trainingFocus)).filter(Boolean))];
  const averageFidelity = sessionGoalEntries.length
    ? Math.round(sessionGoalEntries.reduce((sum, entry) => sum + Number(entry.fidelity || 0), 0) / sessionGoalEntries.length)
    : 0;

  const currentGoalMap = new Map();
  currentGoals.forEach((goal) => {
    const normalizedGoal = {
      goalName: cleanParentText(goal.goalName),
      targetName: cleanParentText(goal.targetName)
    };
    const key = parentTrainingGoalKey(normalizedGoal);
    if (!key || key === "::") return;
    if (!currentGoalMap.has(key)) currentGoalMap.set(key, normalizedGoal);
  });

  const sessionGoalMap = new Map();
  sessionGoalEntries.forEach((goal) => {
    const key = parentTrainingGoalKey(goal);
    if (!key || key === "::") return;
    if (!sessionGoalMap.has(key)) {
      sessionGoalMap.set(key, {
        goalName: goal.goalName,
        targetName: goal.targetName
      });
    }
  });

  const goalSourceMap = currentGoalMap.size ? currentGoalMap : sessionGoalMap;
  const masteredGoals = [];
  const activeGoals = [];
  [...goalSourceMap.entries()].forEach(([key, goal]) => {
    const state = goalReviewsByKey[key] || "active";
    const summaryGoal = { ...goal, key, state };
    if (state === "mastered") masteredGoals.push(summaryGoal);
    else activeGoals.push(summaryGoal);
  });

  const sessionCount = normalizedSessions.length;
  const performanceLevel = summarizePerformance(averageFidelity);
  const summaryText = !sessionCount
    ? "No parent-training sessions were documented during this reporting period."
    : [
        `${sessionCount} parent-training session${sessionCount === 1 ? "" : "s"} were completed during this reporting period.`,
        caregivers.length
          ? `Caregivers trained included ${caregivers.join(", ")}.`
          : "Caregiver participation was documented but caregiver names were not entered consistently.",
        `Average caregiver fidelity across documented practice opportunities was ${averageFidelity}%, reflecting ${performanceLevel} implementation accuracy.`,
        focusAreas.length
          ? `Training focused on ${focusAreas.join(", ")}.`
          : "Training focused on caregiver implementation of current treatment-plan goals.",
        masteredGoals.length
          ? `${masteredGoals.length} parent-training goal${masteredGoals.length === 1 ? "" : "s"} currently meet mastery criteria.`
          : activeGoals.length
            ? `${activeGoals.length} active parent-training goal${activeGoals.length === 1 ? "" : "s"} remain in progress.`
            : "No active parent-training goals are currently listed in the treatment plan."
      ].join(" ");

  const recommendationText = !sessionCount
    ? "Resume caregiver-training sessions to establish current fidelity data, review implementation steps, and support generalization of treatment procedures across home and community routines."
    : averageFidelity >= 85
      ? `Continue caregiver training with emphasis on generalization, independence, and maintenance of mastered routines. ${activeGoals.length ? "Advance active caregiver goals by fading prompts and increasing caregiver-led implementation opportunities." : "Maintain caregiver fidelity with intermittent probes and refreshers as needed."}`
      : averageFidelity >= 60
        ? "Continue caregiver coaching with rehearsal, modeling, and immediate feedback. Prioritize consistent implementation of active goals before adding substantially more complex caregiver tasks."
        : "Increase direct coaching, modeling, and in-session feedback for caregivers. Narrow the focus to the highest-priority parent-training goals until fidelity improves and implementation is more consistent.";

  return {
    sessionCount,
    averageFidelity,
    caregivers,
    focusAreas,
    activeGoals,
    masteredGoals,
    masteredGoalsDuringPeriod,
    summaryText,
    recommendationText
  };
}

export function buildEditableParentTrainingSummary(model = {}) {
  const masteredGoals = filterMasteredGoalsForPeriod(model.masteredGoalsDuringPeriod || []);
  const lines = [cleanParentText(model.summaryText)];
  lines.push("");
  lines.push("Mastered Parent Training Goals During Authorization Period:");
  if (masteredGoals.length) {
    masteredGoals.forEach((goal) => {
      lines.push(`- ${parentTrainingGoalLabel(goal)}`);
    });
  } else {
    lines.push("No parent-training goals were mastered during this authorization period.");
  }
  return lines.join("\n").trim();
}
