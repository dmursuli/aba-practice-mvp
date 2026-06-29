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

export function parentTrainingGoalGroupIdentity(goal = {}) {
  return cleanParentText(goal.goalName).toLowerCase() || parentTrainingGoalIdentity(goal);
}

function parentTrainingDomainName(goal = {}) {
  return cleanParentText(goal.domain || goal.trainingFocus || "General caregiver training") || "General caregiver training";
}

function parentTrainingPercent(numerator = 0, denominator = 0) {
  if (!denominator) return "0%";
  return `${Math.round((Number(numerator || 0) / Number(denominator || 0)) * 100)}%`;
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
      domain: cleanParentText(goal.domain || session.parentTraining?.trainingFocus || "General caregiver training"),
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
      targetName: cleanParentText(goal.targetName),
      domain: cleanParentText(goal.domain || goal.trainingFocus || "General caregiver training")
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
        targetName: goal.targetName,
        domain: cleanParentText(goal.domain || goal.trainingFocus || "General caregiver training")
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

  const domainBreakdown = buildParentTrainingDomainBreakdown({
    activeGoals,
    masteredGoalsDuringPeriod,
    goalSource: [...goalSourceMap.values()],
    sessionGoalEntries
  });
  const masteredTargetsDuringPeriod = filterMasteredGoalsForPeriod(masteredGoalsDuringPeriod);
  const activeTargets = activeGoals;

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
    masteredTargetsDuringPeriod,
    activeTargets,
    domainBreakdown,
    totals: {
      masteredGoals: uniqueParentGoalGroups(masteredGoalsDuringPeriod).length,
      activeGoals: uniqueParentGoalGroups(activeGoals).length,
      onHoldGoals: 0,
      masteredTargets: masteredTargetsDuringPeriod.length,
      activeTargets: activeTargets.length,
      onHoldTargets: 0,
      totalTargets: masteredTargetsDuringPeriod.length + activeTargets.length
    },
    summaryText,
    recommendationText
  };
}

function uniqueParentGoalGroups(goals = []) {
  const map = new Map();
  (goals || []).forEach((goal) => {
    const key = parentTrainingGoalGroupIdentity(goal);
    if (!key) return;
    if (!map.has(key)) map.set(key, goal);
  });
  return [...map.values()];
}

function buildParentTrainingDomainBreakdown({
  activeGoals = [],
  masteredGoalsDuringPeriod = [],
  goalSource = [],
  sessionGoalEntries = []
} = {}) {
  const domainMap = new Map();
  const ensureDomain = (domain) => {
    const label = parentTrainingDomainName({ domain });
    const key = label.toLowerCase();
    if (!domainMap.has(key)) {
      domainMap.set(key, {
        domain: label,
        activeGoalIds: new Set(),
        masteredGoalIds: new Set(),
        activeTargetIds: new Set(),
        masteredTargetIds: new Set()
      });
    }
    return domainMap.get(key);
  };

  const targetDomainMap = new Map();
  (sessionGoalEntries || []).forEach((goal) => {
    const targetKey = parentTrainingGoalIdentity(goal);
    if (!targetKey) return;
    if (!targetDomainMap.has(targetKey)) targetDomainMap.set(targetKey, parentTrainingDomainName(goal));
  });

  const goalDomainMap = new Map();
  (goalSource || []).forEach((goal) => {
    const goalKey = parentTrainingGoalGroupIdentity(goal);
    if (!goalKey) return;
    if (!goalDomainMap.has(goalKey)) goalDomainMap.set(goalKey, parentTrainingDomainName(goal));
  });

  (activeGoals || []).forEach((goal) => {
    const goalKey = parentTrainingGoalGroupIdentity(goal);
    const targetKey = parentTrainingGoalIdentity(goal);
    const domain = parentTrainingDomainName({
      domain: goal.domain || goal.trainingFocus || goalDomainMap.get(goalKey) || targetDomainMap.get(targetKey)
    });
    const bucket = ensureDomain(domain);
    if (goalKey) bucket.activeGoalIds.add(goalKey);
    if (targetKey) bucket.activeTargetIds.add(targetKey);
  });

  filterMasteredGoalsForPeriod(masteredGoalsDuringPeriod).forEach((goal) => {
    const goalKey = parentTrainingGoalGroupIdentity(goal);
    const targetKey = parentTrainingGoalIdentity(goal);
    const domain = parentTrainingDomainName({
      domain: goal.domain || goal.trainingFocus || goalDomainMap.get(goalKey) || targetDomainMap.get(targetKey)
    });
    const bucket = ensureDomain(domain);
    if (goalKey) bucket.masteredGoalIds.add(goalKey);
    if (targetKey) bucket.masteredTargetIds.add(targetKey);
  });

  return [...domainMap.values()].map((entry) => {
    const activeGoalCount = entry.activeGoalIds.size;
    const masteredGoalCount = entry.masteredGoalIds.size;
    const activeTargetCount = entry.activeTargetIds.size;
    const masteredTargetCount = entry.masteredTargetIds.size;
    return {
      domain: entry.domain,
      activeGoals: activeGoalCount,
      masteredGoals: masteredGoalCount,
      onHoldGoals: 0,
      percentGoalsMastered: parentTrainingPercent(masteredGoalCount, activeGoalCount + masteredGoalCount),
      activeTargets: activeTargetCount,
      masteredTargets: masteredTargetCount,
      onHoldTargets: 0,
      percentTargetsMastered: parentTrainingPercent(masteredTargetCount, activeTargetCount + masteredTargetCount)
    };
  }).sort((a, b) => a.domain.localeCompare(b.domain));
}

