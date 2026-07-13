export function generateSoapNote(session, lookups) {
  const clientName = lookups.clientName(session.clientId);
  const caregiverText = session.caregiverPresent
    ? "Caregiver was present during the session."
    : "Caregiver was not present during the session.";
  const trainingText = session.caregiverTraining
    ? "Caregiver training occurred during the visit."
    : "Caregiver training did not occur during the visit.";
  const transitionText = transitionPhrase(session.transitions);
  const affectText = affectPhrase(session.affect);

  const targetLines = targetEntries(session).map((target) => {
    const programName = lookups.programName(target.programId);
    const targetName = lookups.targetName(target.programId, target.targetId);
    return `${programName} - ${targetName}: ${target.independence}% independence (${target.correct}/${target.trials || target.correct + target.incorrect} correct), prompt level: ${target.promptLevel}.`;
  });

  const behaviorLines = session.behaviors.length
    ? session.behaviors.map((behavior) => {
        const parts = [`${lookups.behaviorName(behavior.behaviorId)}: ${behavior.frequency}`];
        if (behavior.duration) parts.push(`duration ${behavior.duration}`);
        if (behavior.intensity) parts.push(`intensity ${behavior.intensity}`);
        return `${parts.join(", ")}.`;
      })
    : ["No tracked behaviors were recorded during this session."];

  const targets = targetEntries(session);
  const averageIndependence = targets.length
    ? Math.round(targets.reduce((sum, target) => sum + target.independence, 0) / targets.length)
    : 0;
  const promptsNeeded = targets.some((target) => target.promptLevel !== "independent");
  const totalBehavior = session.behaviors.reduce((sum, behavior) => sum + Number(behavior.frequency || 0), 0);
  const barrierText = session.barriers === "none"
    ? "No barriers to treatment were observed."
    : `Barrier noted: ${humanize(session.barriers)}${session.barrierText ? ` (${session.barrierText})` : ""}.`;

  const progressInterpretation = averageIndependence >= 80
    ? `${clientName} demonstrated strong performance across targeted skills.`
    : averageIndependence >= 50
      ? `${clientName} demonstrated emerging progress and benefited from continued teaching opportunities.`
      : `${clientName} required increased support to complete targeted responses.`;

  const promptInterpretation = promptsNeeded
    ? "Prompting remains clinically indicated to support acquisition and reduce errors."
    : "Targets were completed independently with minimal additional prompting indicated today.";

  const behaviorInterpretation = totalBehavior > 0
    ? `Behavior occurred ${totalBehavior} time${totalBehavior === 1 ? "" : "s"} and may have interfered with instructional momentum.`
    : "Tracked behavior did not interfere with treatment delivery.";

  return [
    `S: ${clientName} participated in a ${session.setting} session on ${formatDate(session.date)} from ${session.startTime} to ${session.endTime}. Affect was ${affectText}. Transitions were ${transitionText}. ${caregiverText} ${trainingText}`,
    "",
    `O: Skill targets included ${targetLines.map((line) => line.replace(/\.$/, "")).join("; ")}. Behavior data: ${behaviorLines.map((line) => line.replace(/\.$/, "")).join("; ")}. ${barrierText}${session.notes ? ` Additional note: ${session.notes}` : ""}`,
    "",
    `A: ${progressInterpretation} Average independence was ${averageIndependence}%. ${promptInterpretation} ${behaviorInterpretation}`,
    "",
    "P: Continue the current treatment plan under 97153. Continue differential reinforcement, error correction, and prompting/fading strategies as clinically appropriate. Continue behavior intervention strategies and monitor frequency, duration, and intensity during upcoming sessions.",
    "",
    signatureBlock(session.providerSignature, session.providerCredential, session.date)
  ].join("\n");
}

export const NO_97155_TARGET_CHANGES_STATEMENT = "No skill acquisition target changes were documented for this protocol modification session.";

