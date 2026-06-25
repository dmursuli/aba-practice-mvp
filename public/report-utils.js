function formatMetricValue(value, graphType) {
  if (value === null || value === undefined || value === "") return "Unavailable";
  if (typeof value === "number") {
    return graphType === "behavior" ? `${value}` : `${value}%`;
  }
  return String(value);
}

export function buildCompactGraphAnalysisSentence(entry, graphType) {
  if (!entry) return "";
  const metrics = [
    `Baseline: ${formatMetricValue(entry.baselineLevel, graphType)}`,
    `Treatment: ${formatMetricValue(entry.treatmentLevel ?? entry.treatmentAverage, graphType)}`,
    graphType === "behavior"
      ? `Reduction: ${entry.percentReduction || "Unavailable"}`
      : `Change: ${formatMetricValue(entry.difference, graphType)}${entry.percentChange && !String(entry.percentChange).includes("unavailable") ? ` (${entry.percentChange})` : ""}`,
    `Trend: ${entry.trendDirection || "Unavailable"}`
  ];
  return `${metrics.join(". ")}. ${String(entry.interpretation || "").trim()}`.replace(/\s+/g, " ").trim();
}

export function parseNumberedObjectives(source = "") {
  const text = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const matches = [...text.matchAll(/(?:^|[\n\s])(\d+)\.\s+(?=[A-Z"\[])/g)];
  if (!matches.length) {
    return [text.replace(/\s+/g, " ").trim()].filter(Boolean);
  }

  return matches.map((match, index) => {
    const numberToken = `${match[1]}.`;
    const numberIndex = match.index + match[0].lastIndexOf(numberToken);
    const contentStart = numberIndex + numberToken.length;
    const nextMatch = matches[index + 1];
    const nextIndex = nextMatch
      ? nextMatch.index + nextMatch[0].lastIndexOf(`${nextMatch[1]}.`)
      : text.length;
    return text
      .slice(contentStart, nextIndex)
      .replace(/\s+/g, " ")
      .trim();
  }).filter(Boolean);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObjectKeys(value[key]);
    return result;
  }, {});
}

export function sanitizeTrendVisibilityMap(source = {}, allowedKeys = []) {
  const allowed = new Set((allowedKeys || []).filter(Boolean));
  return Object.entries(source || {}).reduce((result, [key, value]) => {
    if (allowed.has(key)) result[key] = Boolean(value);
    return result;
  }, {});
}

function sanitizeText(value) {
  return String(value || "").trim();
}

export function sanitizeAssessmentDocumentRefs(source = {}) {
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return [];
    return value.reduce((result, item) => {
      const fileId = sanitizeText(item?.fileId || item?.id);
      if (!fileId) return result;
      result.push({
        fileId,
        originalFileName: sanitizeText(item?.originalFileName || item?.fileName),
        uploadedAt: sanitizeText(item?.uploadedAt || item?.createdAt),
        fileSize: Number.isFinite(Number(item?.fileSize)) ? Math.max(0, Number(item.fileSize)) : 0,
        contentType: sanitizeText(item?.contentType || item?.mimeType),
        storagePath: sanitizeText(item?.storagePath || item?.relativePath || item?.s3Key),
        objectKey: sanitizeText(item?.objectKey || item?.s3Key),
        clientId: sanitizeText(item?.clientId),
        documentType: sanitizeText(item?.documentType || item?.type)
      });
      return result;
    }, []);
  };

  return {
    assessmentGrid: normalizeList(source.assessmentGrid),
    standardizedAssessmentGrid: normalizeList(source.standardizedAssessmentGrid)
  };
}

export function sanitizeCustomPhaseLines(source = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.entries(source).reduce((result, [graphKey, lines]) => {
    const key = sanitizeText(graphKey);
    if (!key || !Array.isArray(lines)) return result;
    const normalized = lines.reduce((entries, line) => {
      const date = sanitizeText(line?.date);
      const label = sanitizeText(line?.label);
      if (!date || !label) return entries;
      entries.push({
        id: sanitizeText(line?.id) || `${key}:${date}:${label.toLowerCase()}`,
        date,
        label,
        lineStyle: sanitizeText(line?.lineStyle) === "solid" ? "solid" : "dashed",
        note: sanitizeText(line?.note),
        phaseType: "environmentalChange"
      });
      return entries;
    }, []);
    if (normalized.length) {
      result[key] = normalized.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
    }
    return result;
  }, {});
}

function normalizedKeyPart(value) {
  return sanitizeText(value).toLowerCase();
}

function normalizeSkillStatus(status = "active") {
  if (status === "maintenance") return "mastered";
  if (status === "paused") return "paused";
  return status === "mastered" ? "mastered" : "active";
}

export function skillAcquisitionGoalIdentity(goal = {}) {
  return sanitizeText(goal.programId || goal.goalId)
    || [
      normalizedKeyPart(goal.domain),
      normalizedKeyPart(goal.programName || goal.goalName),
      normalizedKeyPart(goal.objective)
    ].join("::");
}

export function skillAcquisitionTargetIdentity(target = {}) {
  return sanitizeText(target.targetId)
    || [
      normalizedKeyPart(target.domain),
      normalizedKeyPart(target.programName),
      normalizedKeyPart(target.targetName)
    ].join("::");
}

export function summarizeSkillAcquisitionReport({
  programs = [],
  planChangeLog = [],
  startDate = "",
  endDate = ""
} = {}) {
  const goalMap = new Map();
  const goalChangeMap = new Map();
  const currentProgramMap = new Map();
  const targetStatusMap = {
    mastered: new Map(),
    paused: new Map(),
    active: new Map()
  };

  (programs || []).forEach((program) => {
    const programStatus = normalizeSkillStatus(program?.status || "active");
    const programEntry = {
      programId: sanitizeText(program?.id),
      goalId: sanitizeText(program?.id),
      programName: sanitizeText(program?.name),
      goalName: sanitizeText(program?.name),
      domain: sanitizeText(program?.domain || "General"),
      objective: sanitizeText(program?.objective),
      status: programStatus
    };
    goalMap.set(skillAcquisitionGoalIdentity(programEntry), programEntry);
    if (programEntry.programId) currentProgramMap.set(programEntry.programId, programEntry);
    (program?.targets || []).forEach((target) => {
      const targetStatus = normalizeSkillStatus(target?.status || "active");
      const effectiveStatus = programStatus === "mastered" && targetStatus !== "paused"
        ? "mastered"
        : programStatus === "paused" && targetStatus !== "mastered"
          ? "paused"
          : targetStatus;
      const targetEntry = {
        targetId: sanitizeText(target?.id),
        targetName: sanitizeText(target?.name),
        programId: sanitizeText(program?.id),
        programName: sanitizeText(program?.name),
        domain: sanitizeText(program?.domain || "General"),
        objective: sanitizeText(program?.objective),
        status: effectiveStatus
      };
      targetStatusMap[effectiveStatus]?.set(skillAcquisitionTargetIdentity(targetEntry), targetEntry);
    });
  });

  const masteryHistoryInRange = (planChangeLog || []).filter((change) => (
    (!startDate || change?.date >= startDate)
    && (!endDate || change?.date <= endDate)
  ));

  masteryHistoryInRange
    .filter((change) => (
      change?.type === "program-status-changed"
      && change?.toStatus === "mastered"
    ))
    .forEach((change) => {
      const entry = {
        programId: sanitizeText(change.programId),
        goalId: sanitizeText(change.programId),
        programName: sanitizeText(change.programName),
        goalName: sanitizeText(change.programName),
        domain: sanitizeText(change.domain || "General"),
        objective: sanitizeText(change.objective),
        masteredDate: sanitizeText(change.date),
        status: "mastered",
        assumption: ""
      };
      goalChangeMap.set(skillAcquisitionGoalIdentity(entry), entry);
    });

  const masteredTargetIds = new Set([...targetStatusMap.mastered.values()].map((target) => target.targetId).filter(Boolean));
  const fallbackGoalMap = new Map();
  masteryHistoryInRange
    .filter((change) => change?.type === "target-status-changed" && change?.toStatus === "mastered")
    .forEach((change) => {
      const targetId = sanitizeText(change.targetId);
      const programId = sanitizeText(change.programId);
      if (!programId || !targetId || !masteredTargetIds.has(targetId)) return;
      const currentGoal = currentProgramMap.get(programId);
      const entry = {
        programId,
        goalId: programId,
        programName: sanitizeText(change.programName) || sanitizeText(currentGoal?.programName),
        goalName: sanitizeText(change.programName) || sanitizeText(currentGoal?.goalName),
        domain: sanitizeText(change.domain || currentGoal?.domain || "General"),
        objective: sanitizeText(change.objective || currentGoal?.objective || change.programName),
        masteredDate: sanitizeText(change.date),
        status: currentGoal?.status || "active",
        assumption: "target-mastery-fallback"
      };
      const key = skillAcquisitionGoalIdentity(entry);
      if (!goalChangeMap.has(key) && !fallbackGoalMap.has(key)) {
        fallbackGoalMap.set(key, entry);
      }
    });
  fallbackGoalMap.forEach((entry, key) => goalChangeMap.set(key, entry));

  goalMap.forEach((goal, key) => {
    if (goalChangeMap.has(key)) return;
    if (goal.status !== "mastered") return;
    const hasHistory = (planChangeLog || []).some((change) => (
      sanitizeText(change.programId) === goal.programId
      && (change?.type === "program-status-changed" || change?.type === "target-status-changed")
    ));
    if (hasHistory) return;
    goalChangeMap.set(key, {
      ...goal,
      masteredDate: "",
      assumption: "current-status-fallback"
    });
  });

  const masteredGoalsDuringPeriod = [...goalChangeMap.values()]
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.programName.localeCompare(b.programName));
  const masteredTargets = [...targetStatusMap.mastered.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.programName.localeCompare(b.programName) || a.targetName.localeCompare(b.targetName));
  const onHoldTargets = [...targetStatusMap.paused.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.programName.localeCompare(b.programName) || a.targetName.localeCompare(b.targetName));
  const activeTargets = [...targetStatusMap.active.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.programName.localeCompare(b.programName) || a.targetName.localeCompare(b.targetName));

  return {
    masteredGoalsDuringPeriod,
    masteredTargets,
    onHoldTargets,
    activeTargets,
    debug: {
      masteredTargetsCount: masteredTargets.length,
      masteredTargetIds: masteredTargets.map((target) => target.targetId),
      masteredTargetGoalMap: masteredTargets.map((target) => ({
        targetId: target.targetId,
        programId: target.programId,
        programName: target.programName
      })),
      deduplicatedMasteredGoalIds: masteredGoalsDuringPeriod.map((goal) => goal.programId || goal.goalId).filter(Boolean),
      masteredGoalCount: masteredGoalsDuringPeriod.length
    },
    totals: {
      masteredGoals: masteredGoalsDuringPeriod.length,
      masteredTargets: masteredTargets.length,
      onHoldTargets: onHoldTargets.length,
      activeTargets: activeTargets.length,
      totalTargets: masteredTargets.length + onHoldTargets.length + activeTargets.length
    }
  };
}

