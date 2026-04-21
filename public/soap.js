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