export function buildEditableParentTrainingSummary(model = {}) {
  const masteredGoals = filterMasteredGoalsForPeriod(model.masteredGoalsDuringPeriod || []);
  const masteredTargets = Array.isArray(model.masteredTargetsDuringPeriod) ? model.masteredTargetsDuringPeriod : masteredGoals;
  const domainBreakdown = Array.isArray(model.domainBreakdown) ? model.domainBreakdown : [];
  const totals = model.totals || {
    masteredGoals: uniqueParentGoalGroups(masteredGoals).length,
    activeGoals: uniqueParentGoalGroups(model.activeGoals || []).length,
    onHoldGoals: 0,
    masteredTargets: masteredTargets.length,
    activeTargets: Array.isArray(model.activeTargets) ? model.activeTargets.length : 0,
    onHoldTargets: 0,
    totalTargets: masteredTargets.length + (Array.isArray(model.activeTargets) ? model.activeTargets.length : 0)
  };
  const lines = [cleanParentText(model.summaryText)];
  lines.push("");
  lines.push("Status Summary:");
  lines.push(`- Goals mastered during authorization period: ${totals.masteredGoals || 0}`);
  lines.push(`- Mastered caregiver-training targets: ${totals.masteredTargets || 0}`);
  lines.push(`- Active caregiver-training goals: ${totals.activeGoals || 0}`);
  lines.push(`- Active caregiver-training targets: ${totals.activeTargets || 0}`);
  lines.push(`- Caregiver-training goals on hold: ${totals.onHoldGoals || 0}`);
  lines.push(`- Caregiver-training targets on hold: ${totals.onHoldTargets || 0}`);
  lines.push(`- Total caregiver-training targets reviewed: ${totals.totalTargets || 0}`);
  if (domainBreakdown.length) {
    lines.push("");
    lines.push("Domain Breakdown:");
    lines.push("| Domain | Active Goals | Mastered Goals | On-Hold Goals | % Goals Mastered | Active Targets | Mastered Targets | On-Hold Targets | % Targets Mastered |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    domainBreakdown.forEach((row) => {
      lines.push(`| ${row.domain} | ${row.activeGoals} | ${row.masteredGoals} | ${row.onHoldGoals} | ${row.percentGoalsMastered} | ${row.activeTargets} | ${row.masteredTargets} | ${row.onHoldTargets} | ${row.percentTargetsMastered} |`);
    });
  }
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

export function isLegacyGeneratedParentTrainingSummary(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return text.includes("Mastered Parent Training Goals During Authorization Period:")
    && !text.includes("Status Summary:")
    && !text.includes("Domain Breakdown:");
}
