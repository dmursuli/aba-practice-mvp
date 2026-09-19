import test from "node:test";
import assert from "node:assert/strict";
import {
  appointmentIntervalsOverlap,
  appointmentStatusBlocksScheduling,
  validateProviderScheduling
} from "../lib/scheduling-conflicts.mjs";

const users = [
  { id: "provider-1", name: "RBT User" },
  { id: "provider-2", name: "Second RBT" }
];

function appointment(overrides = {}) {
  return {
    id: "appointment-1",
    status: "scheduled",
    providerAssignments: [{ userId: "provider-1", assignmentRole: "primary" }],
    scheduledStartAt: "2026-09-21T09:00:00-04:00",
    scheduledEndAt: "2026-09-21T12:00:00-04:00",
    timeZone: "America/New_York",
    ...overrides
  };
}

function profile(overrides = {}) {
  return {
    providerUserId: "provider-1",
    active: true,
    effectiveDate: "2026-09-01",
    timezone: "America/New_York",
    weeklyAvailability: {
      monday: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
    },
    ...overrides
  };
}

test("interval overlap rejects exact, partial, contained, and surrounding ranges but permits back-to-back", () => {
  const existing = appointment();
  assert.equal(appointmentIntervalsOverlap(existing, appointment()), true);
  assert.equal(appointmentIntervalsOverlap(existing, appointment({
    scheduledStartAt: "2026-09-21T08:00:00-04:00",
    scheduledEndAt: "2026-09-21T10:00:00-04:00"
  })), true);
  assert.equal(appointmentIntervalsOverlap(existing, appointment({
    scheduledStartAt: "2026-09-21T09:30:00-04:00",
    scheduledEndAt: "2026-09-21T10:30:00-04:00"
  })), true);
  assert.equal(appointmentIntervalsOverlap(existing, appointment({
    scheduledStartAt: "2026-09-21T08:00:00-04:00",
    scheduledEndAt: "2026-09-21T13:00:00-04:00"
  })), true);
  assert.equal(appointmentIntervalsOverlap(existing, appointment({
    scheduledStartAt: "2026-09-21T12:00:00-04:00",
    scheduledEndAt: "2026-09-21T13:00:00-04:00"
  })), false);
});

test("scheduled and confirmed block while completed, cancelled, and no-show history do not", () => {
  assert.equal(appointmentStatusBlocksScheduling("scheduled"), true);
  assert.equal(appointmentStatusBlocksScheduling("confirmed"), true);
  assert.equal(appointmentStatusBlocksScheduling("completed"), false);
  assert.equal(appointmentStatusBlocksScheduling("cancelled"), false);
  assert.equal(appointmentStatusBlocksScheduling("no_show"), false);
});

test("provider overlap is blocking, readable, provider-specific, and supports self-exclusion", () => {
  const existing = appointment();
  const overlapping = appointment({
    id: "appointment-2",
    scheduledStartAt: "2026-09-21T09:30:00-04:00",
    scheduledEndAt: "2026-09-21T10:30:00-04:00"
  });
  const blocked = validateProviderScheduling({ appointments: [existing], proposedAppointments: [overlapping], users });
  assert.equal(blocked.errors.length, 1);
  assert.match(blocked.errors[0], /RBT User is already scheduled from 9:00 AM to 12:00 PM/);
  assert.doesNotMatch(blocked.errors[0], /appointment-1|provider-1/);

  const selfExcluded = validateProviderScheduling({
    appointments: [existing], proposedAppointments: [existing], users, excludedAppointmentIds: [existing.id]
  });
  assert.deepEqual(selfExcluded.errors, []);

  const differentProvider = validateProviderScheduling({
    appointments: [existing],
    proposedAppointments: [appointment({
      id: "appointment-3",
      providerAssignments: [{ userId: "provider-2", assignmentRole: "primary" }]
    })],
    users
  });
  assert.deepEqual(differentProvider.errors, []);
});

test("cancelled appointments do not block and proposed recurring appointments conflict with each other", () => {
  const cancelled = appointment({ status: "cancelled" });
  const proposed = appointment({ id: "appointment-2" });
  assert.deepEqual(validateProviderScheduling({
    appointments: [cancelled], proposedAppointments: [proposed], users
  }).errors, []);

  const recurringPair = validateProviderScheduling({
    proposedAppointments: [
      appointment({ id: "occurrence-1" }),
      appointment({ id: "occurrence-2", scheduledStartAt: "2026-09-21T11:00:00-04:00", scheduledEndAt: "2026-09-21T13:00:00-04:00" })
    ],
    users
  });
  assert.equal(recurringPair.errors.length, 1);
});

test("availability accepts contained appointments and multiple blocks but rejects every boundary violation", () => {
  const configured = profile();
  const insideMorning = appointment({ scheduledStartAt: "2026-09-21T09:00:00-04:00", scheduledEndAt: "2026-09-21T11:00:00-04:00" });
  const insideAfternoon = appointment({ scheduledStartAt: "2026-09-21T13:30:00-04:00", scheduledEndAt: "2026-09-21T16:00:00-04:00" });
  for (const proposed of [insideMorning, insideAfternoon]) {
    assert.deepEqual(validateProviderScheduling({ proposedAppointments: [proposed], providerAvailabilityProfiles: [configured], users }).errors, []);
  }

  for (const proposed of [
    appointment({ scheduledStartAt: "2026-09-21T07:30:00-04:00", scheduledEndAt: "2026-09-21T09:00:00-04:00" }),
    appointment({ scheduledStartAt: "2026-09-21T11:00:00-04:00", scheduledEndAt: "2026-09-21T12:30:00-04:00" }),
    appointment({ scheduledStartAt: "2026-09-21T11:00:00-04:00", scheduledEndAt: "2026-09-21T13:30:00-04:00" }),
    appointment({ scheduledStartAt: "2026-09-21T17:00:00-04:00", scheduledEndAt: "2026-09-21T18:00:00-04:00" })
  ]) {
    const result = validateProviderScheduling({ proposedAppointments: [proposed], providerAvailabilityProfiles: [configured], users });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /falls outside RBT User’s configured availability/);
  }
});

test("availability resolves weekday in the profile timezone", () => {
  const utcAppointment = appointment({
    scheduledStartAt: "2026-09-22T01:00:00Z",
    scheduledEndAt: "2026-09-22T02:00:00Z",
    timeZone: "UTC"
  });
  const result = validateProviderScheduling({
    proposedAppointments: [utcAppointment],
    providerAvailabilityProfiles: [profile({ weeklyAvailability: {
      monday: [{ start: "20:00", end: "23:00" }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
    } })],
    users
  });
  assert.deepEqual(result.errors, []);
});

test("missing, inactive, and not-yet-effective availability warn without blocking", () => {
  for (const profiles of [[], [profile({ active: false })], [profile({ effectiveDate: "2026-10-01" })]]) {
    const result = validateProviderScheduling({
      proposedAppointments: [appointment()], providerAvailabilityProfiles: profiles, users
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].message, "Availability has not been configured for this provider.");
  }
});
