import { createHash } from "node:crypto";

const SERVICE_CODES = new Set(["97151", "97153", "97155", "97156"]);
const SERIES_STATUSES = new Set(["active", "ended"]);
const GENERATION_KINDS = new Set(["", "generated", "manually_added"]);
const ASSIGNMENT_ROLES = new Set(["primary"]);
const EXCEPTION_TYPES = new Set([
  "modified",
  "cancelled",
  "moved",
  "provider_substitution",
  "manually_added",
  "removed_by_series"
]);

export const INITIAL_RECURRING_SERIES_VERSION = 1;

export function isValidDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isValidLocalTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

export function isValidIanaTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isValidTimestamp(value) {
  return Boolean(String(value || "").trim()) && Number.isFinite(Date.parse(value));
}

export function weekdayForDate(dateValue) {
  if (!isValidDateOnly(dateValue)) return -1;
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function recurrenceRowMatchesDate(row, dateValue) {
  return Number(row?.weekday) === weekdayForDate(dateValue);
}

export function sanitizeRecurrenceRows(value) {
  const errors = [];
  if (!Array.isArray(value) || !value.length) {
    return { rows: [], errors: ["At least one recurrence row is required."] };
  }
  const rows = value.map((row, index) => {
    const rowId = String(row?.rowId || "").trim();
    const weekday = Number(row?.weekday);
    const startLocalTime = String(row?.startLocalTime || "").trim();
    const endLocalTime = String(row?.endLocalTime || "").trim();
    if (!rowId) errors.push(`Recurrence row ${index + 1} requires a rowId.`);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      errors.push(`Recurrence row ${index + 1} weekday must be an integer from 0 through 6.`);
    }
    if (!isValidLocalTime(startLocalTime)) {
      errors.push(`Recurrence row ${index + 1} requires a valid startLocalTime.`);
    }
    if (!isValidLocalTime(endLocalTime)) {
      errors.push(`Recurrence row ${index + 1} requires a valid endLocalTime.`);
    }
    if (isValidLocalTime(startLocalTime) && isValidLocalTime(endLocalTime) && endLocalTime <= startLocalTime) {
      errors.push(`Recurrence row ${index + 1} endLocalTime must be after startLocalTime.`);
    }
    return { rowId, weekday, startLocalTime, endLocalTime };
  });
  const rowIds = rows.map((row) => row.rowId).filter(Boolean);
  if (new Set(rowIds).size !== rowIds.length) errors.push("Recurrence row IDs must be unique.");
  const weekdays = rows.map((row) => row.weekday).filter((weekday) => Number.isInteger(weekday));
  if (new Set(weekdays).size !== weekdays.length) errors.push("Recurrence weekdays must be unique within a revision.");
  return { rows, errors: [...new Set(errors)] };
}

function dateParts(dateValue, timeValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  return { year, month, day, hour, minute };
}

function formatterFor(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formattedParts(formatter, instant) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function partsEqual(left, right) {
  return ["year", "month", "day", "hour", "minute"].every((key) => left[key] === right[key]);
}

function offsetMinutesAt(formatter, instant) {
  const observed = formattedParts(formatter, instant);
  const observedAsUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute
  );
  return Math.round((observedAsUtc - instant) / 60000);
}

function formatOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function localDateTimeToZonedTimestamp(dateValue, timeValue, timeZone) {
  const errors = [];
  if (!isValidDateOnly(dateValue)) errors.push("Local date must be a valid YYYY-MM-DD date.");
  if (!isValidLocalTime(timeValue)) errors.push("Local time must use HH:MM in 24-hour time.");
  if (!isValidIanaTimeZone(timeZone)) errors.push("A valid IANA timezone is required.");
  if (errors.length) return { timestamp: "", errors };

  const target = dateParts(dateValue, timeValue);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const formatter = formatterFor(timeZone);
  const sampleInstants = [
    targetAsUtc - (2 * 86400000),
    targetAsUtc - 86400000,
    targetAsUtc,
    targetAsUtc + 86400000,
    targetAsUtc + (2 * 86400000)
  ];
  const offsets = [...new Set(sampleInstants.map((instant) => offsetMinutesAt(formatter, instant)))];
  const matches = offsets
    .map((offsetMinutes) => ({ instant: targetAsUtc - (offsetMinutes * 60000), offsetMinutes }))
    .filter((candidate) => partsEqual(formattedParts(formatter, candidate.instant), target))
    .sort((a, b) => a.instant - b.instant);

  if (!matches.length) {
    return {
      timestamp: "",
      errors: [`${dateValue} ${timeValue} does not exist in ${timeZone} because of a daylight-saving transition.`]
    };
  }
  if (matches.length > 1) {
    return {
      timestamp: "",
      errors: [`${dateValue} ${timeValue} is ambiguous in ${timeZone} because of a daylight-saving transition.`]
    };
  }
  return {
    timestamp: `${dateValue}T${timeValue}:00${formatOffset(matches[0].offsetMinutes)}`,
    errors: []
  };
}

