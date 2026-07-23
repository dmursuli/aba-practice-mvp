# Scheduling Roadmap

Every phase is narrow, independently testable, and independently deployable. A later phase must not be bundled into an earlier phase for convenience.

## Phase 0: Architecture Inspection and Documentation

Scope:

- Record current persistence, identity, session, authorization, navigation, and deployment patterns.
- Define scheduling boundaries and protected workflows.
- Approve the feature specification and roadmap.

Acceptance criteria:

- `PROJECT_CONTEXT.md`, `SCHEDULING_FEATURE_SPEC.md`, and `ROADMAP.md` are reviewed and approved.
- The 97155 `planChangeLog/sessionId` boundary is documented.
- SOAP draft, finalization, and amendment protections are documented.
- No runtime code, data, or schema is changed.

## Phase 1: Scheduling Navigation and Read-only Weekly Calendar Shell

Scope:

- Add Scheduling navigation for admin and BCBA.
- Add Monday-through-Sunday calendar layout.
- Add Today, Previous Week, and Next Week controls.
- Add client and service-code filters.
- Display existing saved sessions as read-only completed clinical records.
- Use a separate scheduling data cache.

Acceptance criteria:

- Direct URL navigation to `?view=schedule` works.
- Unauthorized roles do not see the navigation item.
- Week transitions work across month and year boundaries.
- Existing sessions load only for the visible date range.
- Loading, error, and empty states render correctly.
- No appointment, session, SOAP, plan-change, or database mutation occurs.
- Existing startup, lazy-loading, SOAP, graph, billing, and 97155 tests remain green.

## Phase 2: Appointment Storage Model and API

Scope:

- Add backward-compatible `appointments: []` application state.
- Add appointment sanitization and validation.
- Add agency-scoped date-range read API.
- Add create/update/cancel API foundations without exposing UI mutations.
- Add appointment audit events.
- Add optimistic appointment version checks.

Acceptance criteria:

- Missing legacy `appointments` state defaults to an empty array.
- Appointment reads are agency scoped.
- Invalid client, provider, service code, time range, or timezone is rejected.
- Concurrent stale updates receive a conflict response.
- Backup and restore preserve appointments.
- No SQL migration is required.
- Existing client/session/note state remains byte-for-byte unaffected by appointment-only operations, excluding expected audit additions.

## Phase 3: Individual Appointment Create, Edit, and Cancel

Scope:

- Add appointment form.
- Support create, edit, confirm, cancel, and explicit reschedule.
- Show validation and authorization-date warnings.
- Keep the calendar non-draggable.

Acceptance criteria:

- Authorized users can manage one appointment.
- Cancellation preserves appointment history.
- Rescheduling preserves the original record and links the replacement.
- Completed or linked appointments enforce restricted edit rules.
- Every mutation produces an audit event.
- No clinical session or SOAP note is created or changed.

## Phase 4: Recurring Appointments

Scope:

- Add recurrence series.
- Support weekly rules, selected weekdays, end date, and occurrence limit.
- Support editing one occurrence or future occurrences.
- Generate stable occurrence IDs.

Acceptance criteria:

- Series creation is bounded and validated.
- One occurrence can be cancelled without rewriting unrelated occurrences.
- Editing future occurrences preserves past occurrences.
- Daylight-saving transitions preserve intended local appointment time.
- Series actions are audited.

## Phase 5: Staff Availability

Scope:

- Add recurring staff availability rules.
- Add effective dates and timezone.
- Display availability on scheduling views.
- Warn when appointments fall outside availability.

Acceptance criteria:

- Availability can be created, edited, deactivated, and date bounded.
- Overnight and invalid rules are rejected unless explicitly supported.
- Availability warnings are deterministic and tested.
- Existing appointments are not automatically moved.

## Phase 6: PTO, Holidays, and Unavailable Time

Scope:

- Add dated provider unavailable time.
- Add agency holidays and closures.
- Display blocked time on calendars.

Acceptance criteria:

- Full-day and partial-day blocks work.
- Agency and provider scope are enforced.
- Existing appointments remain present and receive warnings.
- Block creation does not silently cancel appointments.
- Changes are audited.

## Phase 7: Scheduling Conflict Detection

Scope:

- Detect client and provider overlap.
- Detect availability and unavailable-time conflicts.
- Detect inactive-record and authorization-period conflicts.
- Add explicit conflict override with reason.

Acceptance criteria:

- Half-open interval behavior is tested.
- Cancelled appointments are excluded.
- Create, update, and recurrence validation use the same conflict engine.
- Conflict responses identify reasons and permitted record references.
- Overrides require permission, reason, and audit event.

## Phase 8: Client and Therapist Schedule Views

Scope:

- Add client-specific calendar and agenda.
- Add provider-specific calendar and agenda.
- Add RBT own-schedule access after reliable provider-user assignment exists.

Acceptance criteria:

- Client views show only permitted client data.
- RBTs see only their assigned appointments.
- Admin and BCBA views remain agency scoped.
- Provider filtering uses `userId`, never therapist-name matching.
- Empty and inactive-user behavior is defined and tested.

## Phase 9: Appointment-to-Session and SOAP-note Linkage

Scope:

- Start a permitted session from an appointment.
- Persist `appointmentId` on the new clinical record and `sessionId` on the appointment.
- Support explicit linkage to 97151/97155 note-history records.
- Show scheduled-versus-delivered discrepancies.

Acceptance criteria:

- Link creation is idempotent.
- Existing unlinked sessions remain valid.
- Appointment edits do not change linked sessions.
- Linked-session edits do not rewrite appointments.
- Finalized SOAP notes remain locked.
- Appointment cancellation does not delete clinical records.
- 97155 `planChangeLog.sessionId` matching remains unchanged.
- The full SOAP and 97155 regression suites pass.

## Phase 10: Authorization Utilization Tracking

Scope:

- Report approved, scheduled, delivered, finalized/billing-ready, and remaining quantities.
- Add threshold warnings.
- Add authorized override handling.

Acceptance criteria:

- Scheduled time is never counted as delivered.
- Cancelled and no-show appointments consume no delivered units.
- Legacy `parent-training` sessions count as 97156.
- Date-range boundaries are tested.
- String-based legacy authorization values are safely parsed.
- Override actions are permission checked and audited.

## Phase 11: Travel and Geographic Scheduling Support

Scope:

- Add structured reusable locations.
- Add address snapshots to appointments.
- Add optional coordinates and travel buffers.
- Add basic geographic feasibility warnings.

Acceptance criteria:

- Existing free-text settings remain supported.
- Changing a reusable location does not rewrite historical appointment snapshots.
- Travel warnings do not automatically move appointments.
- No route optimization is implemented.
- Address and coordinate access follows agency permissions.

## Phase 12: Payroll and Productivity Reporting

Scope:

- Add internal reports comparing scheduled, delivered, cancelled, and documented time.
- Report provider utilization and documentation completion.
- Support date, provider, client, service-code, and agency filters.

Acceptance criteria:

- Reports use immutable appointment/session linkage.
- Scheduled and delivered quantities remain separate.
- Unlinked sessions and appointments are reported explicitly.
- Report totals reconcile to source records.
- No payroll export or payroll-system integration is implemented.
- No automatic billing is implemented.

## Deferred Beyond This Roadmap

- Google Calendar synchronization
- SMS reminders
- Route optimization
- Payroll exports
- Drag-and-drop scheduling
- Waitlists
- Open-shift boards
- Automatic billing
- Credentialing
- Human-resources functionality
