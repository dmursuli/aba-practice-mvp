import test from "node:test";
import assert from "node:assert/strict";

import { buildTargetReviewSummary } from "../lib/target-review.mjs";

function clientWithTargets(targets, criteria = {}) {
  return {
    id: "client-1",
    profile: {
      masteryCriteria: {
        thresholdPercent: 90,
        consecutiveSessions: 2,
        stagnantConsecutiveSessions: 3,
        stagnantMinimumGain: 5,
        ...criteria
      }
    },
    programs: [{
      id: "program-1",
      name: "Communication",
      targets: targets.map((target) => ({ status: "active", ...target }))
    }]
  };
}

function structuredSession(id, date, scores, { startTime = "09:00", serviceType = "97153" } = {}) {
  return {
    id,
    clientId: "client-1",
    date,
    startTime,
    serviceType,
    programs: [{
      programId: "program-1",
      targets: Object.entries(scores).map(([targetId, independence]) => ({ targetId, independence }))
    }]
  };
}

function review(summary, targetId) {
  return summary.targets.find((target) => target.targetId === targetId);
}

test("persisted mastered targets short-circuit without reading historical observations", () => {
  const client = clientWithTargets([{ id: "mastered", name: "Mastered", status: "mastered" }]);
  const unreadableSessions = Object.defineProperty({}, "filter", {
    get() {
      throw new Error("historical observations should not be read");
    }
  });

  const summary = buildTargetReviewSummary(client, unreadableSessions);

  assert.equal(review(summary, "mastered").classification, "mastered");
  assert.deepEqual(summary.counts, { close: 0, ready: 0, mastered: 1, stagnant: 0, none: 0 });
});

test("target review classifies mastered, ready, close, stagnant, and insufficient observations exactly", () => {
  const client = clientWithTargets([
    { id: "mastered", name: "Mastered", status: "mastered" },
    { id: "ready", name: "Ready" },
    { id: "close", name: "Close" },
    { id: "stagnant", name: "Stagnant" },
    { id: "none", name: "None" },
    { id: "maintenance", name: "Maintenance", status: "maintenance" }
  ]);
  const sessions = [
    structuredSession("newest", "2026-03-05", { ready: 20, close: 88, stagnant: 43, none: 50, mastered: 0 }),
    structuredSession("middle", "2026-03-04", { ready: 95, close: 82, stagnant: 42, mastered: 0 }),
    structuredSession("oldest", "2026-03-03", { ready: 92, close: 70, stagnant: 40, mastered: 0 })
  ];

  const summary = buildTargetReviewSummary(client, sessions);

  assert.equal(review(summary, "mastered").classification, "mastered");
  assert.deepEqual(review(summary, "mastered"), {
    programId: "program-1",
    targetId: "mastered",
    classification: "mastered"
  });
  assert.equal(review(summary, "ready").classification, "ready");
  assert.deepEqual(review(summary, "ready").matchedDates, ["2026-03-03", "2026-03-04"]);
  assert.equal(review(summary, "close").classification, "close");
  assert.deepEqual(review(summary, "close").previewScores, [82, 88]);
  assert.equal(review(summary, "stagnant").classification, "stagnant");
  assert.deepEqual(review(summary, "stagnant").previewScores, [40, 42, 43]);
  assert.equal(review(summary, "none").classification, "none");
  assert.equal(review(summary, "maintenance").classification, "none");
  assert.deepEqual(summary.counts, { close: 1, ready: 1, mastered: 1, stagnant: 1, none: 2 });
});

test("target review orders sessions newest-first before applying close and stagnation windows", () => {
  const client = clientWithTargets([
    { id: "close", name: "Close" },
    { id: "stagnant", name: "Stagnant" }
  ]);
  const sessions = [
    structuredSession("old", "2026-01-01", { close: 10, stagnant: 10 }),
    structuredSession("new", "2026-01-03", { close: 89, stagnant: 42 }),
    structuredSession("middle", "2026-01-02", { close: 81, stagnant: 40 }),
    structuredSession("newer-same-day", "2026-01-03", { stagnant: 43 }, { startTime: "10:00" })
  ];

  const summary = buildTargetReviewSummary(client, sessions);

  assert.deepEqual(review(summary, "close").previewScores, [81, 89]);
  assert.deepEqual(review(summary, "stagnant").previewScores, [40, 42, 43]);
});

test("target review preserves strict stagnant comparison and inclusive close boundaries", () => {
  const client = clientWithTargets([
    { id: "close-boundary", name: "Close Boundary" },
    { id: "stagnant-boundary", name: "Stagnant Boundary" }
  ]);
  const sessions = [
    structuredSession("s3", "2026-01-03", { "close-boundary": 90, "stagnant-boundary": 45 }),
    structuredSession("s2", "2026-01-02", { "close-boundary": 80, "stagnant-boundary": 42 }),
    structuredSession("s1", "2026-01-01", { "stagnant-boundary": 40 })
  ];

  const summary = buildTargetReviewSummary(client, sessions);

  assert.equal(review(summary, "close-boundary").classification, "close");
  assert.equal(review(summary, "stagnant-boundary").classification, "none");
});

test("target review supports legacy program-level entries", () => {
  const client = clientWithTargets([{ id: "legacy", name: "Legacy" }]);
  const sessions = [
    {
      id: "legacy-2",
      clientId: "client-1",
      date: "2026-02-02",
      programs: [{ programId: "program-1", targetId: "legacy", independence: 91 }]
    },
    {
      id: "legacy-1",
      clientId: "client-1",
      date: "2026-02-01",
      programs: [{ programId: "program-1", targetId: "legacy", independence: 90 }]
    }
  ];

  assert.equal(review(buildTargetReviewSummary(client, sessions), "legacy").classification, "ready");
});

test("target review preserves SOAP fallback when structured target entries are absent", () => {
  const client = clientWithTargets([{ id: "soap", name: "Request help?" }]);
  const note = "Communication - Request help?: 95% independence (19/20 correct), prompt level: verbal.";
  const sessions = [
    { id: "soap-2", clientId: "client-1", date: "2026-02-02", serviceType: "97153", programs: [], soapNote: note },
    { id: "soap-1", clientId: "client-1", date: "2026-02-01", serviceType: "97153", programs: [], soapNote: note }
  ];

  assert.equal(review(buildTargetReviewSummary(client, sessions), "soap").classification, "ready");
});

test("target review output size scales with configured targets rather than observations", () => {
  const client = clientWithTargets([{ id: "one", name: "One" }, { id: "two", name: "Two" }]);
  const sessions = Array.from({ length: 5000 }, (_, index) => (
    structuredSession(`s-${index}`, `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`, {
      one: index % 100,
      two: (index + 10) % 100
    })
  ));

  const summary = buildTargetReviewSummary(client, sessions);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.targets.length, 2);
  assert.ok(serialized.length < 1500);
  assert.doesNotMatch(serialized, /"sessions"|"programs"|"soapNote"/);
});