export function stableOriginalSlotIdentity({ seriesId, rowId, originalOccurrenceLocalDate }) {
  const values = [seriesId, rowId, originalOccurrenceLocalDate].map((value) => String(value || "").trim());
  if (!values[0] || !values[1] || !isValidDateOnly(values[2])) return "";
  const digest = createHash("sha256").update(JSON.stringify(["recurrence-slot-v1", ...values])).digest("hex");
  return `recurrence-slot-v1-${digest}`;
}

export function duplicateOriginalSlotIdentities(occurrences) {
  const seen = new Set();
  const duplicates = new Set();
  for (const occurrence of occurrences || []) {
    const identity = String(occurrence?.originalSlotIdentity || "").trim();
    if (!identity) continue;
    if (seen.has(identity)) duplicates.add(identity);
    seen.add(identity);
  }
  return [...duplicates].sort();
}

function nextDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function expandBoundedRecurrence({ seriesId, revisionId, startDate, endDate, timeZone, rows }) {
  const errors = [];
  if (!String(seriesId || "").trim()) errors.push("seriesId is required.");
  if (!String(revisionId || "").trim()) errors.push("revisionId is required.");
  if (!isValidDateOnly(startDate)) errors.push("startDate must be a valid YYYY-MM-DD date.");
  if (!isValidDateOnly(endDate)) errors.push("endDate must be a valid YYYY-MM-DD date.");
  if (isValidDateOnly(startDate) && isValidDateOnly(endDate) && endDate < startDate) {
    errors.push("endDate must be on or after startDate.");
  }
  if (!isValidIanaTimeZone(timeZone)) errors.push("A valid IANA timezone is required.");
  const rowResult = sanitizeRecurrenceRows(rows);
  errors.push(...rowResult.errors);
  if (errors.length) return { occurrences: [], errors: [...new Set(errors)] };

  const occurrences = [];
  for (let dateValue = startDate; dateValue <= endDate; dateValue = nextDate(dateValue)) {
    const row = rowResult.rows.find((candidate) => recurrenceRowMatchesDate(candidate, dateValue));
    if (!row) continue;
    const start = localDateTimeToZonedTimestamp(dateValue, row.startLocalTime, timeZone);
    const end = localDateTimeToZonedTimestamp(dateValue, row.endLocalTime, timeZone);
    if (start.errors.length || end.errors.length) {
      errors.push(...start.errors, ...end.errors);
      continue;
    }
    if (Date.parse(end.timestamp) <= Date.parse(start.timestamp)) {
      errors.push(`Recurrence row ${row.rowId} does not produce a positive duration on ${dateValue}.`);
      continue;
    }
    occurrences.push({
      recurrenceSeriesId: String(seriesId).trim(),
      recurrenceRevisionId: String(revisionId).trim(),
      recurrenceRowId: row.rowId,
      originalOccurrenceLocalDate: dateValue,
      originalOccurrenceStartAt: start.timestamp,
      scheduledStartAt: start.timestamp,
      scheduledEndAt: end.timestamp,
      originalSlotIdentity: stableOriginalSlotIdentity({
        seriesId,
        rowId: row.rowId,
        originalOccurrenceLocalDate: dateValue
      })
    });
  }
  const duplicates = duplicateOriginalSlotIdentities(occurrences);
  if (duplicates.length) errors.push("Generated recurrence contains duplicate original-slot identities.");
  return { occurrences: errors.length ? [] : occurrences, errors: [...new Set(errors)] };
}

