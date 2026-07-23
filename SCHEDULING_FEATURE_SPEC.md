# Scheduling Feature Specification

## Purpose

The scheduling module will connect clients, authorizations, approved service quantities, appointments, clinical sessions, SOAP notes, billing-readiness reporting, and future payroll/productivity reporting.

Scheduling is an operational layer. It must not replace or weaken existing clinical-documentation workflows.

## Initial Scope

The module will support:

- Weekly agency calendar
- Individual appointment creation, editing, confirmation, and cancellation
- Recurring appointments
- Staff availability
- PTO, holidays, and unavailable time
- Client and provider conflict detection
- Client and therapist schedule views
- Explicit appointment-to-session linkage
- Authorization utilization warnings
- Travel and geographic scheduling data
- Internal payroll and productivity reporting

Each capability will be introduced in a separate deployable phase.

## Core Entities

### Appointment

An appointment represents planned service time.

Required fields:

- `id`
- `agency`
- `clientId`
- `serviceCode`
- `providerAssignments`
- `scheduledStartAt`
- `scheduledEndAt`
- `timeZone`
- `status`
- `settingType`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`
- `version`

Optional fields:

- `locationId`
- `locationSnapshot`
- `authorizationRef`
- `recurrenceSeriesId`
- `originalOccurrenceStartAt`
- `sessionId`
- `linkedAt`
- `linkedBy`
- `cancellation`
- `notes`
- `replacesAppointmentId`
- `replacedByAppointmentId`

### Recurrence Series

A recurrence series stores the reusable rule and series metadata. Individual occurrences must still receive stable appointment IDs so one occurrence can be edited or cancelled without rewriting unrelated occurrences.

### Staff Profile

A staff profile extends an existing application user with scheduling-specific data. It must reference the existing user by immutable `userId`.

Potential fields include:

- Credential type
- Scheduling role
- Active scheduling status
- Default work location
- Caseload limits
- Travel preferences
- Employment classification
- Effective dates

Payroll rates and HR records are outside the scheduling scope.

### Availability Rule

A recurring statement of when a staff member is normally available.

### Unavailable Time

A dated exception such as PTO, holiday, training, meeting, or other blocked time.

### Location

A reusable structured service location, including label, setting type, address, timezone, and optional coordinates.

### Authorization

The existing client authorization is initially read through a compatibility adapter. A future authorization entity should support multiple authorization periods and multiple service-code allocations per client.

## User Roles

### Admin

- View all appointments within permitted agency scope
- Create, edit, confirm, cancel, and link appointments
- Manage availability, unavailable time, and scheduling configuration
- View conflict and authorization warnings
- View operational reports

### BCBA

- View agency/client schedules within existing agency scope
- Create and edit clinically relevant appointments
- Schedule 97155 and 97156 services
- Review authorization warnings
- Link appointments to appropriate clinical documentation when authorized

### RBT

Initially excluded from the scheduling view because current sessions do not reliably map providers to user IDs.

After provider-user linkage exists:

- View own schedule
- View only the minimum client information required for assigned appointments
- Start a permitted session from an assigned appointment
- Mark operational status where authorized
- Cannot manage other providers' schedules

### Read-only

No scheduling access by default. Scheduling access should require a separate explicit permission if later needed.

### Scheduler role

A dedicated scheduler role may be added later if the agency needs non-clinical scheduling access. It must have a least-privilege permission matrix and should not automatically receive SOAP, treatment-plan, or broad clinical-note access.

## Required Views

- Agency weekly calendar
- Daily agenda
- Appointment create/edit form
- Client schedule
- Therapist schedule
- Unscheduled/conflict review
- Availability editor
- PTO and unavailable-time view
- Authorization utilization summary
- Travel/location review
- Productivity report

The weekly calendar is the first view. Drag-and-drop interaction is not included.

## Appointment Status Values

- `scheduled`
- `confirmed`
- `completed`
- `cancelled`
- `no_show`

`rescheduled` is not a persistent status. A reschedule cancels the original appointment and creates or links a replacement appointment.

Cancellation reason codes:

- `client_cancelled`
- `provider_cancelled`
- `authorization_issue`
- `illness`
- `weather`
- `agency_cancelled`
- `other`

SOAP status, billing readiness, payroll status, authorization warnings, and conflict warnings are separate concerns and must not be stored in the appointment status field.

## Validation Requirements

Every appointment mutation must validate:

- Authenticated user and permitted role
- Agency scope
- Existing active client
- Existing active provider user
- Provider role compatibility with service code
- Canonical supported service code
- Valid timezone
- Valid start and end timestamps
- End strictly after start
- No cross-midnight appointment unless explicitly supported
- Authorization date-range status
- Required setting and location information
- Recurrence limits
- Conflict results
- Optimistic version match on update
- Immutable appointment ID
- Immutable linked session ID except through the explicit link workflow

Dates and times must not be compared as locale-formatted strings. Conflict calculations must use timezone-aware instants.

## Session and SOAP Linkage Rules

- Appointments and sessions remain separate records.
- Existing sessions without appointments remain valid.
- An appointment may have zero or one primary linked clinical record.
- A session created from an appointment receives `appointmentId`.
- The appointment receives the created session's `sessionId`.
- Link creation must be idempotent.
- A session cannot be automatically linked by therapist name.
- Historical linkage requires explicit user confirmation.
- Appointment changes never update an existing session.
- Session changes never silently rewrite scheduled appointment time.
- Differences between scheduled and delivered time are reported as discrepancies.
- Appointment cancellation never deletes a session or note.
- Session deletion does not automatically delete an appointment.
- Finalized and amended SOAP notes remain controlled solely by the existing SOAP workflow.
- A 97155 appointment may link to a 97155 note-history record, but the repaired 97155 `sessionId` remains untouched.
- Scheduling IDs must never replace `planChangeLog.sessionId`.
- Scheduling must not rewrite `planChangeLog`, note histories, finalized snapshots, or amendments.

## Authorization Rules

The module must distinguish:

- Approved quantity
- Scheduled quantity
- Delivered quantity
- Finalized or billing-ready quantity
- Remaining quantity

Rules:

- Scheduled time is not delivered utilization.
- Cancelled and no-show appointments do not consume delivered units.
- Completed appointment status alone does not prove service delivery.
- Delivered utilization comes from linked clinical records.
- Authorization calculations use appointments or sessions whose service dates fall within the authorization period.
- Appointment creation outside the authorization period produces a blocking validation or explicit authorized override.
- Approaching approved limits produces warnings.
- Exceeding approved limits requires an explicit override permission and audit reason if the agency chooses to allow it.
- Hours and units must be parsed defensively because current authorization values are stored as strings.
- Unit conversion must be defined per service code. Existing 15-minute billing behavior must not be silently generalized to every future code.
- Legacy session `serviceType: "parent-training"` maps to canonical service code `97156`.

## Conflict Detection

Conflict checks must detect:

- Provider overlap
- Client overlap
- Provider unavailable time
- Provider outside normal availability
- Agency holiday or closure
- Inactive client or provider
- Missing or expired authorization
- Unsupported provider/service-code combination
- Location capacity conflict when capacity exists
- Recurring-series occurrence conflicts

Intervals use half-open semantics: `[start, end)`. An appointment ending at 10:00 does not conflict with one beginning at 10:00.

Cancelled appointments are excluded from overlap checks. No-show and completed appointments remain historical facts.

Conflict responses must identify the conflicting appointment IDs and reasons without exposing unauthorized client information.

Travel-time conflicts and geographic feasibility are added in the travel phase, not the first conflict phase.

## Audit Requirements

Audit events are required for:

- Appointment creation
- Appointment edit
- Confirmation
- Cancellation
- Rescheduling
- Recurrence creation or edit
- Availability changes
- Unavailable-time changes
- Conflict override
- Authorization override
- Session linkage or unlinking

Audit entries should record IDs and operational changes while minimizing PHI in free text.

## Explicitly Deferred

- Google Calendar synchronization
- SMS reminders
- Route optimization
- Payroll exports
- Drag-and-drop scheduling
- Waitlists
- Open-shift boards
- Automatic billing
- Credentialing features
- Human-resources features
