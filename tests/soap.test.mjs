import assert from "node:assert/strict";
import { test } from "node:test";
import {
  format97155TargetChangeSummary,
  generateSoapNote,
  NO_97155_TARGET_CHANGES_STATEMENT,
  planChangesFor97155Session,
  summarize97155TargetChanges
} from "../public/soap.js";

test("97155 SOAP summary includes introduced, mastered, on-hold, reactivated, and modified targets", () => {
  const changes = [
    { type: "target-added", programName: "Manding", targetId: "target-1", targetName: "Request help", date: "2026-07-08" },
    { type: "target-status-changed", programName: "Manding", targetId: "target-2", targetName: "Request break", toStatus: "mastered", date: "2026-07-08" },
    { type: "target-status-changed", programName: "Listener responding", targetId: "target-3", targetName: "Follow one-step directions", toStatus: "paused", date: "2026-07-08" },
    { type: "target-status-changed", programName: "Tolerating delay", targetId: "target-4", targetName: "Wait for preferred item", toStatus: "active", date: "2026-07-08" },
    { type: "target-modified", programName: "Manding", targetId: "target-1", targetName: "Request help", field: "BCBA note", toValue: "fade gestural prompt", date: "2026-07-08" }
  ];

  const text = format97155TargetChangeSummary(summarize97155TargetChanges(changes));

  assert.match(text, /Targets introduced during the session included Manding: Request help\./);
  assert.match(text, /Targets mastered included Manding: Request break\./);
  assert.match(text, /Targets placed on hold included Listener responding: Follow one-step directions\./);
  assert.match(text, /Targets reactivated included Tolerating delay: Wait for preferred item\./);
  assert.match(text, /Targets modified included Manding: Request help \(BCBA note updated to fade gestural prompt\)\./);
});

test("97155 SOAP summary includes removed targets and protocol modifications", () => {
  const text = format97155TargetChangeSummary(summarize97155TargetChanges([
    { type: "target-removed", programName: "Manding", targetId: "target-5", targetName: "Request bubbles" },
    { type: "program-modified", programName: "Manding", field: "objective", fromValue: "request items", toValue: "request help" },
    { type: "behavior-status-changed", behaviorId: "behavior-1", targetName: "Aggression", fromStatus: "active", toStatus: "inactive" }
  ]));

  assert.match(text, /Targets removed included Manding: Request bubbles\./);
  assert.match(text, /Behavior-reduction tracking changes included Aggression \(name updated\)|Behavior-reduction tracking changes included Aggression\./);
  assert.match(text, /Protocol modifications documented during the session included Manding \(objective changed from request items to request help\)\./);
});

test("97155 SOAP session-date filter uses the selected note date", () => {
  const changes = planChangesFor97155Session([
    { type: "target-added", targetName: "Current session target", date: "2026-07-08" },
    { type: "target-added", targetName: "Other date target", date: "2026-07-07" },
    { type: "target-status-changed", targetName: "Timestamp-only target", timestamp: "2026-07-08T14:00:00.000Z" }
  ], "2026-07-08");

  assert.deepEqual(changes.map((change) => change.targetName), [
    "Current session target",
    "Timestamp-only target"
  ]);
});

test("97155 SOAP filter prefers selected session id before date fallback", () => {
  const changes = planChangesFor97155Session([
    { type: "target-status-changed", clientId: "client-1", sessionId: "97155-session-a", targetName: "Session A target", date: "2026-07-08", toStatus: "mastered" },
    { type: "target-status-changed", clientId: "client-1", sessionId: "97155-session-b", targetName: "Session B target", date: "2026-07-08", toStatus: "paused" },
    { type: "target-status-changed", clientId: "client-2", sessionId: "97155-session-a", targetName: "Other client target", date: "2026-07-08", toStatus: "active" }
  ], {
    clientId: "client-1",
    sessionId: "97155-session-a",
    sessionDate: "2026-07-08"
  });

  assert.deepEqual(changes.map((change) => change.targetName), ["Session A target"]);
});

