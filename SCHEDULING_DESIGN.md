# Scheduling UX and Workflow Design

## Purpose and Use

This document is the permanent user-experience and workflow specification for the Scheduling module. It describes how Scheduling should feel and behave for administrators, BCBAs, RBTs, and future schedulers. It complements `SCHEDULING_FEATURE_SPEC.md`, which defines technical and domain requirements, and `ROADMAP.md`, which controls implementation sequence and approved scope.

Future work on any Scheduling feature must begin by reading:

- `PROJECT_CONTEXT.md`
- `SCHEDULING_FEATURE_SPEC.md`
- `ROADMAP.md`
- `SCHEDULING_DESIGN.md`

This document expresses the intended long-term experience. A workflow described here is not authorization to implement it ahead of its approved roadmap phase.

## 1. Scheduling Philosophy

Scheduling is the operational hub of the practice. It should help the team understand who is serving whom, where services are planned, when staff and clients are available, and whether the plan is operationally feasible.

Appointments represent planned operational activity. They do not prove that treatment occurred.

The following records remain separate:

- Appointments describe planned service time.
- Clinical sessions describe delivered service.
- SOAP notes describe clinical documentation.
- Treatment plans describe authorized clinical direction and goals.

Scheduling may display carefully labeled information from these areas, but it must never blur their meaning. Creating, changing, confirming, cancelling, or rescheduling an appointment must not automatically create or rewrite a session, SOAP note, treatment-plan entry, finalized snapshot, amendment, or other finalized clinical documentation.

The experience should minimize scheduler clicks without weakening identity, permission, agency, history, or audit controls. Reuse trusted information already in the application, present the smallest useful set of choices, and preserve a clear history of consequential actions.

### Do Not Ask Twice

The scheduling workflow should reuse authoritative information already stored in the application instead of asking a scheduler to enter it again.

Examples include:

- Client service locations come from the Client Profile.
- Authorization dates populate recurring-series end dates.
- Provider credentials determine eligible service codes.
- Zones come from saved service locations.
- Existing scheduling data is reused whenever appropriate.

“The scheduling module should think like an experienced ABA scheduler. It should reduce repetitive work, surface operational problems early, and preserve clinician and scheduler judgment.”

## Operational Priorities

When multiple valid scheduling options are available, the workflow should prioritize:

1. Client continuity
2. Geographic efficiency
3. Authorization utilization
4. Clinical continuity
5. Provider satisfaction
6. Documentation readiness

These priorities guide recommendations, warnings, and scheduler review. They do not bypass eligibility, permission, agency, safety, authorization, or audit requirements, and they do not authorize automatic assignment or automatic schedule changes.

## 2. Calendar Philosophy

The default Scheduling experience is a weekly calendar organized by provider. It uses a Monday-through-Sunday layout and makes the current week, provider workload, open time, and planned services easy to scan.

The calendar should approach Google Calendar in usability:

- Fast week navigation
- Clear time placement and duration
- Familiar appointment blocks
- Predictable create and selection interactions
- Responsive desktop and narrow-screen behavior
- Minimal steps for common scheduling work

It must remain ABA-specific by showing service codes, provider eligibility, client service locations, authorization awareness, operational status, and clinically appropriate safeguards.

Future calendar filters include:

- Provider
- Client
- Service code
- Geographic zone

Filters should be easy to combine and easy to clear. The selected week and filters should remain understandable at all times. Appointment blocks and completed clinical-session blocks must be visually and semantically distinct. Color alone must never be the only distinction.

The weekly calendar should support rapid scanning. A scheduler should be able to determine quickly:

- Which provider is assigned
- Which client is scheduled
- Which service code applies
- Where the service occurs
- Whether warnings or conflicts exist

## 3. Appointment Colors

Each supported CPT code has one reserved color family. These colors should remain consistent on calendars, legends, filters, summaries, and future scheduling views.

| CPT code | Service meaning | Primary color | Light background |
| --- | --- | --- | --- |
| 97153 | Adaptive behavior treatment by protocol | Blue `#2563EB` | `#DBEAFE` |
| 97155 | Adaptive behavior treatment with protocol modification | Violet `#7C3AED` | `#EDE9FE` |
| 97156 | Family adaptive behavior treatment guidance | Teal `#0F766E` | `#CCFBF1` |
| 97151 | Behavior identification assessment | Amber `#B45309` | `#FEF3C7` |