function skillGoalLabel(goal = {}) {
  const heading = sanitizeText(goal.domain) ? `${sanitizeText(goal.domain)}: ` : "";
  return `${heading}${sanitizeText(goal.objective || goal.programName || goal.goalName)}`.trim();
}

function skillTargetLabel(target = {}) {
  const prefix = [sanitizeText(target.programName), sanitizeText(target.domain)].filter(Boolean).join(" / ");
  return prefix
    ? `${prefix}: ${sanitizeText(target.targetName)}`
    : sanitizeText(target.targetName);
}

export function buildEditableSkillAcquisitionSummary(model = {}) {
  const masteredGoals = Array.isArray(model.masteredGoalsDuringPeriod) ? model.masteredGoalsDuringPeriod : [];
  const masteredTargets = Array.isArray(model.masteredTargets) ? model.masteredTargets : [];
  const onHoldTargets = Array.isArray(model.onHoldTargets) ? model.onHoldTargets : [];
  const activeTargets = Array.isArray(model.activeTargets) ? model.activeTargets : [];
  const totals = model.totals || {
    masteredGoals: masteredGoals.length,
    masteredTargets: masteredTargets.length,
    onHoldTargets: onHoldTargets.length,
    activeTargets: activeTargets.length,
    totalTargets: masteredTargets.length + onHoldTargets.length + activeTargets.length
  };
  const narrative = `During this authorization period, the client mastered ${masteredGoals.length} skill acquisition goal${masteredGoals.length === 1 ? "" : "s"} and ${masteredTargets.length} skill acquisition target${masteredTargets.length === 1 ? "" : "s"}. ${activeTargets.length} target${activeTargets.length === 1 ? "" : "s"} remain active and ${onHoldTargets.length} target${onHoldTargets.length === 1 ? "" : "s"} ${onHoldTargets.length === 1 ? "is" : "are"} currently on hold. Continued intervention is recommended to promote generalization, maintenance, and acquisition of remaining treatment targets.`;

  const lines = [
    "Status Summary:",
    `- Goals mastered during authorization period: ${totals.masteredGoals || 0}`,
    `- Mastered skill acquisition targets: ${totals.masteredTargets || 0}`,
    `- Active skill acquisition targets: ${totals.activeTargets || 0}`,
    `- Skill acquisition targets on hold: ${totals.onHoldTargets || 0}`,
    `- Total skill acquisition targets reviewed: ${totals.totalTargets || 0}`,
    "",
    "Goals Mastered During Authorization Period:"
  ];

  if (masteredGoals.length) {
    masteredGoals.forEach((goal) => lines.push(`- ${skillGoalLabel(goal)}`));
  } else {
    lines.push("No skill acquisition goals were mastered during this authorization period.");
  }

  lines.push("", "Mastered Skill Acquisition Targets:");
  if (masteredTargets.length) {
    masteredTargets.forEach((target) => lines.push(`- ${skillTargetLabel(target)}`));
  } else {
    lines.push("No skill acquisition targets were mastered during this authorization period.");
  }

  lines.push("", "On Hold Skill Acquisition Targets:");
  if (onHoldTargets.length) {
    onHoldTargets.forEach((target) => lines.push(`- ${skillTargetLabel(target)}`));
  } else {
    lines.push("No skill acquisition targets are currently on hold.");
  }

  lines.push("", "Narrative summary:", narrative);
  return lines.join("\n");
}

