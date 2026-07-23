# Project Context

## Application

Triumph Behavioral Care operates an existing production ABA practice-management web application. The application supports clinical data collection, treatment-plan management, documentation, reporting, and administrative review.

Scheduling is evolving inside this application into an integrated Operations Workspace. It is not a separate product, web application, authentication boundary, database, or deployment. The existing application remains authoritative for agency, client, user, clinical, and billing identities and records.

## Technology Stack

- Node.js 18 or later
- Native Node HTTP server with Express-style route handling
- Vanilla JavaScript ES modules
- HTML and CSS
- PostgreSQL production persistence
- JSON-file local development persistence
- AWS S3 document storage with local-storage fallback
- AWS Lightsail application hosting
- PM2 process management
- Caddy HTTPS reverse proxy
- Node's built-in test runner

Production PostgreSQL currently stores application state as a single JSONB document in the `app_state` table. Local development uses the same logical state shape in `data/db.json`.

## Major Features

- Authentication and email verification
- Agency-based data scoping
- Client management
- User and role management
- Session records
- SOAP note generation
- Editable SOAP drafts
- SOAP finalization and amendments
- 97151 assessment-note history
- 97153 direct-treatment documentation
- 97155 protocol-modification documentation
- 97156 caregiver-training documentation
- Treatment plans
- Treatment-plan target-status tracking
- Behavior and skill-acquisition graphs
- Assessments and document uploads
- Caregiver training
- Funder reports
- Billing-readiness reports
- Data-health checks
- Audit logging
- Historical clinical-data import
- Practice backup and restore
- Read-only weekly Scheduling calendar

## Scheduling Operations Workspace Direction

The approved long-term product direction expands Scheduling from a calendar into the operational hub for staffing readiness, availability, assignments, planned appointments, zones, capacity, and travel feasibility. The direction is intentionally divided into narrow implementation phases; approval of the architecture does not authorize implementing the full workspace as one feature.

The Scheduling workspace uses internal sub-navigation:

- Calendar
- Staffing
- Availability
- Zones
- Capacity

Calendar is the first functional subview. Other subviews are introduced only in their approved roadmap phases.

### Domain ownership

Scheduling owns operational intent:

- Staffing demand and staffing status
- Client and RBT scheduling profiles
- Structured operational availability
- RBT and BCBA assignment references
- Planned and recurring appointments
- Configurable zones and zone relationships
- Operational capacity calculations
- Travel-feasibility rules and warnings

Existing clinical modules remain authoritative for:

- Sessions and delivered services
- SOAP notes, signatures, finalized snapshots, and amendments
- 97155 `planChangeLog/sessionId` behavior
- Treatment plans
- Assessments and clinical assessment content

Billing remains authoritative for claims, payment workflows, and billing actions.

Scheduling may reference or calculate operational projections from authoritative records, but it must not copy those records into a competing source of truth. Scheduled hours, delivered hours, finalized hours, and billing-ready hours are separate calculations with distinct meanings.

### Miami-Dade operating model

The initial operating model is Miami-Dade County. Zones are configurable agency data rather than hard-coded application behavior. Initial zone records may be seeded as West Kendall, Kendall, Doral, Cutler Bay, Homestead, Miami Lakes, and Other / Manual Review.

Zone records support ZIP-code associations, adjacent-zone relationships, default travel-buffer rules, and active/inactive status. Clients and RBTs reference zones through scheduling-owned profiles; their existing core client and user records remain authoritative and are not duplicated.

## Critical Workflows That Must Not Regress

### 97155 plan-change linkage

Treatment-plan changes are recorded in each client's `planChangeLog`. Entries may include `clientId`, `sessionId`, `sessionDate`, `serviceCode`, and `context`. The repaired 97155 workflow prefers exact `sessionId` matching and preserves date-based fallback only for legacy records.

Scheduling must not reuse, regenerate, rewrite, or reinterpret these identifiers.

### SOAP lifecycle

97153 and 97156 SOAP notes are stored on session records. Their lifecycle supports draft saving, finalization, and amendment. Finalized notes are locked and may only be changed through the amendment workflow.

97151 and 97155 notes are stored in client note-history collections and have equivalent draft/finalized/amended metadata.

Scheduling must not update SOAP text, signature data, finalized snapshots, amendment history, note status, or clinical service details.

### Session history

Existing sessions are valid without appointments. Introducing scheduling must not require historical backfill and must not change existing session IDs or client linkage.

### Scheduling identity and profile boundaries

Client scheduling profiles reference existing clients by stable `clientId`. RBT scheduling profiles reference existing users by stable `userId`. These profiles may contain scheduling-specific preferences, availability, zones, hour limits, and staffing state, but they must not duplicate authentication data, legal identity, clinical credentials, or HR source records.

Provider assignments and matching must never infer identity from free-text therapist names. Matching is administrator decision support: eligibility is evaluated before ranking, recommendations must be explainable, and the application must never assign staff automatically.

## Existing Data Conventions

- Application state uses top-level arrays such as `clients`, `sessions`, `users`, `auditLog`, and `historicalImportBatches`.
- IDs are strings. Clients and users use stable slug-like IDs; sessions and many child records use UUIDs.
- Agency scope is denormalized onto users, clients, sessions, audit entries, and import batches.
- Missing top-level collections are initialized defensively.
- Input is normalized through small sanitizer functions before persistence.
- API handlers perform role and agency checks before returning or mutating data.
- High-risk actions write audit events.
- Dates generally use `YYYY-MM-DD`.
- Creation and update timestamps use ISO strings.
- UI modules use `data-view-button` and `data-view-panel`.
- Role visibility is controlled by the `roleViews` map.
- The frontend uses one shared in-memory state object and targeted render functions.
- Large session datasets are loaded lazily by client, date range, or page.
- User-facing HTML is escaped before interpolation.
- Tests use Node's built-in `node:test` and temporary JSON databases.
- The project has no framework component layer or ORM; extensions should follow existing small-function and sanitizer patterns.

## Deployment Architecture

The production architecture consists of:

- GitHub `main` as the production source branch
- AWS Lightsail running the Node application
- PM2 managing the application process
- Caddy terminating HTTPS and proxying to Node on localhost
- RDS PostgreSQL storing clinical application state
- S3 storing uploaded documents
- Environment variables and production secrets supplied outside source control

The repository contains the Lightsail deployment runbook but no checked-in GitHub Actions workflow. Any automated main-branch deployment behavior must therefore be confirmed in the GitHub or server environment before deployment-related changes are made.

## Development Constraints

- Do not modify production data during development or inspection.
- Do not run migrations without explicit approval.
- Do not deploy, commit, or push unless explicitly requested.
- Preserve backward compatibility with existing application-state records.
- Prefer extending current state, API, audit, and UI patterns.
- Do not rewrite working code.
- Do not refactor unrelated modules.
- Add narrow tests for every scheduling phase.
- Implement Scheduling as workspace functionality inside the existing application and deployment.
- Do not create a separate Scheduling authentication system, database, client directory, or staff directory.
- Keep each roadmap phase independently reviewable and do not bundle later workspace business logic into the shell phase.
- Keep scheduling records separate from clinical sessions.
- Never treat an appointment as proof that a clinical service occurred.
- Never change finalized clinical documentation because an appointment changes.
- Do not infer provider identity from free-text therapist names.
- Treat PHI as sensitive in logs, exports, browser state, and error messages.
