import test from "node:test";
import assert from "node:assert/strict";
import { calculateSchedulingCapacity, validateSchedulingCapacityRange } from "../lib/scheduling-capacity.mjs";

const week = { startDate: "2026-09-21", endDate: "2026-09-27" };
const weeklyAvailability = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "17:00" }],
  wednesday: [{ start: "09:00", end: "17:00" }],
  thursday: [{ start: "09:00", end: "17:00" }],
  friday: [{ start: "09:00", end: "17:00" }],
  saturday: [],
  sunday: []
};

function appointment(id, overrides = {}) {
  return {
    id,
    clientId: "client-1",
    serviceCode: "97153",
    status: "scheduled",
    scheduledStartAt: "2026-09-21T09:00:00-04:00",
    scheduledEndAt: "2026-09-21T11:00:00-04:00",
    timeZone: "America/New_York",
    providerAssignments: [{ userId: "rbt-1", assignmentRole: "primary" }],
    ...overrides
  };
}

test("capacity separates scheduled and confirmed time and ignores non-blocking statuses", () => {
  const result = calculateSchedulingCapacity({
    ...week,
    users: [
      { id: "rbt-1", name: "RBT One", role: "rbt", active: true },
      { id: "bcba-1", name: "BCBA One", role: "bcba", active: true },
      { id: "rbt-inactive", name: "Inactive", role: "rbt", active: false }
    ],
    clients: [{ id: "client-1", name: "Client One", status: "active" }],
    appointments: [
      appointment("scheduled"),
      appointment("confirmed", { status: "confirmed", scheduledStartAt: "2026-09-22T10:00:00-04:00", scheduledEndAt: "2026-09-22T11:30:00-04:00" }),
      appointment("back-to-back", { scheduledStartAt: "2026-09-21T11:00:00-04:00", scheduledEndAt: "2026-09-21T12:00:00-04:00" }),
      appointment("cancelled", { status: "cancelled" }),
      appointment("completed", { status: "completed" }),
      appointment("no-show", { status: "no_show" }),
      appointment("outside", { scheduledStartAt: "2026-09-28T09:00:00-04:00", scheduledEndAt: "2026-09-28T10:00:00-04:00" })
    ],
    providerAvailabilityProfiles: [{ providerUserId: "rbt-1", active: true, effectiveDate: "2026-09-21", timezone: "America/New_York", weeklyAvailability }]
  });
  const rbt = result.providerCapacity.find((item) => item.provider.userId === "rbt-1");
  assert.equal(rbt.scheduledHours, 3);
  assert.equal(rbt.confirmedHours, 1.5);
  assert.equal(rbt.totalBlockingHours, 4.5);
  assert.equal(rbt.availability.availableHours, 40);
  assert.equal(rbt.availability.remainingHours, 35.5);
  assert.equal(rbt.availability.utilizationPercent, 11);
  assert.equal(result.providerCapacity.length, 2);
});

test("capacity respects local appointment dates, availability effective dates, assignments, zones, and client coverage", () => {
  const result = calculateSchedulingCapacity({
    ...week,
    users: [
      { id: "rbt-1", name: "RBT One", role: "rbt", active: true },
      { id: "rbt-2", name: "RBT Two", role: "rbt", active: true },
      { id: "inactive-rbt", name: "Inactive RBT", role: "rbt", active: false },
      { id: "bcba-1", name: "BCBA One", role: "bcba", active: true }
    ],
    clients: [
      { id: "client-1", name: "Covered", status: "active", profile: { serviceLocations: [{ id: "loc-1", zone: "Kendall", isPrimary: true, isActive: true }] } },
      { id: "client-2", name: "Assigned Only", status: "active", profile: { serviceLocations: [{ id: "loc-2", zone: "Doral", isActive: true }] } },
      { id: "client-3", name: "Unassigned", status: "active" },
      { id: "archived", name: "Archived", status: "archived" }
    ],
    appointments: [
      appointment("sunday-local", { scheduledStartAt: "2026-09-28T00:30:00.000Z", scheduledEndAt: "2026-09-28T01:30:00.000Z" }),
      appointment("client-1-confirmed", { status: "confirmed", scheduledStartAt: "2026-09-23T12:00:00-04:00", scheduledEndAt: "2026-09-23T14:00:00-04:00" })
    ],
    providerAvailabilityProfiles: [
      { providerUserId: "rbt-1", active: true, effectiveDate: "2026-09-23", timezone: "America/New_York", weeklyAvailability },
      { providerUserId: "rbt-2", active: false, effectiveDate: "2026-09-21", timezone: "America/New_York", weeklyAvailability }
    ],
    providerZoneProfiles: [{ providerUserId: "rbt-1", active: true, primaryZone: "Kendall", acceptableZones: ["Doral"] }],
    clientUserAssignments: [
      { clientId: "client-1", userId: "rbt-1" },
      { clientId: "client-1", userId: "rbt-2" },
      { clientId: "client-1", userId: "inactive-rbt" },
      { clientId: "client-1", userId: "inactive-rbt", active: false },
      { clientId: "client-2", userId: "rbt-2" },
      { clientId: "archived", userId: "rbt-1" },
      { clientId: "client-3", userId: "bcba-1" }
    ]
  });
  const rbt = result.providerCapacity.find((item) => item.provider.userId === "rbt-1");
  assert.equal(rbt.totalBlockingHours, 3);
  assert.equal(rbt.availability.availableHours, 24);
  assert.equal(rbt.assignedClientCount, 1);
  assert.deepEqual(rbt.zone, { primaryZone: "Kendall", acceptableZones: ["Doral"] });
  const secondRbt = result.providerCapacity.find((item) => item.provider.userId === "rbt-2");
  assert.equal(secondRbt.availabilityConfigured, false);
  assert.equal(secondRbt.availability, null);
  const covered = result.clientCoverage.find((item) => item.client.clientId === "client-1");
  assert.equal(covered.activeRbtAssignmentCount, 2);
  assert.equal(covered.multipleRbtsAssigned, true);
  assert.equal(covered.scheduled97153Hours, 3);
  assert.equal(covered.serviceLocationZone, "Kendall");
  assert.equal(covered.coverageStatus, "scheduled");
  assert.equal(result.clientCoverage.find((item) => item.client.clientId === "client-2").coverageStatus, "assigned_no_97153_scheduled");
  assert.equal(result.clientCoverage.find((item) => item.client.clientId === "client-3").coverageStatus, "no_rbt_assigned");
  assert.equal(result.clientCoverage.some((item) => item.client.clientId === "archived"), false);
});

