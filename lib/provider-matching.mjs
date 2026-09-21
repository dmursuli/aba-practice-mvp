import {
  applicableProviderAvailabilityProfile,
  appointmentFitsAvailability,
  appointmentIntervalsOverlap,
  appointmentStatusBlocksScheduling
} from "./scheduling-conflicts.mjs";
import { activeProvidersEligibleForService } from "./scheduling-provider-eligibility.mjs";
import { SERVICE_ZONE_SET } from "./service-zones.mjs";

export const PROVIDER_MATCH_GROUPS = [
  { key: "best_match", label: "Best match" },
  { key: "good_match", label: "Good matches" },
  { key: "other_options", label: "Other options" },
  { key: "unavailable_or_conflicted", label: "Unavailable / conflicted" }
];

function zoneClassification(providerUserId, serviceZone, providerZoneProfiles) {
  if (!SERVICE_ZONE_SET.has(serviceZone)) {
    return {
      status: "service_zone_not_current",
      label: "Service location does not have a current operational zone"
    };
  }
  const profile = (providerZoneProfiles || []).find((item) => (
    item.providerUserId === providerUserId && item.active === true
  ));
  if (!profile) return { status: "not_configured", label: "Zone not configured" };
  if (profile.primaryZone === serviceZone) {
    return { status: "primary", label: "Primary zone match" };
  }
  if ((profile.acceptableZones || []).includes(serviceZone)) {
    return { status: "acceptable", label: "Acceptable zone match" };
  }
  return { status: "outside", label: "Outside preferred zones" };
}

function availabilityClassification(providerUserId, proposedAppointment, providerAvailabilityProfiles) {
  const profile = applicableProviderAvailabilityProfile({
    appointment: proposedAppointment,
    providerUserId,
    providerAvailabilityProfiles
  });
  if (!profile) {
    return { status: "not_configured", label: "Availability not configured" };
  }
  return appointmentFitsAvailability(proposedAppointment, profile)
    ? { status: "available", label: "Available" }
    : { status: "outside", label: "Outside availability" };
}

function formatTimeRange(appointment, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  });
  return `${formatter.format(new Date(appointment.scheduledStartAt))}–${formatter.format(new Date(appointment.scheduledEndAt))}`;
}

function conflictClassification(providerUserId, proposedAppointment, appointments, timeZone) {
  const conflicts = (appointments || [])
    .filter((appointment) => (
      appointmentStatusBlocksScheduling(appointment.status)
      && (appointment.providerAssignments || []).some((assignment) => assignment.userId === providerUserId)
      && appointmentIntervalsOverlap(proposedAppointment, appointment)
    ))
    .sort((left, right) => (
      String(left.scheduledStartAt || "").localeCompare(String(right.scheduledStartAt || ""))
      || String(left.scheduledEndAt || "").localeCompare(String(right.scheduledEndAt || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    ));
  if (!conflicts.length) return { status: "none", label: "No scheduling conflict", conflictingTimes: [] };
  const conflictingTimes = [...new Set(conflicts.map((appointment) => formatTimeRange(appointment, timeZone)))];
  return {
    status: "conflict",
    label: `Conflict: ${conflictingTimes[0]}`,
    conflictingTimes
  };
}

function caseAssignmentClassification(provider, clientId, clientUserAssignments) {
  if (provider.role !== "rbt") return null;
  const assigned = (clientUserAssignments || []).some((assignment) => (
    assignment.clientId === clientId && assignment.userId === provider.id
  ));
  return assigned
    ? { status: "assigned", label: "Already assigned to this client" }
    : { status: "not_assigned", label: "Not assigned" };
}

function groupForCandidate(candidate) {
  if (candidate.availability.status === "outside" || candidate.schedule.status === "conflict") {
    return "unavailable_or_conflicted";
  }
  if (candidate.availability.status === "available" && candidate.schedule.status === "none") {
    if (candidate.zone.status === "primary") return "best_match";
    if (candidate.zone.status === "acceptable") return "good_match";
  }
  return "other_options";
}

function compareCandidates(left, right) {
  return String(left.provider.name || "").localeCompare(String(right.provider.name || ""), "en", { sensitivity: "base" })
    || String(left.provider.userId || "").localeCompare(String(right.provider.userId || ""));
}

export function evaluateProviderMatches({
  users = [],
  appointments = [],
  providerAvailabilityProfiles = [],
  providerZoneProfiles = [],
  clientUserAssignments = [],
  clientId = "",
  serviceCode,
  serviceZone,
  scheduledStartAt,
  scheduledEndAt,
  timeZone
} = {}) {
  const proposedAppointment = {
    status: "scheduled",
    scheduledStartAt,
    scheduledEndAt,
    timeZone
  };
  const candidates = activeProvidersEligibleForService(users, serviceCode).map((provider) => {
    const candidate = {
      provider: {
        userId: provider.id,
        name: String(provider.name || "").trim(),
        role: provider.role
      },
      zone: zoneClassification(provider.id, serviceZone, providerZoneProfiles),
      availability: availabilityClassification(provider.id, proposedAppointment, providerAvailabilityProfiles),
      schedule: conflictClassification(provider.id, proposedAppointment, appointments, timeZone),
      caseAssignment: caseAssignmentClassification(provider, clientId, clientUserAssignments)
    };
    return { ...candidate, group: groupForCandidate(candidate) };
  });

  return {
    serviceZoneCurrent: SERVICE_ZONE_SET.has(serviceZone),
    groups: PROVIDER_MATCH_GROUPS.map((group) => ({
      ...group,
      candidates: candidates.filter((candidate) => candidate.group === group.key).sort(compareCandidates)
    }))
  };
}