function cleanLocationSnapshot(value = {}) {
  return {
    label: String(value.label || value.name || "").trim(),
    zone: String(value.zone || "").trim(),
    addressLine1: String(value.addressLine1 ?? value.address?.line1 ?? "").trim(),
    addressLine2: String(value.addressLine2 ?? value.address?.line2 ?? "").trim(),
    city: String(value.city ?? value.address?.city ?? "").trim(),
    state: String(value.state ?? value.address?.state ?? "").trim(),
    postalCode: String(value.postalCode ?? value.address?.postalCode ?? "").trim(),
    operationalNote: String(value.operationalNote || "").trim()
  };
}

function cleanAuthorizationRef(value = {}) {
  return {
    number: String(value.number || "").trim(),
    startDate: String(value.startDate || "").trim(),
    endDate: String(value.endDate || "").trim()
  };
}

function sanitizeTemplate(value, revisionIndex) {
  const errors = [];
  const serviceCode = String(value?.serviceCode || "").trim();
  if (!SERVICE_CODES.has(serviceCode)) errors.push(`Revision ${revisionIndex + 1} has an unsupported serviceCode.`);
  const providerAssignments = Array.isArray(value?.providerAssignments)
    ? value.providerAssignments.map((assignment) => ({
      userId: String(assignment?.userId || "").trim(),
      assignmentRole: String(assignment?.assignmentRole || "").trim()
    }))
    : [];
  if (providerAssignments.length !== 1
    || !providerAssignments[0]?.userId
    || !ASSIGNMENT_ROLES.has(providerAssignments[0]?.assignmentRole)) {
    errors.push(`Revision ${revisionIndex + 1} requires exactly one primary provider.`);
  }
  const locationId = String(value?.locationId || "").trim();
  if (!locationId) errors.push(`Revision ${revisionIndex + 1} requires a locationId.`);
  const rowResult = sanitizeRecurrenceRows(value?.rows);
  errors.push(...rowResult.errors.map((error) => `Revision ${revisionIndex + 1}: ${error}`));
  const authorizationRef = cleanAuthorizationRef(value?.authorizationRef);
  if (authorizationRef.startDate && !isValidDateOnly(authorizationRef.startDate)) {
    errors.push(`Revision ${revisionIndex + 1} authorization startDate is invalid.`);
  }
  if (authorizationRef.endDate && !isValidDateOnly(authorizationRef.endDate)) {
    errors.push(`Revision ${revisionIndex + 1} authorization endDate is invalid.`);
  }
  if (authorizationRef.startDate && authorizationRef.endDate
    && authorizationRef.endDate < authorizationRef.startDate) {
    errors.push(`Revision ${revisionIndex + 1} authorization endDate must be on or after startDate.`);
  }
  const operationalNote = String(value?.operationalNote || "").trim();
  if (operationalNote.length > 360) errors.push(`Revision ${revisionIndex + 1} operationalNote must be 360 characters or fewer.`);
  return {
    template: {
      serviceCode,
      providerAssignments,
      locationId,
      locationSnapshot: cleanLocationSnapshot(value?.locationSnapshot),
      rows: rowResult.rows,
      authorizationRef,
      operationalNote
    },
    errors
  };
}

function referenceErrors(series, { clients, users, requireActiveReferences }) {
  const errors = [];
  const client = clients.find((item) => item?.id === series.clientId);
  if (!client) return [`Series clientId ${series.clientId || "(blank)"} does not exist.`];
  if (String(client.agency || "").trim() !== series.agency) errors.push("Series agency must match the client agency.");
  for (const [index, revision] of series.revisions.entries()) {
    const assignment = revision.template.providerAssignments[0];
    const provider = users.find((item) => item?.id === assignment?.userId);
    if (!provider) errors.push(`Revision ${index + 1} provider does not exist.`);
    else {
      if (String(provider.agency || "").trim() !== series.agency) errors.push(`Revision ${index + 1} provider agency does not match.`);
      if (requireActiveReferences && provider.active === false) errors.push(`Revision ${index + 1} provider must be active.`);
      const expectedRole = revision.template.serviceCode === "97153" ? "rbt" : "bcba";
      if (provider.role !== expectedRole) errors.push(`Revision ${index + 1} provider role is not permitted for the serviceCode.`);
    }
    const locations = Array.isArray(client.profile?.serviceLocations) ? client.profile.serviceLocations : [];
    const location = locations.find((item) => item?.id === revision.template.locationId);
    if (!location) errors.push(`Revision ${index + 1} locationId does not belong to the client.`);
    else {
      if (requireActiveReferences && location.isActive === false) errors.push(`Revision ${index + 1} service location must be active.`);
      revision.template.locationSnapshot = cleanLocationSnapshot(location);
    }
  }
  return errors;
}

