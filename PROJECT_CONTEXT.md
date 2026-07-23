# Project Context

## Application

Triumph Behavioral Care operates an existing production ABA practice-management web application. The application supports clinical data collection, treatment-plan management, documentation, reporting, and administrative review.

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
- Keep scheduling records separate from clinical sessions.
- Never treat an appointment as proof that a clinical service occurred.
- Never change finalized clinical documentation because an appointment changes.
- Do not infer provider identity from free-text therapist names.
- Treat PHI as sensitive in logs, exports, browser state, and error messages.