Every appointment must also display its CPT code as text. Statuses such as scheduled, confirmed, cancelled, completed, and no-show should use labels, icons, borders, or patterns in addition to color. Cancellation styling should not replace the underlying CPT identity.

Historical clinical sessions retain their own neutral, clearly labeled visual treatment and must continue to read as completed clinical records rather than appointments.

## 4. Appointment Workflow

The primary Scheduling entry points are:

- **Add Appointment** for one appointment
- **Add Series** for a bounded recurring schedule

Future contextual entry points may include:

- **Create from Client**, preselecting the client and their relevant profile information
- **Create from Provider**, preselecting the provider and showing that provider's calendar context

All entry points should converge on the same understandable appointment workflow. Preselected information should reduce clicks, but the user must still be able to review the important facts before saving.

Appointments remain independent from clinical sessions. Future session-start or linkage actions must be explicit, separately authorized, and visibly distinct from appointment creation.

## 5. Appointment Creation UX

Creating one appointment should feel short, guided, and safe. The form should follow the scheduler's natural decision order and avoid asking for information already stored elsewhere.

Required fields:

- Client
- Provider
- Service code
- Date
- Start time
- End time
- Service location
- Setting

The form should use progressive filtering:

1. The client selection limits choices to active clients in the user's agency scope.
2. The service-code selection limits the provider list to active, agency-compatible, credential-compatible providers.
3. The client selection loads saved service locations from the Client Profile.
4. A single saved location is selected automatically; multiple locations are presented as a choice.
5. The user reviews date, time, timezone, setting, and location before saving.

Address fields are intentionally omitted. Schedulers should never re-enter an address that already belongs to the Client Profile.

One optional **Operational Scheduling Note** may be provided for logistics, for example:

- “Use side gate.”
- “Call caregiver when arriving.”
- “School dismissal 2:15.”

This note is operational only. It is not a clinical narrative, SOAP note, behavior record, assessment, or treatment-plan entry. The interface should label it accordingly and should not encourage clinical content.

Validation should be timely and plain-language. The interface should prevent inverted or unsupported overnight times, explain missing client locations, prevent duplicate submission, show API errors, and confirm successful creation. Successful creation should return the user to an updated view of the relevant calendar week.

## 6. Client Service Locations

A service location and a physical address are not the same thing. A client may have multiple service locations, including:

- Home
- School
- Mom's House
- Dad's House
- Clinic
- Community

Each saved location should include:

- Name
- Setting
- Geographic zone
- Optional physical address
- Optional operational note

Home, clinic, and other navigation-dependent locations may include a physical address. School locations generally should not require one: the school's identity, service setting, and geographic zone are usually sufficient for scheduling. The workflow should not require repeated school-address entry. The zone remains important for provider assignment and travel-feasibility review, while a physical address may be stored later if it becomes necessary for navigation.

Locations belong to the Client Profile and are maintained there. Appointment forms reference a saved location instead of duplicating address-entry controls.

When a location is selected, the appointment references that saved service location and preserves an appropriate historical snapshot of its relevant details. Later Client Profile changes should improve future scheduling choices without silently rewriting past appointment facts. Appointment creation must not require manual address re-entry.

If a client has one saved location, it should be selected automatically. If a client has several, the choices should use recognizable labels and, where useful, simple setting icons such as home, school, clinic, or community. If no usable location exists, the scheduler should receive a clear instruction to update the Client Profile rather than being invited to type a one-off address.

## 7. Geographic Zones

Zones provide a shared operational vocabulary for staffing, travel expectations, capacity, and schedule review across Miami-Dade County. They are configurable practice definitions, not permanent assumptions about municipal boundaries or exact travel time.

### South

- Homestead
- Florida City
- Princeton
- Goulds
- Cutler Bay
- Palmetto Bay

### West

- Kendall
- West Kendall
- Tamiami
- Fontainebleau

### Central

- Coral Gables
- South Miami
- Westchester
- Flagami
- Little Havana

### Northwest

