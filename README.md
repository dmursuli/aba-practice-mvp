# ABA Practice MVP

A lightweight ABA practice web app focused on client setup, treatment-plan management, session data entry, graphing, SOAP notes, parent training, and funder reports.

## Features

- Client management with profile details, authorization metadata, approved hours/units, and assessment tracking.
- Admin practice backup export and restore from Client Management for quick local safety copies.
- Admin user management for creating users, assigning roles, deactivating accounts, and resetting passwords.
- Data Health view for admin and BCBA review of missing notes, draft notes, signatures, authorization dates, treatment-plan gaps, and graph-data gaps.
- Session entry for client, date, therapist, time, setting, caregiver presence, barriers, caregiver training, and notes.
- Client-specific treatment plans with target statuses: active, maintenance, mastered, and paused.
- Program-level objectives for BCBA-authored treatment goals.
- Session target rows are grouped behind domain tabs: Functional Communication, Visual Perceptual Skills, Transition Tolerance, and Listener Responding.
- Session behavior rows preload all active behaviors so therapists can delete behaviors that were not tracked.
- Treatment plan changes can generate an editable 97155 note documenting added programs/targets and target status changes.
- Session forms preload active targets for the selected client so therapists can delete targets that were not implemented.
- Maintenance targets can be added to a session when probed.
- Duplicate targets are blocked within the same session.
- Target-level trials, correct/incorrect responses, prompt level, and auto-calculated independence.
- Individual skill acquisition graphs per program, with targets plotted on the program graph.
- Multiple behavior targets per session with frequency plus optional duration and intensity.
- Client profile with session history, skill acquisition graphs, behavior frequency graphs, and editable 97153/97155/97156 notes.
- Funder report generator with behavior graphs, skill graphs, parent training progress, narratives, recommendations, discharge criteria, fade-out plan, print/PDF flow, and text/HTML exports.
- Audit log for admin and BCBA review of client, document, treatment plan, session, note, report, and export actions, including before/after snapshots for high-risk edits.
- Local JSON data store for pilot use, with production PostgreSQL and S3 adapters for AWS deployment.

## Pilot Launch

```bash
npm start
```

Then open:

[http://localhost:3000](http://localhost:3000)

Install dependencies once before first launch:

```bash
npm install
```

## Daily Use

1. Start the app with `npm start`.
2. Open [http://localhost:3000](http://localhost:3000).
3. Sign in with the role you need.
4. Use **Clients** to create or select the client when signed in as admin.
5. Use **Treatment plan** to set domains, programs, objectives, targets, behaviors, and RBT feedback areas when signed in as admin or BCBA.
6. Use **Session**, **Treatment plan**, or **Parent Training** for service entry.
7. Review **Graphs**, **SOAP Notes**, and **Funder Report** as needed.
8. Run `npm run backup` at the end of the day.

## Starter Local Accounts

These starter accounts are created automatically the first time the app runs after the login feature is added:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Admin |
| `bcba` | `bcba123` | BCBA |
| `rbt` | `rbt123` | RBT |
| `readonly` | `readonly123` | Read-only |

Passwords are hashed in `data/db.json`. Sign in as admin and use **Users** to replace starter passwords, create real accounts, deactivate users, and assign roles.

## Data

Local seed and session data live in `data/db.json`.

Backups created by `npm run backup` live in `backups/`.

Admins can also download or restore a JSON practice backup from **Clients**. That browser backup includes practice data and uploaded document metadata, while preserving current login users/passwords during restore. Use `npm run backup` when you need the full local backup that also copies uploaded files.

## Checks

```bash
npm run check
npm run backup
```

## AWS Production Preparation

The app can run in local JSON mode or AWS production mode.

Local mode:

```bash
npm start
```

Production mode expects PostgreSQL and S3 configuration through environment variables or secrets injected into the runtime:

```bash
NODE_ENV=production
DATA_STORE=postgres
DOCUMENT_STORE=s3
DB_HOST=database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=aba_admin
DB_PASSWORD=...
DB_SSL=true
AWS_REGION=us-east-1
S3_BUCKET=triumph-aba-uploads-prod
HOST=0.0.0.0
PORT=3000
```

To migrate the current local JSON data into PostgreSQL after the database secret values are available:

```bash
npm run migrate:postgres
```

Production startup blocks starter accounts by default. Migrate existing users or create production users before starting with `NODE_ENV=production`.

## AWS Lightsail

The recommended low-cost production path for this MVP is AWS Lightsail for the Node app, RDS PostgreSQL for clinical data, and S3 for uploads.

See the deployment runbook:

- [`DEPLOY_AWS_LIGHTSAIL.md`](/Users/diegomursuli/Documents/New%20project/DEPLOY_AWS_LIGHTSAIL.md)

The App Runner Docker setup is still available as an alternate managed deployment path.

## Production Note

This is moving toward AWS production deployment for PHI. Keep using fake data until PostgreSQL, S3, HTTPS, Secrets Manager, backups, monitoring, and access controls have been deployed and verified under the signed BAA.

## Scope

Version 1 intentionally excludes billing, scheduling, and parent portals.