export function sanitizeRecurringSeriesRecord(value, {
  clients = [],
  users = [],
  validateReferences = false,
  requireActiveReferences = true
} = {}) {
  const errors = [];
  const series = {
    id: String(value?.id || "").trim(),
    agency: String(value?.agency || "").trim(),
    clientId: String(value?.clientId || "").trim(),
    startDate: String(value?.startDate || "").trim(),
    endDate: String(value?.endDate || "").trim(),
    timeZone: String(value?.timeZone || "").trim(),
    status: String(value?.status || "").trim(),
    revisions: [],
    createdAt: String(value?.createdAt || "").trim(),
    createdBy: String(value?.createdBy || "").trim(),
    updatedAt: String(value?.updatedAt || "").trim(),
    updatedBy: String(value?.updatedBy || "").trim(),
    version: Number(value?.version)
  };
  if (!series.id) errors.push("Series id is required.");
  if (!series.agency) errors.push("Series agency is required.");
  if (!series.clientId) errors.push("Series clientId is required.");
  if (!isValidDateOnly(series.startDate)) errors.push("Series startDate must be a valid YYYY-MM-DD date.");
  if (!isValidDateOnly(series.endDate)) errors.push("Series endDate must be a valid YYYY-MM-DD date.");
  if (isValidDateOnly(series.startDate) && isValidDateOnly(series.endDate) && series.endDate < series.startDate) {
    errors.push("Series endDate must be on or after startDate.");
  }
  if (!isValidIanaTimeZone(series.timeZone)) errors.push("Series timeZone must be a valid IANA timezone.");
  if (!SERIES_STATUSES.has(series.status)) errors.push("Series status must be active or ended.");
  if (!Number.isInteger(series.version) || series.version < INITIAL_RECURRING_SERIES_VERSION) {
    errors.push("Series version must be a positive integer.");
  }
  for (const field of ["createdAt", "updatedAt"]) {
    if (!isValidTimestamp(series[field])) errors.push(`Series ${field} must be a valid timestamp.`);
  }
  for (const field of ["createdBy", "updatedBy"]) if (!series[field]) errors.push(`Series ${field} is required.`);
  // Future mutation APIs must compare their expectedVersion with this value before changing a series.
  if (!Array.isArray(value?.revisions) || !value.revisions.length) {
    errors.push("Series requires at least one revision.");
  } else {
    series.revisions = value.revisions.map((revision, index) => {
      const templateResult = sanitizeTemplate(revision?.template, index);
      errors.push(...templateResult.errors);
      const sanitized = {
        id: String(revision?.id || "").trim(),
        effectiveStartDate: String(revision?.effectiveStartDate || "").trim(),
        effectiveEndDate: String(revision?.effectiveEndDate || "").trim(),
        template: templateResult.template,
        createdAt: String(revision?.createdAt || "").trim(),
        createdBy: String(revision?.createdBy || "").trim()
      };
      if (!sanitized.id) errors.push(`Revision ${index + 1} id is required.`);
      if (!isValidDateOnly(sanitized.effectiveStartDate)) errors.push(`Revision ${index + 1} effectiveStartDate is invalid.`);
      if (!isValidDateOnly(sanitized.effectiveEndDate)) errors.push(`Revision ${index + 1} effectiveEndDate is invalid.`);
      if (isValidDateOnly(sanitized.effectiveStartDate) && isValidDateOnly(sanitized.effectiveEndDate)
        && sanitized.effectiveEndDate < sanitized.effectiveStartDate) {
        errors.push(`Revision ${index + 1} effectiveEndDate must be on or after effectiveStartDate.`);
      }
      if (isValidDateOnly(sanitized.effectiveStartDate)
        && isValidDateOnly(series.startDate)
        && sanitized.effectiveStartDate < series.startDate) {
        errors.push(`Revision ${index + 1} starts before the series.`);
      }
      if (isValidDateOnly(sanitized.effectiveEndDate)
        && isValidDateOnly(series.endDate)
        && sanitized.effectiveEndDate > series.endDate) {
        errors.push(`Revision ${index + 1} ends after the series.`);
      }
      if (!isValidTimestamp(sanitized.createdAt)) errors.push(`Revision ${index + 1} createdAt must be a valid timestamp.`);
      if (!sanitized.createdBy) errors.push(`Revision ${index + 1} createdBy is required.`);
      return sanitized;
    });
    const ids = series.revisions.map((revision) => revision.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push("Revision IDs must be unique.");
    const sorted = [...series.revisions].sort((a, b) => a.effectiveStartDate.localeCompare(b.effectiveStartDate));
    if (isValidDateOnly(series.startDate) && sorted[0]?.effectiveStartDate !== series.startDate) {
      errors.push("The first series revision must begin on the series startDate.");
    }
    if (isValidDateOnly(series.endDate) && sorted.at(-1)?.effectiveEndDate !== series.endDate) {
      errors.push("The final series revision must end on the series endDate.");
    }
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].effectiveStartDate <= sorted[index - 1].effectiveEndDate) {
        errors.push("Series revisions must not overlap.");
      } else if (isValidDateOnly(sorted[index - 1].effectiveEndDate)
        && sorted[index].effectiveStartDate !== nextDate(sorted[index - 1].effectiveEndDate)) {
        errors.push("Series revisions must form a continuous effective-date timeline.");
      }
    }
  }
  if (validateReferences) errors.push(...referenceErrors(series, { clients, users, requireActiveReferences }));
  return { series, errors: [...new Set(errors)] };
}

