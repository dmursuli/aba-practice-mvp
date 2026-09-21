const BLOCKING_APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed"]);
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function appointmentStatusBlocksScheduling(status) {
  return BLOCKING_APPOINTMENT_STATUSES.has(String(status || ""));
}

export function appointmentIntervalsOverlap(left, right) {
  const leftStart = Date.parse(left?.scheduledStartAt);
  const leftEnd = Date.parse(left?.scheduledEndAt);
  const rightStart = Date.parse(right?.scheduledStartAt);
  const rightEnd = Date.parse(right?.scheduledEndAt);
  return [leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)
    && leftStart < rightEnd
    && leftEnd > rightStart;
}

function providerIds(appointment) {
  return [...new Set((appointment?.providerAssignments || [])
    .map((assignment) => String(assignment?.userId || "").trim())
    .filter(Boolean))];
}

function providerName(users, providerUserId) {
  const provider = (users || []).find((user) => user.id === providerUserId);
  return String(provider?.name || "Selected provider").trim();
}

export function schedulingLocalDateTimeParts(timestamp, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long"
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      time: `${values.hour}:${values.minute}`,
      weekday: String(values.weekday || "").toLowerCase()
    };
  } catch {
    return null;
  }
}

function displayDateTimeRange(appointment, timeZone) {
  try {
    const start = new Date(appointment.scheduledStartAt);
    const end = new Date(appointment.scheduledEndAt);
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(start);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit"
    });
    return `${formatter.format(start)} to ${formatter.format(end)} on ${date}`;
  } catch {
    return "the requested date and time";
  }
}

function overlapError(proposed, existing, providerUserId, users) {
  const timeZone = String(proposed.timeZone || existing.timeZone || "America/New_York");
  return `${providerName(users, providerUserId)} is already scheduled from ${displayDateTimeRange(existing, timeZone)}.`;
}

function availabilityError(appointment, providerUserId, users, timeZone) {
  return `This appointment falls outside ${providerName(users, providerUserId)}’s configured availability (${displayDateTimeRange(appointment, timeZone)}).`;
}

function missingAvailabilityWarning(appointment, providerUserId, users) {
  let occurrenceLocalDate = "";
  try {
    occurrenceLocalDate = schedulingLocalDateTimeParts(
      appointment.scheduledStartAt,
      appointment.timeZone || "America/New_York"
    )?.date || "";
  } catch {}
  return {
    type: "provider_availability_missing",
    message: "Availability has not been configured for this provider.",
    providerName: providerName(users, providerUserId),
    occurrenceLocalDate
  };
}

export function appointmentFitsAvailability(appointment, profile) {
  const timeZone = String(profile.timezone || appointment.timeZone || "America/New_York");
  const start = schedulingLocalDateTimeParts(appointment.scheduledStartAt, timeZone);
  const end = schedulingLocalDateTimeParts(appointment.scheduledEndAt, timeZone);
  if (!start || !end || start.date !== end.date || !WEEKDAYS.includes(start.weekday)) return false;
  const blocks = Array.isArray(profile.weeklyAvailability?.[start.weekday])
    ? profile.weeklyAvailability[start.weekday]
    : [];
  return blocks.some((block) => (
    String(block?.start || "") <= start.time
    && String(block?.end || "") >= end.time
  ));
}

export function applicableProviderAvailabilityProfile({
  appointment,
  providerUserId,
  providerAvailabilityProfiles = []
} = {}) {
  const profile = providerAvailabilityProfiles.find((item) => (
    item.providerUserId === providerUserId && item.active === true
  ));
  if (!profile) return null;
  const appointmentDate = schedulingLocalDateTimeParts(
    appointment?.scheduledStartAt,
    profile.timezone
  )?.date || "";
  return appointmentDate && appointmentDate >= String(profile.effectiveDate || "") ? profile : null;
}

export function validateProviderScheduling({
  appointments = [],
  proposedAppointments = [],
  providerAvailabilityProfiles = [],
  users = [],
  excludedAppointmentIds = []
} = {}) {
  const errors = [];
  const warnings = [];
  const excluded = new Set(excludedAppointmentIds);
  const proposed = proposedAppointments.filter((appointment) => appointmentStatusBlocksScheduling(appointment.status));
  const existing = appointments.filter((appointment) => (
    appointmentStatusBlocksScheduling(appointment.status)
    && !excluded.has(appointment.id)
    && !proposed.some((candidate) => candidate.id === appointment.id)
  ));

  const checkOverlap = (candidate, other) => {
    if (!appointmentIntervalsOverlap(candidate, other)) return;
    const otherProviders = new Set(providerIds(other));
    providerIds(candidate).forEach((providerUserId) => {
      if (otherProviders.has(providerUserId)) {
        errors.push(overlapError(candidate, other, providerUserId, users));
      }
    });
  };

  proposed.forEach((candidate) => existing.forEach((other) => checkOverlap(candidate, other)));
  for (let left = 0; left < proposed.length; left += 1) {
    for (let right = left + 1; right < proposed.length; right += 1) {
      checkOverlap(proposed[left], proposed[right]);
    }
  }

  proposed.forEach((appointment) => {
    providerIds(appointment).forEach((providerUserId) => {
      const profile = applicableProviderAvailabilityProfile({
        appointment,
        providerUserId,
        providerAvailabilityProfiles
      });
      if (!profile) {
        warnings.push(missingAvailabilityWarning(appointment, providerUserId, users));
        return;
      }
      if (!appointmentFitsAvailability(appointment, profile)) {
        errors.push(availabilityError(appointment, providerUserId, users, profile.timezone));
      }
    });
  });

  const uniqueWarnings = [];
  const seenWarnings = new Set();
  warnings.forEach((warning) => {
    const key = `${warning.type}|${warning.message}|${warning.providerName}|${warning.occurrenceLocalDate}`;
    if (seenWarnings.has(key)) return;
    seenWarnings.add(key);
    uniqueWarnings.push(warning);
  });
  return { errors: [...new Set(errors)], warnings: uniqueWarnings };
}