export function buildFunderDraftRecord({
  clientId = "",
  startDate = "",
  endDate = "",
  sections = {},
  generatedSectionAutofill = {},
  fadePlanRows = [],
  serviceHours = [],
  graphPreferences = {},
  includedContent = {},
  displaySettings = {},
  editedGraphAnalysis = {},
  assessmentDocuments = {},
  customPhaseLines = {},
  existingDraft = {},
  now = new Date().toISOString()
} = {}) {
  const previousCreatedAt = existingDraft?.metadata?.createdAt || existingDraft?.createdAt || now;
  return {
    metadata: {
      clientId: String(clientId || ""),
      reportingPeriod: {
        startDate: String(startDate || ""),
        endDate: String(endDate || "")
      },
      draftStatus: "draft",
      createdAt: previousCreatedAt,
      updatedAt: now,
      lastSavedAt: now,
      generatedSectionAutofill: sortObjectKeys(generatedSectionAutofill)
    },
    startDate: String(startDate || ""),
    endDate: String(endDate || ""),
    ...sections,
    fadePlanRows: Array.isArray(fadePlanRows) ? fadePlanRows : [],
    serviceHours: Array.isArray(serviceHours) ? serviceHours : [],
    includedContent: {
      programIds: Array.isArray(includedContent.programIds) ? includedContent.programIds : [],
      targetIds: Array.isArray(includedContent.targetIds) ? includedContent.targetIds : [],
      behaviorIds: Array.isArray(includedContent.behaviorIds) ? includedContent.behaviorIds : [],
      parentTrainingGoalIds: Array.isArray(includedContent.parentTrainingGoalIds) ? includedContent.parentTrainingGoalIds : []
    },
    settings: {
      graphPreferences: sortObjectKeys(graphPreferences),
      displaySettings: sortObjectKeys(displaySettings)
    },
    editedGraphAnalysis: sortObjectKeys(editedGraphAnalysis),
    assessmentDocuments: sortObjectKeys(sanitizeAssessmentDocumentRefs(assessmentDocuments)),
    customPhaseLines: sortObjectKeys(sanitizeCustomPhaseLines(customPhaseLines))
  };
}