export function sanitizeRecurrenceAppointmentIdentity(value = {}) {
  const errors = [];
  const identity = {
    recurrenceSeriesId: String(value.recurrenceSeriesId || "").trim(),
    recurrenceRevisionId: String(value.recurrenceRevisionId || "").trim(),
    recurrenceRowId: String(value.recurrenceRowId || "").trim(),
    recurrenceOccurrenceId: String(value.recurrenceOccurrenceId || "").trim(),
    originalOccurrenceLocalDate: String(value.originalOccurrenceLocalDate || "").trim(),
    originalOccurrenceStartAt: String(value.originalOccurrenceStartAt || "").trim(),
    generationKind: String(value.generationKind || "").trim(),
    recurrenceException: value.recurrenceException ?? null,
    lastSeriesOperationId: String(value.lastSeriesOperationId || "").trim()
  };
  const hasRecurrenceIdentity = Boolean(
    identity.recurrenceSeriesId
    || identity.recurrenceRevisionId
    || identity.recurrenceRowId
    || identity.recurrenceOccurrenceId
    || identity.originalOccurrenceLocalDate
    || identity.originalOccurrenceStartAt
    || identity.generationKind
    || identity.recurrenceException
    || identity.lastSeriesOperationId
  );
  if (!hasRecurrenceIdentity) return { identity, errors: [] };
  for (const field of ["recurrenceSeriesId", "recurrenceRevisionId", "recurrenceRowId", "recurrenceOccurrenceId"]) {
    if (!identity[field]) errors.push(`${field} is required for a recurring occurrence.`);
  }
  if (!isValidDateOnly(identity.originalOccurrenceLocalDate)) {
    errors.push("originalOccurrenceLocalDate must be a valid YYYY-MM-DD date.");
  }
  if (!Number.isFinite(Date.parse(identity.originalOccurrenceStartAt))) {
    errors.push("originalOccurrenceStartAt must be a valid timestamp.");
  }
  if (!GENERATION_KINDS.has(identity.generationKind) || !identity.generationKind) {
    errors.push("generationKind must be generated or manually_added for a recurring occurrence.");
  }
  if (identity.recurrenceException !== null) {
    const type = String(identity.recurrenceException?.type || "").trim();
    if (!EXCEPTION_TYPES.has(type)) errors.push("recurrenceException type is not supported.");
    identity.recurrenceException = {
      type,
      baseRevisionId: String(identity.recurrenceException?.baseRevisionId || "").trim(),
      operationId: String(identity.recurrenceException?.operationId || "").trim(),
      createdAt: String(identity.recurrenceException?.createdAt || "").trim(),
      createdBy: String(identity.recurrenceException?.createdBy || "").trim()
    };
  }
  return { identity, errors: [...new Set(errors)] };
}