- Hialeah
- Hialeah Gardens
- Miami Lakes
- Doral
- Medley

### Northeast

- North Miami
- North Miami Beach
- Aventura
- Sunny Isles Beach
- Bal Harbour
- Bay Harbor Islands
- Surfside

### East

- Downtown Miami
- Brickell
- Edgewater
- Wynwood
- Midtown
- Design District
- Miami Beach
- Key Biscayne

Client zones should not be stored as one generic primary and secondary zone independently from service locations. Instead:

- Each service location has its own zone.
- A client may have a primary service location.
- A client may have one or more additional service locations.
- Scheduling uses the zone of the location selected for the appointment.

For example:

- Home → West Kendall
- School → Doral
- Dad's House → Kendall

Each provider should have:

- One primary zone
- A set of acceptable zones

The UI should make primary and acceptable-zone relationships easy to understand. Assignments outside preferred zones should generate visible, explainable warnings but should not automatically block scheduling. The scheduler remains responsible for the final operational decision unless a separately approved hard safety or permission rule applies.

## 8. Provider Assignment Philosophy

Provider selection must begin with eligibility, not ranking.

- `97153` shows eligible RBTs only.
- `97151`, `97155`, and `97156` show eligible BCBAs only.

Inactive, out-of-agency, or credential-incompatible providers should not appear as selectable choices. Provider identity must come from the authoritative user directory, never from free text or therapist-name matching.

Future provider suggestions should prioritize:

1. Primary-zone compatibility
2. Travel distance or travel burden
3. Availability
4. Existing workload

Suggestions are decision support, not automatic assignment. The interface should explain why a provider is suggested, show meaningful warnings, and leave the final selection to an authorized person.

## 9. Authorization Awareness

Scheduling should continuously present distinct authorization and utilization quantities:

- Approved hours
- Currently scheduled hours
- Delivered hours
- Remaining hours
- Hours that would be scheduled after saving a new appointment or series

These values must be clearly labeled and must not be collapsed into a generic utilization number. Currently scheduled hours represent existing operational intent. Delivered hours come from authoritative clinical records. Remaining hours should make their calculation and reference period understandable. The prospective post-save quantity should be shown before the user commits the new appointment or series so the operational effect is visible in time to adjust the plan.

The interface should warn schedulers before planned appointments exceed or fall outside authorization limits. Warnings should appear early enough to change the plan without losing form work. Where an agency permits an override, it should require the appropriate permission and a clear reason.

For recurring schedules, the default end date should be the applicable authorization expiration date. The user should be able to choose an earlier end date but should not casually schedule beyond the authorization period.

## 10. Recurring Scheduling

Recurring scheduling is expected for most ABA services and should be a first-class workflow rather than a copy-and-paste shortcut.

The recurring workflow should support:

- Weekly recurrence
- Multiple weekdays in one series
- Different times on different weekdays
- A required, bounded end date
- An end date defaulted to authorization expiration
- Removal of an individual future occurrence

The recurring workflow should not support:

- No end date
- Ending after a number of occurrences

When changing a series, the user should choose the intended scope:

- **This occurrence only**
- **This and future**
- **Entire series**

The interface must explain the effect before applying the change. Past appointments are historical operational records and are never rewritten by a series edit. Changes should preserve an understandable audit history and stable occurrence identity.

## 11. Cancellation Philosophy

Cancellation is a status and history workflow, not deletion.

Cancelled appointments remain visible on the calendar with clearly subdued or patterned styling, their original service identity, and an explicit **Cancelled** label. They contribute to operational reporting but never count as delivered treatment.

A cancellation requires a reason. User-facing reason categories include:

- Client
- Provider
- Agency

More specific operational reasons may appear beneath these categories when useful, but the first-level choice should remain quick and understandable. Cancellation should preserve who acted, when it occurred, the reason, and the original appointment facts.

Cancelling an appointment must never delete or rewrite a clinical session, SOAP note, treatment-plan record, or finalized documentation.

## 12. Role Experiences

### Administrator

Administrators coordinate the agency's full operational picture within their permitted scope. Their experience should support calendar review, staffing decisions, appointment and series management, zone configuration, authorization warnings, capacity review, and auditable overrides as those roadmap phases become available.

