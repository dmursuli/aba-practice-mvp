# Scheduling Operations Workspace Feature Specification

## Purpose

Scheduling is an integrated Operations Workspace inside the existing Triumph Behavioral Care application. It coordinates operational intent from staffing readiness through planned service delivery without replacing the existing client, user, clinical, assessment, authorization, billing, authentication, persistence, or deployment domains.

The workspace connects:

- Staffing demand
- Client and RBT scheduling profiles
- Availability
- Zones
- Eligibility filtering
- Explainable matching
- RBT and BCBA assignment references
- Planned and recurring appointments
- Capacity
- Travel feasibility
- Authorization-versus-scheduled warnings
- Future explicit appointment-to-session linkage

Calendar is one subview of the workspace rather than the entire Scheduling feature.

## Product and Domain Boundaries

### Scheduling owns operational intent

Scheduling-owned data and calculations include:

- Staffing demand and operational staffing status
- Scheduling-specific client and RBT profiles
- Structured operational availability
- Zone assignments and relationships
- Administrator-reviewed match recommendations
- Operational RBT and BCBA assignment references
- Planned appointments and recurrence
- Scheduled-hours calculations
- Capacity supply, demand, gaps, and coverage
- Travel-buffer and geographic-feasibility warnings

### Existing clinical modules remain authoritative

Clinical modules continue to own:

- Sessions
- SOAP notes
- Draft, finalized, and amended clinical documentation
- 97155 `planChangeLog/sessionId` behavior
- Treatment plans
- Assessments and assessment content
- Delivered-service facts

Scheduling must not update, regenerate, copy, replace, or reinterpret these records.

### Billing remains authoritative

Billing owns claims, payment workflows, billing actions, and downstream financial status. Scheduling may display a permission-filtered billing-readiness indicator in a future phase but must not perform billing or store claims as scheduling records.

### Shared identity remains authoritative

- Existing clients are referenced by stable `clientId`.
- Existing users are referenced by stable `userId`.
- Existing agency scope is reused.
- Scheduling must not create duplicate client, staff, authentication, legal-identity, clinical-credential, or HR source records.
- Provider identity must never be inferred from free-text therapist names.

### Quantities remain distinct

The following quantities have different meanings and must never be collapsed into a single utilization value:

- Authorized or approved hours
- Scheduled hours
- Delivered hours
- Finalized or documented hours
- Billing-ready hours

Scheduled hours are derived from qualifying appointments. Delivered hours come from authoritative clinical records. Finalized and billing-ready hours come from their existing authoritative workflows.

## Workspace Navigation

Scheduling uses internal sub-navigation:

- Calendar
- Staffing
- Availability
- Zones
- Capacity

The existing read-only weekly calendar is the first functional subview. Before a subview's roadmap phase is implemented, it may show an intentional empty state describing its future purpose, but it must not contain premature business logic.

## Operating Model: Miami-Dade County

The initial operational geography is Miami-Dade County. Zones provide a practical agency-defined model for staffing, matching, capacity, and travel-buffer decisions.

Zones are configurable records, not hard-coded application constants. Initial zone records may be seeded as:

- West Kendall
- Kendall
- Doral
- Cutler Bay
- Homestead
- Miami Lakes
- Other / Manual Review

Each zone supports:

- Stable ID
- Agency scope
- Display name
- ZIP-code associations
- Adjacent-zone relationships
- Default same-zone travel buffer
- Default adjacent-zone travel buffer
- Active/inactive status
- Created and updated audit metadata

`Other / Manual Review` supports addresses or ZIP codes that are unmapped, ambiguous, outside the agency's normal operating area, or require an administrator decision.

A ZIP-code association is a default operational classification, not a replacement for a service address. Administrators may explicitly assign or override a client's primary zone. Zone changes affect future operational evaluation and must not rewrite historical appointment facts.

## Scheduling-Owned Domains and Core Entities

### Zone

A configurable agency geographic region used for staffing, matching, capacity, and travel-buffer rules.

### Zone ZIP Association

Associates one or more ZIP codes with a zone. Ambiguous or unmapped ZIP codes must resolve to manual review rather than silently selecting an unreliable zone.

### Zone Adjacency

Represents a symmetric operational relationship between two zones. Adjacency supports buffer evaluation; it is not route optimization or a guarantee that every address pair is feasible.

### Client Scheduling Profile

A scheduling-owned extension of an existing client. It references the authoritative client by immutable `clientId`.

Fields:

- `id`
- `agency`
- `clientId`
- `primaryZoneId`
- `serviceLocations`
- `preferredSetting`
- `weeklyAvailability`
- `weekendPermission`
- `languagePreference`
- `experienceRequirement`
- `transportationRestrictions`
- `caregiverRestrictions`
- `staffingStatus`
- `assignedBcbaUserId`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`
- `version`

The profile must not duplicate legal identity, core demographics, clinical diagnoses, assessment content, treatment-plan data, or authoritative authorization records.

### RBT Scheduling Profile

A scheduling-owned extension of an existing user. It references the authoritative user by immutable `userId`.

Fields:

- `id`
- `agency`
- `userId`
- `primaryZoneId`
- `secondaryZoneIds`
- `weeklyAvailability`
- `maximumWeeklyHours`
- `minimumDesiredHours`
- `travelRadiusOrPreference`
- `language`
- `experienceAreas`
- `ageGroupPreference`
- `serviceSettingPreference`
- `weekendAvailability`
- `transportationReliability`
- `supervisorUserId`
- `employmentSchedulingStatus`
- `createdAt`
- `createdBy`
- `updatedAt`
- `updatedBy`
- `version`

The profile must not duplicate authentication data, legal identity, authoritative credentials, employment classification, pay rates, performance records, or other HR source data.

### Weekly Availability

Structured recurring windows representing when a client or RBT can normally participate in services.

Each window includes:

- Day of week
- Local start time
- Local end time
- Timezone
- Effective start and optional end date
- Active/inactive status

Client availability and RBT availability are separate facts. An overlap means a candidate time may be possible; it does not establish an appointment.

### Staffing Queue Item

Represents the operational staffing state for an existing client in the initial version. A complete referral entity and benefits-verification system are deferred.

Statuses:

- `referral_received`
- `benefits_verified`
- `assessment_pending`
- `authorization_pending`
- `ready_for_staffing`
- `partial_staffing`
- `fully_staffed`
- `on_hold`
- `services_started`

The initial queue may start with existing clients only. Status labels may represent externally completed intake milestones but must not duplicate assessment content, benefits records, or clinical authorization source data.

### Staffing Demand

Represents the service coverage an administrator is trying to fill.

Potential attributes include:

- Client reference
- Canonical service code
- Required weekly hours
- Required availability windows
- Required language
- Required experience
- Required setting
- Zone restrictions
- Supervising BCBA restriction
- Effective dates
- Staffed hours
- Unstaffed hours

### Eligibility Evaluation

Evaluates hard constraints for an RBT and staffing demand. Eligibility must be determined before ranking.

Hard constraints:

- Inactive provider
- Agency mismatch
- Availability mismatch
- Payer or credential incompatibility
- Zone restriction
- Maximum-hours violation
- Schedule overlap
- Language requirement
- Required experience
- Supervision restriction

An ineligible candidate is not assigned a score and is excluded from ranked recommendations. The evaluation retains administrator-visible disqualifier reasons without exposing unauthorized client information.

### Match Recommendation

Decision support for administrators. Matching never creates an assignment automatically.

Only eligible RBTs are ranked. Configurable weighted factors may include:

- Same primary zone
- Schedule compatibility
- Travel burden
- Desired additional hours
- Same supervising BCBA
- Language match
- Relevant experience

Every recommendation must show:

- Candidate identity reference
- Eligibility result
- Ranking inputs
- Human-readable reasons
- Warnings
- Disqualifiers, when viewing excluded candidates
- Relevant capacity effect
- Evaluation timestamp or input version

A recommendation is advisory and may become stale when availability, hours, assignments, zones, or schedules change. An administrator must explicitly accept, reject, or defer it.

### Operational Assignment

Represents an administrator-approved scheduling relationship between an existing client and provider for an effective period. It references users and clients by stable IDs.

Operational assignments do not replace clinical care-team records or prove that services were delivered. BCBA and RBT references must remain explicit and role-compatible.

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
- `zoneId`
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

A recurrence series stores a bounded reusable rule and series metadata. Individual occurrences receive stable appointment IDs so one occurrence may be edited or cancelled without rewriting unrelated occurrences.

### Capacity Projection

A derived operational view, not an independently edited source record. Capacity compares supply and demand by:

- Zone
- Provider type
- Service code
- Time band

Measures include:

- Client hours needed
- RBT hours available
- Staffing gap
- Partially staffed hours
- Coverage percentage

Capacity must be derived from traceable profile, availability, staffing, and appointment sources. It must not be stored as an unexplained duplicate total.

## User Roles

### Admin

- Access all Scheduling subviews within permitted agency scope
- Configure zones
- Manage scheduling profiles and availability
- Manage staffing queue status and demand
- Review eligibility and matching explanations
- Approve or reject assignments
- Create, edit, confirm, cancel, and reschedule appointments
- Review capacity and operational warnings
- Perform explicitly permitted overrides with an audit reason

### BCBA

- View permitted client and agency schedules
- View relevant client staffing and scheduling information
- Schedule clinically relevant services when the relevant phase and permission are available
- Review authorization-versus-scheduled warnings
- Participate in explicit appointment-to-clinical-record linkage when authorized

### RBT

RBT scheduling access is deferred until reliable provider-to-user linkage and the mobile workflow are approved.

Future least-privilege access may include:

- View own assigned schedule
- View only minimum necessary client information
- Start a permitted session from an assigned appointment
- Record permitted operational status
- Never manage other providers' schedules or agency-wide staffing

### Scheduler

A dedicated scheduler role may be introduced with least-privilege access to zones, profiles, staffing, matching, appointments, and capacity. It must not automatically receive SOAP, treatment-plan, assessment-content, or broad clinical-note permissions.

### Read-only

No Scheduling access by default. Any future access requires explicit Scheduling permissions.

## Workspace Views

### Calendar

- Existing read-only weekly clinical-record calendar
- Future appointment overlays
- Future individual and recurring appointment management
- Future client and provider schedule views

Clinical records and planned appointments must remain visually and semantically distinct.

### Staffing

- Staffing queue
- Client staffing demand
- Eligibility results
- Explainable ranked matches
- Administrator match decisions
- Partial and full staffing state

### Availability

- Client weekly availability
- RBT weekly availability
- Weekend availability or permission
- Effective dates
- Future dated exceptions, PTO, holidays, and unavailable time

### Zones

- Configurable zone list
- ZIP-code associations
- Adjacent-zone relationships
- Travel-buffer defaults
- Active/inactive management
- Manual-review assignments

### Capacity

- Supply and demand by zone
- Provider type
- Service code
- Time band
- Coverage, partial coverage, and staffing gaps

## Appointment Status Values

- `scheduled`
- `confirmed`
- `completed`
- `cancelled`
- `no_show`

`rescheduled` is not a persistent status. Rescheduling cancels the original appointment and creates or links a replacement appointment.

Cancellation reason codes:

- `client_cancelled`
- `provider_cancelled`
- `authorization_issue`
- `illness`
- `weather`
- `agency_cancelled`
- `other`

SOAP status, billing readiness, authorization warnings, travel warnings, capacity warnings, and conflict warnings are separate concerns and must not be stored in appointment status.

## Validation Requirements

### Workspace and identity

- Every operation requires authentication, permitted role, and agency scope.
- Referenced clients and users must exist in the authoritative collections.
- Client scheduling profiles have one stable client reference within agency scope.
- RBT scheduling profiles have one stable user reference within agency scope.
- Scheduling profiles cannot become competing identity, clinical-credential, or HR records.

### Zones

- Zone names are unique within the agency's active configuration.
- ZIP codes use a canonical validated format.
- Adjacent-zone relationships cannot reference the same zone.
- Adjacency is treated symmetrically.
- Inactive zones cannot be newly assigned without an explicit corrective workflow.
- Unmapped or ambiguous geographic data must route to manual review.
- Zone configuration must remain agency-scoped and configurable.

### Availability and profiles

- Availability windows require a valid weekday, timezone, start time, end time, and effective range.
- End must be strictly after start.
- Unsupported overnight windows are rejected.
- Maximum weekly hours cannot be negative.
- Minimum desired hours cannot exceed maximum weekly hours without an explicit validation resolution.
- Zone, supervisor, client, and user references must be active and agency compatible.
- Structured fields must not be inferred from unrestricted notes.

### Staffing and matching

- Staffing status transitions require a valid existing-client reference in the initial version.
- An RBT must pass all hard constraints before ranking.
- Ineligible candidates receive disqualifiers but no score.
- Matching weights are configurable and agency-scoped.
- Recommendations expose reasons and warnings.
- No recommendation may create or publish an assignment automatically.
- Administrator decisions and overrides require actor, timestamp, and reason.
- Stale recommendations must be identified when material inputs change.

### Appointments

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
- Conflict and travel-buffer results
- Optimistic version match on update
- Immutable appointment ID
- Immutable linked session ID except through explicit linkage

Dates and times must not be compared as locale-formatted strings. Conflict calculations use timezone-aware instants and half-open intervals: `[start, end)`.

Cancelled appointments are excluded from active overlap checks. Existing appointments are never silently moved, cancelled, or reassigned because a rule, zone, availability window, or capacity input changes.

## Conflict and Travel-Buffer Rules

Conflict evaluation includes:

- Provider overlap
- Client overlap
- Client availability violation
- Provider availability violation
- Inactive client or provider
- Unsupported provider/service-code combination
- Authorization warning or violation
- Recurring occurrence conflict

Travel-buffer evaluation uses the configurable zone model:

- Same-zone appointments use the agency's configured same-zone default buffer.
- Adjacent-zone appointments use the configured adjacent-zone default buffer.
- Nonadjacent-zone transitions require manual review.
- `Other / Manual Review` transitions require manual review.

Zone buffers are operational estimates, not live travel times. Geocoding, live traffic, routing, and route optimization are deferred.

Conflict responses identify reasons and permitted record references without exposing unauthorized client information. Overrides require explicit permission, reason, and audit history.

## Session and SOAP Linkage Rules

Appointment-to-session linkage is deferred until appointment workflows are stable.

When introduced:

- Appointments and sessions remain separate records.
- Existing sessions without appointments remain valid.
- An appointment may have zero or one primary linked clinical record.
- A session created from an appointment receives `appointmentId`.
- The appointment receives the created session's `sessionId`.
- Link creation is explicit and idempotent.
- A session is never automatically linked by therapist name.
- Historical linkage requires explicit user confirmation.
- Appointment changes never update an existing session.
- Session changes never silently rewrite scheduled appointment time.
- Scheduled-versus-delivered differences are reported as discrepancies.
- Appointment cancellation never deletes a session or note.
- Session deletion does not automatically delete an appointment.
- Finalized and amended SOAP notes remain controlled solely by the existing SOAP workflow.
- A 97155 appointment may link to the appropriate note-history record, but the repaired 97155 `sessionId` remains untouched.
- Scheduling IDs never replace `planChangeLog.sessionId`.
- Scheduling never rewrites `planChangeLog`, note histories, finalized snapshots, or amendments.

## Authorization Rules

Manual appointment scheduling initially provides authorized-versus-scheduled warnings and weekly scheduled-hours calculations.

The workspace must continue to distinguish:

- Approved quantity
- Scheduled quantity
- Delivered quantity
- Finalized or billing-ready quantity
- Remaining quantity

Rules:

- Scheduled time is not delivered utilization.
- Cancelled and no-show appointments do not consume delivered units.
- Completed appointment status alone does not prove service delivery.
- Delivered utilization comes from authoritative clinical records.
- Finalized and billing-ready quantities come from their authoritative workflows.
- Appointment creation outside an authorization period produces a blocking validation or explicit authorized override.
- Approaching limits produces warnings.
- Exceeding limits requires explicit override permission and an audited reason if the agency permits it.
- Hours and units are parsed defensively because legacy authorization values may be strings.
- Unit conversion is defined per service code.
- Existing 15-minute billing behavior is not generalized silently to every code.
- Legacy session `serviceType: "parent-training"` maps to canonical service code `97156`.

## Audit Requirements

Audit events are required for applicable operations, including:

- Zone creation, edit, activation, and deactivation
- ZIP association and adjacency changes
- Client and RBT scheduling-profile changes
- Availability changes
- Staffing status and staffing-demand changes
- Eligibility override
- Match decision
- Operational assignment change
- Appointment creation and edit
- Confirmation
- Cancellation
- Rescheduling
- Recurrence creation or edit
- Conflict or authorization override
- Future session linkage or unlinking

Audit entries record stable IDs and operational changes while minimizing PHI in free text.

## Explicitly Deferred

- Automatic staff assignment
- Automatic schedule publishing
- Google Calendar synchronization
- SMS reminders
- Route optimization
- Geocoding and live travel times
- Payroll exports
- Automatic billing
- HR records
- Credentialing source records
- Full referral-management system
- Full benefits-verification system
- Schedule proposals
- Mobile RBT workflow
- Notifications
- Operational exception queues
- Expanded intake pipeline
- Advanced reporting
- Drag-and-drop scheduling
- Waitlists
- Open-shift boards
