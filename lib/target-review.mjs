import { dedupeTargetEntries } from "../public/session-utils.js";

const TARGET_REVIEW_STATES = ["close", "ready", "mastered", "stagnant", "none"];

export function targetReviewCriteria(client = {}) {
  const criteria = client?.profile?.masteryCriteria || {};
  return {
    thresholdPercent: Number(criteria.thresholdPercent || 90),
    consecutiveSessions: Number(criteria.consecutiveSessions || 2),
    stagnantConsecutiveSessions: Number(criteria.stagnantConsecutiveSessions || 3),
    stagnantMinimumGain: Number(criteria.stagnantMinimumGain || 5)
  };
}

export function buildTargetReviewSummary(client = {}, sessions = []) {
  const criteria = targetReviewCriteria(client);
  const targets = configuredTargetRecords(client);
  const reviewByKey = new Map();
  const pendingByKey = new Map();
  const recentLimit = Math.max(criteria.consecutiveSessions, criteria.stagnantConsecutiveSessions);

  targets.forEach((target) => {
    if (target.status === "mastered") {
      reviewByKey.set(target.key, compactReview(target, "mastered"));
      return;
    }
    pendingByKey.set(target.key, {
      target,
      recent: [],
      highRun: [],
      masteryDates: null
    });
  });

  if (pendingByKey.size) {
    const pendingTargets = targets.filter((target) => target.status !== "mastered");
    relevantClientSessions(client.id, sessions).forEach((session) => {
      const seenKeys = new Set();
      targetEntriesForReview(session, pendingTargets).forEach((entry) => {
        const key = targetReviewKey(entry.programId, entry.targetId);
        if (!pendingByKey.has(key) || seenKeys.has(key)) return;
        const aggregate = pendingByKey.get(key);
        if (!aggregate) return;
        seenKeys.add(key);
        addObservation(aggregate, {
          date: session.date,
          score: Number(entry.independence || 0)
        }, criteria, recentLimit);
      });
    });
  }

  pendingByKey.forEach((aggregate, key) => {
    reviewByKey.set(key, classifyAggregate(aggregate, criteria));
  });

  const reviews = targets.map((target) => reviewByKey.get(target.key) || compactReview(target, "none"));
  const counts = Object.fromEntries(TARGET_REVIEW_STATES.map((state) => [state, 0]));
  reviews.forEach((review) => {
    counts[review.classification] += 1;
  });

  return {
    clientId: client.id || "",
    criteria,
    counts,
    targets: reviews
  };
}

function configuredTargetRecords(client) {
  return (client?.programs || []).flatMap((program) => (
    (program.targets || []).map((target) => ({
      key: targetReviewKey(program.id, target.id),
      programId: program.id,
      programName: program.name || "",
      targetId: target.id,
      targetName: target.name || "",
      status: target.status
    }))
  ));
}

function relevantClientSessions(clientId, sessions) {
  return (sessions || [])
    .filter((session) => (
      session.clientId === clientId
      && (session.serviceType || "97153") === "97153"
    ))
    .slice()
    .sort((a, b) => {
      const aValue = `${a.date}T${a.startTime || "00:00"}`;
      const bValue = `${b.date}T${b.startTime || "00:00"}`;
      return bValue.localeCompare(aValue);
    });
}

function targetEntriesForReview(session, targets) {
  const structuredTargets = (session.programs || []).flatMap((program) => {
    if (Array.isArray(program.targets)) {
      return program.targets.map((target) => ({ ...target, programId: program.programId }));
    }
    return [{ ...program, targetId: program.targetId || program.programId }];
  });
  const actualTargets = structuredTargets.filter((target) => target.targetId && target.targetId !== target.programId);
  return actualTargets.length
    ? dedupeTargetEntries(structuredTargets)
    : recoverTargetsFromSoap(session.soapNote, targets);
}

function recoverTargetsFromSoap(soapNote = "", targets = []) {
  return targets.flatMap((target) => {
    const pattern = `${escapeRegExp(target.programName)}\\s+-\\s+${escapeRegExp(target.targetName)}:\\s+(\\d+)% independence \\((\\d+)\\/(\\d+) correct\\), prompt level:\\s+([^.;]+)`;
    return [...String(soapNote || "").matchAll(new RegExp(pattern, "g"))].map((match) => ({
      programId: target.programId,
      targetId: target.targetId,
      independence: Number(match[1])
    }));
  });
}

function addObservation(aggregate, observation, criteria, recentLimit) {
  if (aggregate.recent.length < recentLimit) aggregate.recent.push(observation);
  if (aggregate.masteryDates) return;
  if (observation.score >= criteria.thresholdPercent) {
    aggregate.highRun.push(observation.date);
    if (aggregate.highRun.length === criteria.consecutiveSessions) {
      aggregate.masteryDates = aggregate.highRun.slice().reverse();
    }
  } else {
    aggregate.highRun = [];
  }
}

function classifyAggregate(aggregate, criteria) {
  const target = aggregate.target;
  const masteryScores = aggregate.recent.slice(0, criteria.consecutiveSessions).map((item) => item.score);
  if (aggregate.masteryDates) {
    return compactReview(target, "ready", { matchedDates: aggregate.masteryDates });
  }

  if (masteryScores.length >= criteria.consecutiveSessions) {
    const nearThreshold = masteryScores.every((score) => score >= Math.max(criteria.thresholdPercent - 10, 0));
    const averageScore = Math.round(masteryScores.reduce((sum, score) => sum + score, 0) / masteryScores.length);
    if (nearThreshold && averageScore >= criteria.thresholdPercent - 5) {
      return compactReview(target, "close", { previewScores: masteryScores.reverse() });
    }
  }

  const stagnantItems = aggregate.recent.slice(0, criteria.stagnantConsecutiveSessions).reverse();
  if (stagnantItems.length < criteria.stagnantConsecutiveSessions) return compactReview(target, "none");
  const stagnantScores = stagnantItems.map((item) => item.score);
  const newestScore = stagnantScores[stagnantScores.length - 1] || 0;
  const oldestScore = stagnantScores[0] || 0;
  const improvement = newestScore - oldestScore;
  const scoreRange = Math.max(...stagnantScores) - Math.min(...stagnantScores);
  const averageScore = Math.round(stagnantScores.reduce((sum, score) => sum + score, 0) / stagnantScores.length);
  const stagnant = improvement < criteria.stagnantMinimumGain
    && scoreRange <= criteria.stagnantMinimumGain
    && averageScore < criteria.thresholdPercent - 5;
  return stagnant
    ? compactReview(target, "stagnant", {
        matchedDates: stagnantItems.map((item) => item.date),
        previewScores: stagnantScores
      })
    : compactReview(target, "none");
}

function compactReview(target, classification, details = {}) {
  return {
    programId: target.programId,
    targetId: target.targetId,
    classification,
    ...details
  };
}

function targetReviewKey(programId, targetId) {
  return `${programId}\u0000${targetId}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