export function isLegacyGeneratedSkillAcquisitionSummary(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return text.includes("Status Summary:")
    && text.includes("Goals mastered during authorization period:")
    && text.includes("Mastered Skill Acquisition Targets:")
    && text.includes("On Hold Skill Acquisition Targets:")
    && text.includes("Narrative summary:");
}

export function estimateJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value || {})).length;
}

export function draftContainsLargeArtifacts(draft = {}) {
  const serialized = JSON.stringify(draft || {}).toLowerCase();
  return serialized.includes("data:application/pdf")
    || serialized.includes("data:image/")
    || serialized.includes("<html")
    || serialized.includes("<section class=\"report-document\"")
    || serialized.includes("base64,");
}

export function hasMeaningfulFunderReportDraft(draft = {}) {
  if (!draft || typeof draft !== "object") return false;
  const sections = Object.fromEntries(Object.entries(draft).filter(([key]) => !["metadata", "includedContent", "settings", "editedGraphAnalysis"].includes(key)));
  return Object.entries(sections).some(([key, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (key === "assessmentDocuments") {
      return Object.values(sanitizeAssessmentDocumentRefs(value)).some((items) => items.length > 0);
    }
    if (key === "customPhaseLines") {
      return Object.values(sanitizeCustomPhaseLines(value)).some((items) => items.length > 0);
    }
    if (key === "assessmentGrid" || key === "standardizedAssessmentGrid") return false;
    return String(value || "").trim().length > 0;
  });
}
