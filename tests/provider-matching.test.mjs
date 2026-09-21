import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProviderMatches } from "../lib/provider-matching.mjs";

const interval = {
  scheduledStartAt: "2026-09-21T09:00:00-04:00",
  scheduledEndAt: "2026-09-21T10:00:00-04:00",
  timeZone: "America/New_York"
};

function user(id, name, role = "rbt", active = true) {
  return { id, name, role, active };
}

function availability(providerUserId, overrides = {}) {
  return {
    providerUserId,
    active: true,
    effectiveDate: "2026-09-01",
    timezone: "America/New_York",
    weeklyAvailability: {
      monday: [{ start: "09:00", end: "17:00" }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
    },
    ...overrides
  };
}

function zone(providerUserId, primaryZone, acceptableZones = [], overrides = {}) {
  return { providerUserId, primaryZone, acceptableZones, active: true, ...overrides };
}

function appointment(providerUserId, overrides = {}) {
  return {
    id: `appointment-${providerUserId}`,
    status: "scheduled",
    providerAssignments: [{ userId: providerUserId, assignmentRole: "primary" }],
    ...interval,
    ...overrides
  };
}

function evaluate(overrides = {}) {
  return evaluateProviderMatches({
    users: [user("rbt-1", "Riley RBT"), user("bcba-1", "Bailey BCBA", "bcba")],
    appointments: [],
    providerAvailabilityProfiles: [],
    providerZoneProfiles: [],
    clientUserAssignments: [],
    clientId: "client-1",
    serviceCode: "97153",
    serviceZone: "Kendall",
    ...interval,
    ...overrides
  });
}

function candidates(result) {
  return result.groups.flatMap((group) => group.candidates);
}

function candidate(result, providerUserId) {
  return candidates(result).find((item) => item.provider.userId === providerUserId);
}

test("service eligibility includes only active role-compatible providers without requiring client assignments", () => {
  const users = [
    user("rbt-1", "Active RBT"),
    user("rbt-2", "Inactive RBT", "rbt", false),
    user("bcba-1", "Active BCBA", "bcba")
  ];
  assert.deepEqual(candidates(evaluate({ users, serviceCode: "97153" })).map((item) => item.provider.userId), ["rbt-1"]);
  assert.deepEqual(candidates(evaluate({ users, serviceCode: "97155" })).map((item) => item.provider.userId), ["bcba-1"]);
  assert.deepEqual(candidates(evaluate({ users, serviceCode: "97151" })).map((item) => item.provider.userId), ["bcba-1"]);
  assert.deepEqual(candidates(evaluate({ users, serviceCode: "97156" })).map((item) => item.provider.userId), ["bcba-1"]);
});

test("RBT assignment status is factual context and never changes matching eligibility or grouping", () => {
  const users = [user("assigned", "Assigned RBT"), user("unassigned", "Unassigned RBT")];
  const providerZoneProfiles = users.map((provider) => zone(provider.id, "Kendall"));
  const providerAvailabilityProfiles = users.map((provider) => availability(provider.id));
  const before = evaluate({ users, providerZoneProfiles, providerAvailabilityProfiles });
  const after = evaluate({
    users,
    providerZoneProfiles,
    providerAvailabilityProfiles,
    clientUserAssignments: [{ id: "assignment-1", clientId: "client-1", userId: "assigned" }]
  });

  assert.deepEqual(candidate(before, "assigned").caseAssignment, { status: "not_assigned", label: "Not assigned" });
  assert.deepEqual(candidate(after, "assigned").caseAssignment, { status: "assigned", label: "Already assigned to this client" });
  assert.deepEqual(candidate(after, "unassigned").caseAssignment, { status: "not_assigned", label: "Not assigned" });
  assert.equal(candidate(before, "assigned").group, candidate(after, "assigned").group);
  assert.equal(candidate(before, "unassigned").group, candidate(after, "unassigned").group);
  assert.equal(candidates(before).length, candidates(after).length);
});

test("BCBA matching remains independent of RBT client assignment records", () => {
  const result = evaluate({
    users: [user("bcba-1", "Bailey BCBA", "bcba")],
    serviceCode: "97155",
    clientUserAssignments: [{ id: "legacy-bcba-assignment", clientId: "client-1", userId: "bcba-1" }]
  });
  assert.equal(candidates(result).length, 1);
  assert.equal(candidate(result, "bcba-1").caseAssignment, null);
});

test("zone evaluation distinguishes primary, acceptable, outside, missing, and legacy location zones", () => {
  const users = [user("primary", "Primary"), user("acceptable", "Acceptable"), user("outside", "Outside"), user("missing", "Missing")];
  const providerZoneProfiles = [
    zone("primary", "Kendall"),
    zone("acceptable", "Doral", ["Kendall"]),
    zone("outside", "Doral", ["Homestead"]),
    zone("missing", "Kendall", [], { active: false })
  ];
  const result = evaluate({ users, providerZoneProfiles });
  assert.equal(candidate(result, "primary").zone.status, "primary");
  assert.equal(candidate(result, "acceptable").zone.status, "acceptable");
  assert.equal(candidate(result, "outside").zone.status, "outside");
  assert.equal(candidate(result, "missing").zone.status, "not_configured");

  const legacy = evaluate({ users, providerZoneProfiles, serviceZone: "Tamiami" });
  assert.equal(legacy.serviceZoneCurrent, false);
  assert.ok(candidates(legacy).every((item) => item.zone.status === "service_zone_not_current"));
});

test("availability distinguishes exact-fit, outside, missing, inactive, and not-yet-effective profiles", () => {
  const users = [user("exact", "Exact"), user("outside", "Outside"), user("missing", "Missing"), user("inactive", "Inactive"), user("future", "Future")];
  const providerAvailabilityProfiles = [
    availability("exact", { weeklyAvailability: { monday: [{ start: "09:00", end: "10:00" }] } }),
    availability("outside", { weeklyAvailability: { monday: [{ start: "10:00", end: "17:00" }] } }),
    availability("inactive", { active: false }),
    availability("future", { effectiveDate: "2026-09-22" })
  ];
  const result = evaluate({ users, providerAvailabilityProfiles });
  assert.equal(candidate(result, "exact").availability.status, "available");
  assert.equal(candidate(result, "outside").availability.status, "outside");
  assert.equal(candidate(result, "missing").availability.status, "not_configured");
  assert.equal(candidate(result, "inactive").availability.status, "not_configured");
  assert.equal(candidate(result, "future").availability.status, "not_configured");
});

test("conflicts reuse blocking-status and overlap semantics including back-to-back behavior", () => {
  const users = [user("provider", "Provider")];
  const statusResult = (status) => evaluate({ users, appointments: [appointment("provider", { status })] });
  for (const status of ["scheduled", "confirmed"]) {
    const match = candidate(statusResult(status), "provider");
    assert.equal(match.schedule.status, "conflict");
    assert.equal(match.schedule.label, "Conflict: 9:00 AM–10:00 AM");
    assert.doesNotMatch(JSON.stringify(match.schedule), /clientId|clientName/);
  }
  for (const status of ["cancelled", "no_show", "completed"]) {
    assert.equal(candidate(statusResult(status), "provider").schedule.status, "none");
  }
  const backToBack = evaluate({
    users,
    appointments: [appointment("provider", {
      scheduledStartAt: "2026-09-21T08:00:00-04:00",
      scheduledEndAt: "2026-09-21T09:00:00-04:00"
    })]
  });
  assert.equal(candidate(backToBack, "provider").schedule.status, "none");
});

test("grouping is transparent, deterministic, alphabetical, and contains no numeric score", () => {
  const users = [user("z-best", "Zoe Best"), user("a-best", "Amy Best"), user("good", "Good Provider"), user("other", "Other Provider"), user("missing", "Missing Availability"), user("blocked", "Blocked Provider")];
  const providerZoneProfiles = [
    zone("z-best", "Kendall"), zone("a-best", "Kendall"),
    zone("good", "Doral", ["Kendall"]), zone("other", "Doral"),
    zone("missing", "Kendall"), zone("blocked", "Kendall")
  ];
  const providerAvailabilityProfiles = users
    .filter((provider) => provider.id !== "missing")
    .map((provider) => availability(provider.id));
  const result = evaluate({
    users,
    providerZoneProfiles,
    providerAvailabilityProfiles,
    appointments: [appointment("blocked")]
  });
  const byGroup = Object.fromEntries(result.groups.map((group) => [group.key, group.candidates]));
  assert.deepEqual(byGroup.best_match.map((item) => item.provider.name), ["Amy Best", "Zoe Best"]);
  assert.deepEqual(byGroup.good_match.map((item) => item.provider.name), ["Good Provider"]);
  assert.deepEqual(byGroup.other_options.map((item) => item.provider.name), ["Missing Availability", "Other Provider"]);
  assert.deepEqual(byGroup.unavailable_or_conflicted.map((item) => item.provider.name), ["Blocked Provider"]);
  assert.doesNotMatch(JSON.stringify(result), /score|percent|%/i);
});
