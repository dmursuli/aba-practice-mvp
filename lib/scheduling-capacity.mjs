import { PROVIDER_AVAILABILITY_WEEKDAYS, isValidAvailabilityDate } from "./provider-availability.mjs";
import { serviceCodesEligibleForProviderRole } from "./scheduling-provider-eligibility.mjs";

const BLOCKING_APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed"]);
const MAX_CAPACITY_RANGE_DAYS = 28;

function utcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addUtcDays(value, days) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDateValues(startDate, endDate) {
  const values = [];
  for (let value = startDate; value <= endDate; value = addUtcDays(value, 1)) values.push(value);
  return values;
}

function roundHours(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function appointmentLocalDate(appointment) {
  const instant = new Date(appointment?.scheduledStartAt || "");
  if (Number.isNaN(instant.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: String(appointment?.timeZone || "America/New_York"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return "";
  }
}

function appointmentHours(appointment) {
  const start = Date.parse(appointment?.scheduledStartAt || "");
  const end = Date.parse(appointment?.scheduledEndAt || "");
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 3_600_000 : 0;
}

function appointmentProviderIds(appointment) {
  return new Set((appointment?.providerAssignments || [])
    .map((assignment) => String(assignment?.userId || ""))
    .filter(Boolean));
}

function blockMinutes(block) {
  const [startHour, startMinute] = String(block?.start || "").split(":").map(Number);
  const [endHour, endMinute] = String(block?.end || "").split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  return Math.max(0, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
}

function availabilityHours(profile, dateValues) {
  if (!profile?.active) return null;
  const minutes = dateValues.reduce((total, dateValue) => {
    if (dateValue < profile.effectiveDate) return total;
    const day = PROVIDER_AVAILABILITY_WEEKDAYS[utcDate(dateValue).getUTCDay() === 0
      ? 6
      : utcDate(dateValue).getUTCDay() - 1];
    return total + (profile.weeklyAvailability?.[day] || []).reduce((sum, block) => sum + blockMinutes(block), 0);
  }, 0);
  return roundHours(minutes / 60);
}

function activeServiceLocation(client) {
  const profileLocations = Array.isArray(client?.profile?.serviceLocations) ? client.profile.serviceLocations : [];
  const legacyLocations = Array.isArray(client?.serviceLocations) ? client.serviceLocations : [];
  const locations = (profileLocations.length ? profileLocations : legacyLocations)
    .filter((location) => location?.isActive !== false);
  return locations.find((location) => location?.isPrimary) || locations[0] || null;
}

export function validateSchedulingCapacityRange(startDate, endDate) {
  const errors = [];
  if (!isValidAvailabilityDate(startDate)) errors.push("start must be a valid YYYY-MM-DD date.");
  if (!isValidAvailabilityDate(endDate)) errors.push("end must be a valid YYYY-MM-DD date.");
  if (errors.length) return errors;
  if (endDate < startDate) errors.push("end must be on or after start.");
  const dayCount = Math.round((utcDate(endDate) - utcDate(startDate)) / 86_400_000) + 1;
  if (dayCount > MAX_CAPACITY_RANGE_DAYS) errors.push(`Capacity reporting ranges may include at most ${MAX_CAPACITY_RANGE_DAYS} days.`);
  return errors;
}

export function calculateSchedulingCapacity({
  users = [],
  clients = [],
  appointments = [],
  providerAvailabilityProfiles = [],
  providerZoneProfiles = [],
  clientUserAssignments = [],
  startDate,
  endDate
} = {}) {
  const rangeErrors = validateSchedulingCapacityRange(startDate, endDate);
  if (rangeErrors.length) throw new RangeError(rangeErrors.join(" "));

  const dateValues = inclusiveDateValues(startDate, endDate);
  const activeClients = clients.filter((client) => client?.status !== "archived");
  const activeClientIds = new Set(activeClients.map((client) => client.id));
  const activeUsers = users.filter((user) => user?.active !== false);
  const activeUserById = new Map(activeUsers.map((user) => [user.id, user]));
  const qualifyingAppointments = appointments.filter((appointment) => {
    const localDate = appointmentLocalDate(appointment);
    return BLOCKING_APPOINTMENT_STATUSES.has(appointment?.status)
      && localDate >= startDate
      && localDate <= endDate;
  });

  const providerCapacity = activeUsers
    .filter((user) => serviceCodesEligibleForProviderRole(user.role).length > 0)
    .map((provider) => {
      const providerAppointments = qualifyingAppointments.filter((appointment) => appointmentProviderIds(appointment).has(provider.id));
      const scheduledHours = roundHours(providerAppointments
        .filter((appointment) => appointment.status === "scheduled")
        .reduce((total, appointment) => total + appointmentHours(appointment), 0));
      const confirmedHours = roundHours(providerAppointments
        .filter((appointment) => appointment.status === "confirmed")
        .reduce((total, appointment) => total + appointmentHours(appointment), 0));
      const totalBlockingHours = roundHours(scheduledHours + confirmedHours);
      const availabilityProfile = providerAvailabilityProfiles.find((profile) => (
        profile?.providerUserId === provider.id && profile?.active === true
      )) || null;
      const availableHours = availabilityHours(availabilityProfile, dateValues);
      const remainingHours = availableHours === null ? null : roundHours(Math.max(availableHours - totalBlockingHours, 0));
      const utilizationPercent = availableHours > 0
        ? Math.round((totalBlockingHours / availableHours) * 100)
        : null;
      const zoneProfile = providerZoneProfiles.find((profile) => (
        profile?.providerUserId === provider.id && profile?.active === true
      )) || null;
      const assignedClientIds = new Set(clientUserAssignments
        .filter((assignment) => assignment?.active !== false && assignment?.userId === provider.id && activeClientIds.has(assignment?.clientId))
        .map((assignment) => assignment.clientId));
      return {
        provider: { userId: provider.id, name: provider.name, role: provider.role },
        scheduledHours,
        confirmedHours,
        totalBlockingHours,
        availabilityConfigured: Boolean(availabilityProfile),
        availability: availabilityProfile ? {
          availableHours,
          remainingHours,
          utilizationPercent,
          effectiveDate: availabilityProfile.effectiveDate,
          timezone: availabilityProfile.timezone
        } : null,
        assignedClientCount: String(provider.role || "").toLowerCase() === "rbt" ? assignedClientIds.size : null,
        zone: zoneProfile ? {
          primaryZone: zoneProfile.primaryZone,
          acceptableZones: [...(zoneProfile.acceptableZones || [])]
        } : null
      };
    })
    .sort((left, right) => (
      String(left.provider.name || "").localeCompare(String(right.provider.name || ""))
      || String(left.provider.userId || "").localeCompare(String(right.provider.userId || ""))
    ));

  const clientCoverage = activeClients
    .map((client) => {
      const assignedRbtIds = new Set(clientUserAssignments
        .filter((assignment) => assignment?.active !== false && assignment?.clientId === client.id)
        .map((assignment) => activeUserById.get(assignment.userId))
        .filter((user) => String(user?.role || "").toLowerCase() === "rbt")
        .map((user) => user.id));
      const scheduled97153Hours = roundHours(qualifyingAppointments
        .filter((appointment) => appointment.clientId === client.id && appointment.serviceCode === "97153")
        .reduce((total, appointment) => total + appointmentHours(appointment), 0));
      const serviceLocation = activeServiceLocation(client);
      const coverageStatus = assignedRbtIds.size === 0
        ? "no_rbt_assigned"
        : scheduled97153Hours === 0 ? "assigned_no_97153_scheduled" : "scheduled";
      return {
        client: { clientId: client.id, name: client.name },
        activeRbtAssignmentCount: assignedRbtIds.size,
        multipleRbtsAssigned: assignedRbtIds.size > 1,
        scheduled97153Hours,
        serviceLocationZone: String(serviceLocation?.zone || ""),
        coverageStatus
      };
    })
    .sort((left, right) => (
      String(left.client.name || "").localeCompare(String(right.client.name || ""))
      || String(left.client.clientId || "").localeCompare(String(right.client.clientId || ""))
    ));

  return {
    range: { start: startDate, end: endDate, dayCount: dateValues.length },
    summary: {
      activeProviderCount: providerCapacity.length,
      providersWithRemainingCapacity: providerCapacity.filter((item) => item.availability?.remainingHours > 0).length,
      providersWithoutAvailability: providerCapacity.filter((item) => !item.availabilityConfigured).length,
      activeClientCount: clientCoverage.length,
      clientsWithoutAssignedRbts: clientCoverage.filter((item) => item.coverageStatus === "no_rbt_assigned").length,
      clientsAssignedWithout97153: clientCoverage.filter((item) => item.coverageStatus === "assigned_no_97153_scheduled").length
    },
    providerCapacity,
    clientCoverage
  };
}