export function planChangesFor97155Session(planChangeLog = [], sessionContext = "") {
  const context = normalize97155SessionContext(sessionContext);
  const entries = Array.isArray(planChangeLog) ? planChangeLog : [];
  if (context.sessionId) {
    return entries.filter((change) => (
      matches97155Client(change, context.clientId)
      && String(change?.sessionId || change?.noteId || change?.soapNoteId || "").trim() === context.sessionId
    ));
  }
  if (!context.date) return [];
  return entries.filter((change) => (
    matches97155Client(change, context.clientId)
    && matches97155Context(change)
    && normalizeDateKey(change?.sessionDate || change?.date || change?.timestamp || change?.createdAt) === context.date
  ));
}

export function summarize97155TargetChanges(changes = []) {
  const summary = {
    programsIntroduced: [],
    targetsIntroduced: [],
    targetsMastered: [],
    targetsOnHold: [],
    targetsReactivated: [],
    targetsModified: [],
    targetsRemoved: [],
    behaviorChanges: [],
    protocolModifications: []
  };

  (Array.isArray(changes) ? changes : []).forEach((change) => {
    const type = String(change?.type || "").toLowerCase();
    const targetLabel = targetChangeLabel(change);
    const programLabel = programChangeLabel(change);
    const modificationLabel = modificationChangeLabel(change);

    if (type === "program-added") {
      addUnique(summary.programsIntroduced, programLabel);
      return;
    }
    if (type === "target-added" || type === "target-introduced") {
      addUnique(summary.targetsIntroduced, targetLabel);
      return;
    }
    if (type === "target-status-changed") {
      const toStatus = normalizeStatus(change?.toStatus);
      if (toStatus === "mastered") {
        addUnique(summary.targetsMastered, targetLabel);
      } else if (toStatus === "paused" || toStatus === "hold" || toStatus === "on hold") {
        addUnique(summary.targetsOnHold, targetLabel);
      } else if (toStatus === "active") {
        addUnique(summary.targetsReactivated, targetLabel);
      }
      return;
    }
    if (type === "target-modified" || type === "target-updated") {
      addUnique(summary.targetsModified, modificationLabel || targetLabel);
      return;
    }
    if (type === "target-removed" || type === "target-deleted") {
      addUnique(summary.targetsRemoved, targetLabel);
      return;
    }
    if (type.startsWith("behavior-")) {
      addUnique(summary.behaviorChanges, modificationLabel || targetLabel || programLabel);
      return;
    }
    if (
      type === "program-status-changed"
      || type === "program-modified"
      || type === "program-updated"
      || type === "domain-added"
      || type === "domain-removed"
      || type.includes("protocol")
      || type.includes("prompt")
      || type.includes("criteria")
      || type.includes("reinforcement")
      || type.includes("phase")
      || type.includes("procedure")
    ) {
      addUnique(summary.protocolModifications, modificationLabel || programLabel || targetLabel || humanize(type));
    }
  });

  return summary;
}

export function format97155TargetChangeSummary(summary = {}) {
  const sentences = [
    "The BCBA reviewed skill acquisition and behavior reduction data and implemented protocol modifications."
  ];
  if (summary.programsIntroduced?.length) {
    sentences.push(`Programs introduced during the session included ${summary.programsIntroduced.join(", ")}.`);
  }
  if (summary.targetsIntroduced?.length) {
    sentences.push(`Targets introduced during the session included ${summary.targetsIntroduced.join(", ")}.`);
  }
  if (summary.targetsMastered?.length) {
    sentences.push(`Targets mastered included ${summary.targetsMastered.join(", ")}.`);
  }
  if (summary.targetsOnHold?.length) {
    sentences.push(`Targets placed on hold included ${summary.targetsOnHold.join(", ")}.`);
  }
  if (summary.targetsReactivated?.length) {
    sentences.push(`Targets reactivated included ${summary.targetsReactivated.join(", ")}.`);
  }
  if (summary.targetsModified?.length) {
    sentences.push(`Targets modified included ${summary.targetsModified.join(", ")}.`);
  }
  if (summary.targetsRemoved?.length) {
    sentences.push(`Targets removed included ${summary.targetsRemoved.join(", ")}.`);
  }
  if (summary.behaviorChanges?.length) {
    sentences.push(`Behavior-reduction tracking changes included ${summary.behaviorChanges.join(", ")}.`);
  }
  if (summary.protocolModifications?.length) {
    sentences.push(`Protocol modifications documented during the session included ${summary.protocolModifications.join(", ")}.`);
  }

  const hasSkillTargetChanges = [
    summary.targetsIntroduced,
    summary.targetsMastered,
    summary.targetsOnHold,
    summary.targetsReactivated,
    summary.targetsModified,
    summary.targetsRemoved
  ].some((items) => items?.length);
  if (!hasSkillTargetChanges) {
    sentences.push(NO_97155_TARGET_CHANGES_STATEMENT);
  }
  return sentences.join(" ");
}

