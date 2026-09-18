export const PROVIDER_AVAILABILITY_WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
];

export const DEFAULT_PROVIDER_AVAILABILITY_TIMEZONE = "America/New_York";

export function isValidAvailabilityDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isValidAvailabilityTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidAvailabilityLocalTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

export function sanitizeWeeklyProviderAvailability(value) {
  const errors = [];
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("weeklyAvailability must be an object with Monday through Sunday arrays.");
  }
  const unknownDays = Object.keys(source).filter((day) => !PROVIDER_AVAILABILITY_WEEKDAYS.includes(day));
  if (unknownDays.length) errors.push(`Unsupported availability day: ${unknownDays[0]}.`);

  const weeklyAvailability = {};
  for (const day of PROVIDER_AVAILABILITY_WEEKDAYS) {
    const rawBlocks = source[day] ?? [];
    if (!Array.isArray(rawBlocks)) {
      errors.push(`${day} availability must be an array.`);
      weeklyAvailability[day] = [];
      continue;
    }
    const blocks = rawBlocks.map((block, index) => {
      const start = String(block?.start || "").trim();
      const end = String(block?.end || "").trim();
      if (!isValidAvailabilityLocalTime(start)) errors.push(`${day} block ${index + 1} requires a valid HH:MM start time.`);
      if (!isValidAvailabilityLocalTime(end)) errors.push(`${day} block ${index + 1} requires a valid HH:MM end time.`);
      if (isValidAvailabilityLocalTime(start) && isValidAvailabilityLocalTime(end) && start >= end) {
        errors.push(`${day} block ${index + 1} end time must be after start time; cross-midnight blocks are not supported.`);
      }
      return { start, end };
    }).sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));

    const seen = new Set();
    blocks.forEach((block) => {
      const key = `${block.start}-${block.end}`;
      if (seen.has(key)) errors.push(`${day} contains a duplicate availability block.`);
      seen.add(key);
    });
    for (let index = 1; index < blocks.length; index += 1) {
      if (blocks[index].start < blocks[index - 1].end) {
        errors.push(`${day} availability blocks must not overlap.`);
        break;
      }
    }
    weeklyAvailability[day] = blocks;
  }
  return { weeklyAvailability, errors: [...new Set(errors)] };
}

export function sanitizeProviderAvailabilityInput(value = {}) {
  const effectiveDate = String(value.effectiveDate || "").trim();
  const timezone = String(value.timezone || DEFAULT_PROVIDER_AVAILABILITY_TIMEZONE).trim();
  const weekly = sanitizeWeeklyProviderAvailability(value.weeklyAvailability);
  const errors = [...weekly.errors];
  if (!isValidAvailabilityDate(effectiveDate)) errors.push("effectiveDate must be a valid YYYY-MM-DD date.");
  if (!isValidAvailabilityTimeZone(timezone)) errors.push("timezone must be a valid IANA timezone.");
  return {
    availability: {
      effectiveDate,
      timezone,
      weeklyAvailability: weekly.weeklyAvailability
    },
    errors: [...new Set(errors)]
  };
}
