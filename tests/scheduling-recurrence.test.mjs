import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_RECURRING_SERIES_VERSION,
  duplicateOriginalSlotIdentities,
  expandBoundedRecurrence,
  localDateTimeToZonedTimestamp,
  recurrenceRowMatchesDate,
  sanitizeRecurrenceAppointmentIdentity,
  sanitizeRecurrenceRows,
  sanitizeRecurringSeriesRecord,
  stableOriginalSlotIdentity,
  weekdayForDate
} from "../lib/scheduling-recurrence.mjs";

const client = {
  id: "client-1",
  agency: "Triumph ABA",
  profile: {
    serviceLocations: [{
      id: "location-1",
      name: "Home",
      settingType: "home",
      zone: "West Kendall",
      address: { line1: "123 Main", city: "Miami", state: "FL", postalCode: "33186" },
      operationalNote: "Use side gate.",
      isActive: true
    }]
  }
};
const users = [{ id: "rbt-1", agency: "Triumph ABA", role: "rbt", active: true }];

function validSeries(overrides = {}) {
  return {
    id: "series-1",
    agency: "Triumph ABA",
    clientId: "client-1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    timeZone: "America/New_York",
    status: "active",
    revisions: [{
      id: "revision-1",
      effectiveStartDate: "2026-01-01",
      effectiveEndDate: "2026-12-31",
      template: {
        serviceCode: "97153",
        providerAssignments: [{ userId: "rbt-1", assignmentRole: "primary" }],
        locationId: "location-1",
        locationSnapshot: { label: "Untrusted input", zone: "Wrong" },
        rows: [
          { rowId: "tuesday", weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" },
          { rowId: "thursday", weekday: 4, startLocalTime: "15:00", endLocalTime: "18:00" }
        ],
        authorizationRef: { number: "AUTH-1", startDate: "2026-01-01", endDate: "2026-12-31" },
        operationalNote: "Scheduling only"
      },
      createdAt: "2025-12-01T12:00:00.000Z",
      createdBy: "admin-1"
    }],
    createdAt: "2025-12-01T12:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2025-12-01T12:00:00.000Z",
    updatedBy: "admin-1",
    version: 1,
    ...overrides
  };
}

test("series sanitizer accepts a valid complete revision and uses the authoritative location snapshot", () => {
  const result = sanitizeRecurringSeriesRecord(validSeries(), {
    clients: [client], users, validateReferences: true
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.series.version, INITIAL_RECURRING_SERIES_VERSION);
  assert.equal(result.series.revisions[0].template.locationSnapshot.label, "Home");
  assert.equal(result.series.revisions[0].template.locationSnapshot.zone, "West Kendall");
  assert.deepEqual(
    result.series.revisions[0].template.rows.map((row) => row.rowId),
    ["tuesday", "thursday"]
  );
});

test("series sanitizer rejects invalid state, client, agency, provider, and location shapes", () => {
  const invalid = validSeries({
    agency: "Other Agency",
    status: "paused",
    version: 0,
    endDate: "2025-01-01"
  });
  invalid.revisions[0].template.locationId = "missing-location";
  invalid.revisions[0].template.providerAssignments = [];
  const result = sanitizeRecurringSeriesRecord(invalid, {
    clients: [client], users, validateReferences: true
  });
  assert.match(result.errors.join(" "), /endDate must be on or after/);
  assert.match(result.errors.join(" "), /status must be active or ended/);
  assert.match(result.errors.join(" "), /version must be a positive integer/);
  assert.match(result.errors.join(" "), /agency must match the client agency/);
  assert.match(result.errors.join(" "), /exactly one primary provider/);
  assert.match(result.errors.join(" "), /locationId does not belong/);

  const missingClient = sanitizeRecurringSeriesRecord(validSeries({ clientId: "missing" }), {
    clients: [client], users, validateReferences: true
  });
  assert.match(missingClient.errors.join(" "), /does not exist/);
});

test("series revisions must cover the bounded series timeline without overlap or gaps", () => {
  const gap = validSeries();
  gap.revisions = [
    { ...gap.revisions[0], effectiveEndDate: "2026-06-01" },
    {
      ...structuredClone(gap.revisions[0]),
      id: "revision-2",
      effectiveStartDate: "2026-06-03",
      effectiveEndDate: "2026-12-31"
    }
  ];
  const gapResult = sanitizeRecurringSeriesRecord(gap);
  assert.match(gapResult.errors.join(" "), /continuous effective-date timeline/);

  const overlap = structuredClone(gap);
  overlap.revisions[1].effectiveStartDate = "2026-06-01";
  const overlapResult = sanitizeRecurringSeriesRecord(overlap);
  assert.match(overlapResult.errors.join(" "), /must not overlap/);

  const continuous = validSeries();
  continuous.revisions = [
    { ...continuous.revisions[0], effectiveEndDate: "2026-06-01" },
    {
      ...structuredClone(continuous.revisions[0]),
      id: "revision-2",
      effectiveStartDate: "2026-06-02",
      effectiveEndDate: "2026-12-31"
    }
  ];
  assert.deepEqual(sanitizeRecurringSeriesRecord(continuous).errors, []);
});

test("weekday validation requires bounded unique weekday rows while supporting different times", () => {
  const valid = sanitizeRecurrenceRows([
    { rowId: "tue", weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" },
    { rowId: "thu", weekday: 4, startLocalTime: "15:00", endLocalTime: "18:00" }
  ]);
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.rows.map((row) => row.rowId), ["tue", "thu"]);
  assert.notEqual(valid.rows[0].startLocalTime, valid.rows[1].startLocalTime);

  const duplicate = sanitizeRecurrenceRows([
    { rowId: "first", weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" },
    { rowId: "second", weekday: 2, startLocalTime: "15:00", endLocalTime: "18:00" }
  ]);
  assert.match(duplicate.errors.join(" "), /weekdays must be unique/);

  const inverted = sanitizeRecurrenceRows([
    { rowId: "bad", weekday: 7, startLocalTime: "18:30", endLocalTime: "14:30" }
  ]);
  assert.match(inverted.errors.join(" "), /0 through 6/);
  assert.match(inverted.errors.join(" "), /must be after/);
});

test("weekday helpers use calendar dates deterministically", () => {
  assert.equal(weekdayForDate("2026-08-18"), 2);
  assert.equal(recurrenceRowMatchesDate({ weekday: 2 }, "2026-08-18"), true);
  assert.equal(recurrenceRowMatchesDate({ weekday: 4 }, "2026-08-18"), false);
});

test("original-slot identity is stable and duplicate detection is deterministic", () => {
  const input = { seriesId: "series-1", rowId: "tuesday", originalOccurrenceLocalDate: "2026-08-18" };
  const first = stableOriginalSlotIdentity(input);
  const second = stableOriginalSlotIdentity({ ...input });
  const different = stableOriginalSlotIdentity({ ...input, originalOccurrenceLocalDate: "2026-08-25" });
  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.match(first, /^recurrence-slot-v1-[a-f0-9]{64}$/);
  assert.deepEqual(duplicateOriginalSlotIdentities([
    { originalSlotIdentity: first }, { originalSlotIdentity: different }, { originalSlotIdentity: first }
  ]), [first]);

  const beforeRevision = expandBoundedRecurrence({
    seriesId: "series-1",
    revisionId: "revision-1",
    startDate: "2026-08-18",
    endDate: "2026-08-18",
    timeZone: "America/New_York",
    rows: [{ rowId: "tuesday", weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" }]
  });
  const afterRevision = expandBoundedRecurrence({
    seriesId: "series-1",
    revisionId: "revision-2",
    startDate: "2026-08-18",
    endDate: "2026-08-18",
    timeZone: "America/New_York",
    rows: [{ rowId: "tuesday", weekday: 2, startLocalTime: "15:00", endLocalTime: "18:00" }]
  });
  assert.equal(beforeRevision.occurrences[0].originalSlotIdentity, afterRevision.occurrences[0].originalSlotIdentity);
  assert.notEqual(beforeRevision.occurrences[0].recurrenceRevisionId, afterRevision.occurrences[0].recurrenceRevisionId);
});

test("bounded recurrence expands across month and year boundaries", () => {
  const result = expandBoundedRecurrence({
    seriesId: "series-1",
    revisionId: "revision-1",
    startDate: "2025-12-30",
    endDate: "2026-01-08",
    timeZone: "America/New_York",
    rows: [
      { rowId: "tuesday", weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" },
      { rowId: "thursday", weekday: 4, startLocalTime: "15:00", endLocalTime: "18:00" }
    ]
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.occurrences.map((item) => item.originalOccurrenceLocalDate), [
    "2025-12-30", "2026-01-01", "2026-01-06", "2026-01-08"
  ]);
  assert.equal(new Set(result.occurrences.map((item) => item.originalSlotIdentity)).size, 4);
});

test("bounded recurrence rejects invalid and inverted date ranges", () => {
  const result = expandBoundedRecurrence({
    seriesId: "series-1",
    revisionId: "revision-1",
    startDate: "2026-02-30",
    endDate: "2026-01-01",
    timeZone: "America/New_York",
    rows: [{ rowId: "tuesday", weekday: 2, startLocalTime: "14:30", endLocalTime: "18:30" }]
  });
  assert.match(result.errors.join(" "), /startDate must be a valid/);
});

test("timezone conversion preserves standard and daylight wall-clock times with correct offsets", () => {
  const standard = localDateTimeToZonedTimestamp("2026-01-13", "14:30", "America/New_York");
  const daylight = localDateTimeToZonedTimestamp("2026-07-14", "14:30", "America/New_York");
  assert.deepEqual(standard, { timestamp: "2026-01-13T14:30:00-05:00", errors: [] });
  assert.deepEqual(daylight, { timestamp: "2026-07-14T14:30:00-04:00", errors: [] });
});

test("timezone conversion rejects nonexistent and ambiguous daylight-saving times", () => {
  const nonexistent = localDateTimeToZonedTimestamp("2026-03-08", "02:30", "America/New_York");
  assert.equal(nonexistent.timestamp, "");
  assert.match(nonexistent.errors.join(" "), /does not exist/);

  const ambiguous = localDateTimeToZonedTimestamp("2026-11-01", "01:30", "America/New_York");
  assert.equal(ambiguous.timestamp, "");
  assert.match(ambiguous.errors.join(" "), /ambiguous/);
});

test("legacy appointments need no recurrence identity while complete recurrence identity validates", () => {
  const legacy = sanitizeRecurrenceAppointmentIdentity({
    recurrenceSeriesId: "",
    originalOccurrenceStartAt: ""
  });
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.identity.recurrenceException, null);

  const recurring = sanitizeRecurrenceAppointmentIdentity({
    recurrenceSeriesId: "series-1",
    recurrenceRevisionId: "revision-1",
    recurrenceRowId: "tuesday",
    recurrenceOccurrenceId: "occurrence-1",
    originalOccurrenceLocalDate: "2026-08-18",
    originalOccurrenceStartAt: "2026-08-18T14:30:00-04:00",
    generationKind: "generated",
    recurrenceException: null,
    lastSeriesOperationId: "operation-1"
  });
  assert.deepEqual(recurring.errors, []);

  const removed = sanitizeRecurrenceAppointmentIdentity({
    ...recurring.identity,
    recurrenceException: {
      type: "removed_by_series",
      baseRevisionId: "revision-1",
      operationId: "operation-2",
      createdAt: "2026-08-01T12:00:00.000Z",
      createdBy: "admin-1"
    }
  });
  assert.deepEqual(removed.errors, []);
  assert.equal(removed.identity.recurrenceException.type, "removed_by_series");
});