function affectPhrase(value) {
  return {
    happy: "happy",
    engaged: "engaged",
    neutral: "neutral",
    tired: "tired",
    upset: "upset"
  }[value] || "neutral";
}

function transitionPhrase(value) {
  return {
    smooth: "smooth",
    typical: "typical",
    delayed: "delayed",
    difficult: "difficult"
  }[value] || "typical";
}

function humanize(value) {
  return String(value).replace(/-/g, " ");
}

function normalizeDateKey(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const isoCandidate = text.includes("T") ? text.slice(0, 10) : text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoCandidate)) return isoCandidate;
  const parsed = new Date(text.includes("T") ? text : `${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalize97155SessionContext(value = "") {
  if (value && typeof value === "object") {
    return {
      clientId: String(value.clientId || "").trim(),
      sessionId: String(value.sessionId || value.noteId || value.id || "").trim(),
      date: normalizeDateKey(value.sessionDate || value.date || value.selectedDate || "")
    };
  }
  return {
    clientId: "",
    sessionId: "",
    date: normalizeDateKey(value)
  };
}

function matches97155Client(change = {}, clientId = "") {
  const changeClientId = String(change.clientId || "").trim();
  return !clientId || !changeClientId || changeClientId === clientId;
}

function matches97155Context(change = {}) {
  const serviceCode = String(change.serviceCode || change.sessionType || change.code || "").trim().toLowerCase();
  const context = String(change.context || change.sessionContext || change.activityLabel || "").trim().toLowerCase();
  if (!serviceCode && !context) return true;
  return serviceCode === "97155"
    || context.includes("97155")
    || context.includes("treatment")
    || context.includes("protocol");
}

function normalizeStatus(value = "") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "maintenance") return "mastered";
  if (status === "paused" || status === "on-hold" || status === "on hold") return "paused";
  return status;
}

function targetChangeLabel(change = {}) {
  const programName = String(change.programName || "").trim();
  const targetName = String(change.targetName || change.behaviorName || change.toValue || change.fromValue || "").trim();
  return [programName, targetName].filter(Boolean).join(": ") || "target";
}

function programChangeLabel(change = {}) {
  return String(change.programName || change.domain || change.targetName || change.behaviorName || "").trim();
}

function modificationChangeLabel(change = {}) {
  const label = (change.targetId || change.targetName)
    ? targetChangeLabel(change)
    : (programChangeLabel(change) || targetChangeLabel(change));
  const field = String(change.field || "").trim();
  const fromValue = String(change.fromValue || "").trim();
  const toValue = String(change.toValue || "").trim();
  if (field && fromValue && toValue) return `${label} (${humanize(field)} changed from ${fromValue} to ${toValue})`;
  if (field && toValue) return `${label} (${humanize(field)} updated to ${toValue})`;
  if (field) return `${label} (${humanize(field)} updated)`;
  return label;
}

function addUnique(list, value) {
  const text = String(value || "").trim();
  if (text && !list.includes(text)) list.push(text);
}

function formatDate(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function signatureBlock(signature, credential, date) {
  const signedBy = signature?.trim() || "Provider signature";
  const credentialText = credential?.trim() ? `, ${credential.trim()}` : "";
  return `Provider signature: ${signedBy}${credentialText}\nDate signed: ${formatDate(date)}`;
}

function targetEntries(session) {
  return (session.programs || []).flatMap((program) => {
    if (Array.isArray(program.targets)) {
      return program.targets.map((target) => ({ ...target, programId: program.programId }));
    }
    return [{ ...program, targetId: program.targetId || program.programId }];
  });
}