test("97155 SOAP filter falls back to selected session date and treatment-planning context", () => {
  const changes = planChangesFor97155Session([
    { type: "target-added", clientId: "client-1", serviceCode: "97155", context: "treatment-planning", targetName: "Current 97155 target", date: "2026-07-08" },
    { type: "target-added", clientId: "client-1", serviceCode: "97153", context: "direct-therapy", targetName: "Direct therapy target", date: "2026-07-08" },
    { type: "target-added", clientId: "client-1", serviceCode: "97155", context: "treatment-planning", targetName: "Today target", date: "2026-07-10" },
    { type: "target-added", clientId: "client-2", serviceCode: "97155", context: "treatment-planning", targetName: "Other client target", date: "2026-07-08" }
  ], {
    clientId: "client-1",
    sessionDate: "2026-07-08"
  });

  assert.deepEqual(changes.map((change) => change.targetName), ["Current 97155 target"]);
});

test("97155 SOAP filter does not fall back to same-date changes when selected session id has no match", () => {
  const changes = planChangesFor97155Session([
    { type: "target-added", clientId: "client-1", serviceCode: "97155", context: "treatment-planning", targetName: "Same date other session", date: "2026-07-08" }
  ], {
    clientId: "client-1",
    sessionId: "selected-session-with-no-changes",
    sessionDate: "2026-07-08"
  });

  assert.deepEqual(changes, []);
});

test("97155 SOAP filter preserves legacy date-only treatment-plan changes for selected date", () => {
  const changes = planChangesFor97155Session([
    { type: "target-status-changed", targetName: "Legacy selected-date target", date: "2026-07-08", toStatus: "mastered" },
    { type: "target-status-changed", targetName: "Legacy today target", date: "2026-07-10", toStatus: "mastered" }
  ], {
    clientId: "client-1",
    sessionDate: "2026-07-08"
  });

  assert.deepEqual(changes.map((change) => change.targetName), ["Legacy selected-date target"]);
});

test("97155 SOAP summary uses neutral language when no target changes occurred", () => {
  const text = format97155TargetChangeSummary(summarize97155TargetChanges([]));

  assert.match(text, /The BCBA reviewed skill acquisition and behavior reduction data and implemented protocol modifications\./);
  assert.match(text, new RegExp(NO_97155_TARGET_CHANGES_STATEMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("97153 SOAP note generation still summarizes direct therapy sessions", () => {
  const note = generateSoapNote({
    clientId: "client-1",
    date: "2026-07-08",
    startTime: "09:00",
    endTime: "10:00",
    setting: "clinic",
    caregiverPresent: false,
    caregiverTraining: false,
    transitions: "typical",
    affect: "engaged",
    barriers: "none",
    behaviors: [{ behaviorId: "behavior-1", frequency: 2 }],
    programs: [{
      programId: "program-1",
      targets: [{ targetId: "target-1", independence: 80, correct: 8, trials: 10, promptLevel: "independent" }]
    }],
    providerSignature: "Diego Mursuli",
    providerCredential: "BCBA"
  }, {
    clientName: () => "Sample Client",
    programName: () => "Manding",
    targetName: () => "Request help",
    behaviorName: () => "Aggression"
  });

  assert.match(note, /Skill targets included Manding - Request help: 80% independence/);
  assert.match(note, /Behavior data: Aggression: 2/);
  assert.match(note, /Continue the current treatment plan under 97153/);
});

test("caregiver-training SOAP text remains unaffected in the shared generator", () => {
  const note = generateSoapNote({
    clientId: "client-1",
    date: "2026-07-08",
    startTime: "11:00",
    endTime: "12:00",
    setting: "home",
    caregiverPresent: true,
    caregiverTraining: true,
    transitions: "typical",
    affect: "neutral",
    barriers: "none",
    behaviors: [],
    programs: [],
    providerSignature: "Diego Mursuli",
    providerCredential: "BCBA"
  }, {
    clientName: () => "Sample Client",
    programName: () => "",
    targetName: () => "",
    behaviorName: () => ""
  });

  assert.match(note, /Caregiver was present during the session/);
  assert.match(note, /Caregiver training occurred during the visit/);
});