test("capacity calculates providers independently, counts secondary provider time, and clamps remaining hours", () => {
  const result = calculateSchedulingCapacity({
    ...week,
    users: [
      { id: "rbt-1", name: "Alpha", role: "rbt", active: true },
      { id: "bcba-1", name: "Bravo", role: "bcba", active: true }
    ],
    clients: [{ id: "client-1", name: "Client", status: "active" }],
    appointments: [appointment("shared", {
      scheduledStartAt: "2026-09-21T09:00:00-04:00",
      scheduledEndAt: "2026-09-21T12:00:00-04:00",
      providerAssignments: [
        { userId: "rbt-1", assignmentRole: "primary" },
        { userId: "bcba-1", assignmentRole: "secondary" }
      ]
    })],
    providerAvailabilityProfiles: [
      { providerUserId: "rbt-1", active: true, effectiveDate: "2026-09-21", timezone: "America/New_York", weeklyAvailability: { monday: [{ start: "09:00", end: "10:00" }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } },
      { providerUserId: "bcba-1", active: true, effectiveDate: "2026-09-21", timezone: "America/New_York", weeklyAvailability: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } }
    ],
    clientUserAssignments: [{ clientId: "client-1", userId: "rbt-1" }]
  });
  const rbt = result.providerCapacity.find((item) => item.provider.userId === "rbt-1");
  const bcba = result.providerCapacity.find((item) => item.provider.userId === "bcba-1");
  assert.equal(rbt.totalBlockingHours, 3);
  assert.equal(bcba.totalBlockingHours, 3);
  assert.equal(rbt.availability.remainingHours, 0);
  assert.equal(rbt.availability.utilizationPercent, 300);
  assert.equal(bcba.availability.remainingHours, 0);
  assert.equal(bcba.availability.utilizationPercent, null);
  assert.equal(rbt.assignedClientCount, 1);
  assert.equal(bcba.assignedClientCount, null);
});

test("client direct-treatment coverage excludes cancelled and non-97153 appointments and reads a legacy location zone", () => {
  const result = calculateSchedulingCapacity({
    ...week,
    users: [{ id: "rbt-1", name: "RBT", role: "rbt", active: true }],
    clients: [{ id: "client-1", name: "Legacy Location", status: "active", serviceLocations: [{ id: "legacy-location", zone: "Tamiami", isActive: true }] }],
    appointments: [
      appointment("cancelled", { status: "cancelled" }),
      appointment("other-service", { serviceCode: "97155" })
    ],
    clientUserAssignments: [
      { clientId: "client-1", userId: "rbt-1" },
      { clientId: "client-1", userId: "rbt-1", active: false }
    ]
  });
  assert.equal(result.clientCoverage[0].activeRbtAssignmentCount, 1);
  assert.equal(result.clientCoverage[0].scheduled97153Hours, 0);
  assert.equal(result.clientCoverage[0].coverageStatus, "assigned_no_97153_scheduled");
  assert.equal(result.clientCoverage[0].serviceLocationZone, "Tamiami");
});

test("capacity range validation requires real ordered dates and caps reports at four weeks", () => {
  assert.deepEqual(validateSchedulingCapacityRange("2026-09-21", "2026-10-18"), []);
  assert.match(validateSchedulingCapacityRange("2026-09-22", "2026-09-21").join(" "), /on or after/);
  assert.match(validateSchedulingCapacityRange("2026-09-21", "2026-10-19").join(" "), /at most 28 days/);
  assert.match(validateSchedulingCapacityRange("2026-02-30", "2026-03-01").join(" "), /valid YYYY-MM-DD/);
});
