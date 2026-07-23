# Scheduling Operations Workspace Roadmap

The approved Scheduling Operations Workspace is a long-term product direction, not one large implementation. Every phase is narrow, independently reviewable, independently testable, and independently deployable. Later-phase business logic must not be bundled into an earlier phase for convenience.

Scheduling remains part of the existing application. No phase creates a separate web application, authentication system, database, deployment, client directory, or staff directory.

## Permanent Boundaries

- Scheduling owns operational intent: staffing demand, scheduling profiles, availability, assignments, planned appointments, zones, capacity, and travel feasibility.
- Existing clinical modules own sessions, SOAP notes, treatment plans, assessments, 97155 `planChangeLog/sessionId` behavior, and delivered-service facts.
- Billing owns claims and payment workflows.
- Existing clients and users are referenced by stable IDs.
- Scheduled, delivered, finalized, and billing-ready hours remain separate calculations.
- Appointment changes never silently update sessions, SOAP notes, finalized records, amendments, or `planChangeLog`.
- Matching is explainable administrator decision support and never performs automatic assignment.

## Phase 1: Read-only Weekly Clinical-record Calendar — Complete

Delivered scope:

- Scheduling navigation for authorized admin and BCBA users
- Monday-through-Sunday weekly calendar
- Today, Previous Week, and Next Week controls
- Client and service-code filters
- Existing saved sessions displayed as read-only completed clinical records
- Date-range loading through a separate scheduling data cache
- Loading, error, and empty states

Preserved boundaries:

- No appointment records
- No session or SOAP mutation
- No treatment-plan or `planChangeLog` mutation
- Existing clinical records remain authoritative

## Phase 2: Scheduling Workspace Shell

Scope:

- Convert the current Scheduling page into an internal workspace.
- Add sub-navigation for Calendar, Staffing, Availability, Zones, and Capacity.
- Preserve the existing weekly calendar as the functional Calendar subview.
- Add intentional empty states for Staffing, Availability, Zones, and Capacity.
- Preserve direct navigation to the Scheduling workspace.
- Do not add domain storage, mutation APIs, forms, matching, capacity, availability, or zone business logic.

Acceptance criteria:

- Authorized users can switch among all five workspace subviews.
- Calendar behavior and visible-range loading remain unchanged.
- Each nonfunctional subview clearly identifies its future purpose and does not imply that data is being calculated.
- Existing role and agency visibility rules remain unchanged.
- No runtime mutation, persistence collection, or new domain API is introduced.
- Existing calendar, startup, lazy-loading, SOAP, billing, graph, and 97155 regression tests remain green.

## Phase 3: Zone Management

Scope:

- Add configurable agency-scoped zones.
- Support ZIP-code associations.
- Support adjacent-zone relationships.
- Support default same-zone and adjacent-zone travel-buffer rules.
- Support active/inactive status.
- Assign a client's primary zone by stable `clientId`.
- Assign an RBT's primary and secondary zones by stable `userId`.
- Support `Other / Manual Review`.

Initial seed candidates:

- West Kendall
- Kendall
- Doral
- Cutler Bay
- Homestead
- Miami Lakes
- Other / Manual Review

Acceptance criteria:

- Zone names and relationships are configurable rather than hard-coded into matching or scheduling behavior.
- ZIP associations use canonical validated values.
- Adjacency cannot self-reference and is treated symmetrically.
- Unmapped or ambiguous ZIP codes route to manual review.
- Inactive zones remain available for historical references but cannot be newly assigned without an explicit corrective action.
- Client and RBT references use existing stable IDs.
- Zone changes are agency-scoped, version checked where applicable, and audited.
- No appointments, matching scores, or live travel calculations are introduced.

## Phase 4: Scheduling Profiles

Scope:

Create separate scheduling-owned profile records that extend existing clients and users without duplicating their authoritative identities.

Client scheduling profile:

- `clientId`
- Assigned zone
- Service locations
- Preferred setting
- Structured weekly availability
- Weekend permission
- Language preference
- Experience requirement
- Transportation or caregiver restrictions
- Staffing status
- Assigned BCBA reference

RBT scheduling profile:

- `userId`
- Primary zone
- Secondary zones
- Structured weekly availability
- Maximum weekly hours
- Minimum desired hours
- Travel radius or travel preference
- Language
- Experience areas
- Age-group preference
- Service-setting preference
- Weekend availability
- Transportation reliability
- Supervisor reference
- Employment scheduling status

Acceptance criteria:

- Each profile references an existing agency-compatible client or user.
- Profile fields are scheduling-specific.
- Authentication, legal identity, clinical credentials, HR records, pay rates, and assessment data are not duplicated.
- Availability uses structured weekday, time, timezone, and effective-date values.
- Invalid, overnight, or inverted availability windows are rejected unless explicitly supported.
- Updates are version checked and audited.
- No eligibility ranking or appointment business logic is introduced.

## Phase 5: Staffing Queue

Scope:

- Add an operational staffing queue initially based on existing clients.
- Support staffing demand and required weekly hours.
- Support administrator-managed staffing progression.
- Preserve partial staffing and remaining unfilled hours.

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

Acceptance criteria:

- Queue records reference existing clients by stable ID.
- The queue does not create duplicate referral, assessment, benefits, authorization, or clinical records.
- Status changes are explicit, agency-scoped, and audited.
- Partial staffing retains both staffed and unstaffed quantities.
- The UI distinguishes operational stage labels from evidence stored in authoritative modules.
- A complete referral-management system remains deferred.

## Phase 6: Eligibility Filtering

Scope:

Filter incompatible RBTs using hard constraints:

- Inactive provider
- Agency mismatch
- Availability mismatch
- Payer or credential incompatibility
- Zone restrictions
- Maximum-hours violation
- Schedule overlap
- Language requirement
- Required experience
- Supervision restriction

Acceptance criteria:

- Eligibility uses stable `clientId` and `userId` references.
- All hard constraints are evaluated before ranking.
- Ineligible candidates receive explicit disqualifier reasons.
- Ineligible candidates are not scored.
- Results do not expose unauthorized client information.
- The same inputs produce deterministic eligibility results.
- No automatic assignment occurs.

## Phase 7: Explainable Matching

Scope:

Rank only eligible RBTs using configurable weighted factors:

- Same primary zone
- Schedule compatibility
- Travel burden
- Desired additional hours
- Same supervising BCBA
- Language match
- Relevant experience

Acceptance criteria:

- Only eligible candidates enter ranking.
- Weight configuration is agency-scoped and validated.
- Every recommendation shows reasons, warnings, relevant inputs, and disqualifiers where applicable.
- Recommendations indicate when material inputs have become stale.
- An administrator explicitly accepts, rejects, or defers a recommendation.
- Administrator decisions are audited.
- The system never assigns staff or publishes a schedule automatically.

## Phase 8: Manual Appointment Scheduling

Scope:

- Add backward-compatible appointment and recurrence records.
- Create one appointment.
- Edit and confirm an appointment.
- Cancel with a reason.
- Reschedule explicitly while preserving the original record.
- Create and manage bounded recurring schedules.
- Record appointment audit history.
- Show authorized-versus-scheduled warnings.
- Calculate weekly scheduled hours.

Acceptance criteria:

- Missing legacy scheduling collections default safely without requiring historical backfill.
- Reads and mutations are authenticated, role checked, and agency scoped.
- Client and provider references use stable IDs.
- Invalid service codes, providers, time ranges, timezones, recurrence rules, and authorization periods are rejected or handled through an explicitly permitted override.
- Stable appointment and occurrence IDs are preserved.
- Stale concurrent updates receive a version conflict.
- Cancellation preserves history.
- Rescheduling links a replacement instead of rewriting the original.
- Daylight-saving transitions preserve intended local recurrence time.
- Scheduled hours are never reported as delivered, finalized, or billing-ready hours.
- No clinical session or SOAP record is created or changed.

## Phase 9: Conflict and Travel Buffer Detection

Scope:

- Detect provider overlap.
- Detect client overlap.
- Detect client and provider availability violations.
- Apply same-zone default buffers.
- Apply adjacent-zone default buffers.
- Require manual review for nonadjacent zones.
- Require manual review for unmapped or `Other / Manual Review` zones.
- Support permissioned conflict overrides with reasons.

Acceptance criteria:

- Time conflicts use timezone-aware instants and half-open intervals.
- Cancelled appointments are excluded from active overlap checks.
- Create, update, and recurrence flows use the same conflict rules.
- Travel buffers come from configurable zone relationships.
- Zone-buffer warnings do not automatically move, cancel, or reassign appointments.
- Nonadjacent transitions are not represented as precise route calculations.
- Overrides require permission, reason, and audit history.
- No geocoding, live traffic, or route optimization is introduced.

## Phase 10: Capacity Dashboard

Scope:

Show operational supply and demand by:

- Zone
- Provider type
- Service code
- Time band

Measures:

- Client hours needed
- RBT hours available
- Staffing gap
- Partially staffed hours
- Coverage percentage

Acceptance criteria:

- Capacity measures reconcile to profile, availability, staffing-demand, assignment, and appointment sources.
- Supply and demand are not stored as unexplained duplicate totals.
- Filters preserve agency scope.
- Missing or incomplete profile data is visible rather than silently treated as zero.
- Scheduled hours remain separate from delivered, finalized, and billing-ready hours.
- No payroll, recruitment, or automatic staffing actions are introduced.

## Phase 11: Appointment-to-Session Linkage

This phase begins only after manual and recurring appointment workflows are stable.

Scope:

- Start a permitted clinical record from an appointment.
- Store explicit bidirectional appointment/session references.
- Support explicit linkage to appropriate 97151 or 97155 note-history records.
- Show scheduled-versus-delivered discrepancies.

Acceptance criteria:

- Link creation is explicit and idempotent.
- Existing unlinked sessions remain valid.
- Historical links require user confirmation.
- Therapist-name matching is prohibited.
- Appointment edits do not change linked sessions.
- Linked-session edits do not rewrite appointments.
- Appointment cancellation does not delete clinical records.
- Finalized SOAP notes remain locked.
- 97155 `planChangeLog.sessionId` behavior remains unchanged.
- Scheduling never rewrites `planChangeLog`, note histories, finalized snapshots, or amendments.
- Full SOAP, session, billing, and 97155 regression suites remain green.

## Phase 12: Advanced Features

Potential separately approved capabilities:

- Geocoding
- Live travel times
- Schedule proposals
- Mobile RBT workflow
- Notifications
- Operational exception queues
- Expanded intake pipeline
- Advanced operational reporting

Each capability requires its own scope, privacy review, validation rules, acceptance criteria, and deployment decision. Inclusion in this phase is not authorization to bundle these capabilities together.

## Explicitly Deferred

- Automatic staff assignment
- Automatic schedule publishing
- Google Calendar synchronization
- SMS reminders
- Route optimization
- Payroll exports
- Automatic billing
- HR records
- Credentialing source records
- Full referral-management system
- Full benefits-verification system
- Drag-and-drop scheduling
- Waitlists
- Open-shift boards