### BCBA

BCBAs should see the schedules and operational information relevant to their permitted clients and services. They may schedule clinically relevant services when authorized, review authorization awareness, and understand provider and location context without gaining unrelated administrative powers.

### RBT

Initially, RBTs see only their own schedule and the minimum client information necessary for assigned work.

Future RBT actions may include:

- View assigned appointments
- Start a permitted session from an appointment

RBTs do not receive agency-wide scheduling, staffing, or provider-management privileges. Starting a session must remain an explicit future workflow and must not cause appointment viewing to become a clinical-document editing surface.

### Future Scheduler

A future scheduler role should receive the operational access needed to manage calendars, locations, zones, staffing, and appointments without automatically receiving broad SOAP, assessment, treatment-plan, clinical-note, billing, or HR access.

## 13. Long-Term Vision

The following areas are reserved for separately approved future design and implementation work.

### Travel Optimization

Help users understand travel burden between planned services while keeping estimates explainable and distinct from guarantees. Travel optimization should recommend and warn; it must never automatically rearrange, move, cancel, or reassign appointments.

### Route Planning

Provide practical daily route views only after reliable location, zone, buffer, and privacy foundations exist.

### Google Calendar Synchronization

Support carefully scoped external-calendar visibility without making an external calendar the authoritative scheduling record or exposing unnecessary client information.

### Authorization Dashboards

Provide clear comparisons among approved, scheduled, delivered, finalized, and remaining quantities.

### Payroll

Keep payroll calculations separate from appointment status and clinical delivery facts, with explicit ownership and reconciliation rules.

### Productivity

Offer transparent operational measures without treating scheduled time as delivered or billing-ready service.

### Open Shifts

Help authorized users identify unfilled service needs without automatically assigning staff.

### Waitlists

Support explicit prioritization and outreach workflows without hiding unmet demand or silently changing staffing status.

### Geographic Optimization

Use zones, acceptable travel areas, and later travel data to support explainable decisions rather than opaque automatic placement.

## Future Operational Dashboard

A future Operational Dashboard may consolidate permission-appropriate scheduling signals and trends. It should reserve space for:

- Today's schedule
- Scheduled hours
- Delivered hours
- Remaining authorization hours
- Provider utilization
- Open shifts
- Client cancellations
- Provider cancellations
- No-shows
- Upcoming authorization expirations

These metrics must retain their distinct operational and clinical meanings, identify their authoritative sources and time periods, and must not treat scheduled activity as delivered service. This section reserves future design intent only and does not authorize implementation ahead of its approved roadmap phase.

## 14. Design Principles

All Scheduling work should follow these principles:

1. **Minimize clicks.** Common ABA scheduling work should be fast and direct.
2. **Do Not Ask Twice.** Draw from authoritative client, user, authorization, credential, service-location, zone, and scheduling records instead of asking users to re-enter known facts.
3. **Prevent duplicate data entry.** Locations, identities, credentials, and clinical facts should have one authoritative home.
4. **Protect clinical records.** Scheduling actions never silently create, delete, or rewrite clinical documentation.
5. **Separate operational data from clinical data.** Planned, delivered, finalized, and billing-ready facts must remain distinct.
6. **Favor warning over blocking when clinically and operationally appropriate.** Explain risk and preserve human judgment while still enforcing identity, permission, safety, and integrity rules.
7. **Build around ABA workflows.** Use ABA service codes, provider roles, recurring patterns, client settings, authorizations, and supervision realities rather than imitating generic calendar software without context.
8. **Preserve audit integrity.** Important changes should remain attributable, reviewable, and historically accurate.
9. **Make recommendations explainable.** Suggestions and warnings should show their basis and never perform automatic assignment.
10. **Design for least privilege.** Every role should see and do only what its operational responsibilities require.
11. **Keep history stable.** Past appointments, cancellations, series occurrences, and finalized clinical records should not be silently rewritten.
12. **Stay phase-disciplined.** Long-term design intent does not authorize implementation outside the approved roadmap phase.
13. **Think like an experienced ABA scheduler.** “The scheduling module should think like an experienced ABA scheduler. It should reduce repetitive work, surface operational problems early, and preserve clinician and scheduler judgment.”git status

