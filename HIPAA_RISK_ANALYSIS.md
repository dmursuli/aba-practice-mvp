# HIPAA Risk Analysis

Date: 2026-05-08
Application: Triumph Workspace
Environment: Production Lightsail app + RDS PostgreSQL + S3 + AWS Secrets Manager
Prepared by: Drafted in Codex for review by practice owner/admin

## Purpose

This document is a practical HIPAA Security Rule risk analysis starter for the current application stack. It identifies where ePHI may live, the main threats to confidentiality, integrity, and availability, the current safeguards already in place, the most important gaps, and the next remediation steps.

This is a working document and should be reviewed and updated whenever:

- a new feature affects PHI
- a new user role is added
- infrastructure changes
- a new vendor/service is introduced
- incidents or near misses occur

## System Summary

- Application server: AWS Lightsail
- Reverse proxy / HTTPS: Caddy
- Database: AWS RDS PostgreSQL
- File/document storage: AWS S3
- Secrets: AWS Secrets Manager
- DNS/domain: external domain provider
- Access method: browser-based web app

## ePHI Data Inventory

Potential ePHI in this app includes:

- client demographics
- diagnosis and assessment information
- session data
- SOAP notes
- 97155/97156 notes
- treatment plans
- funder reports
- uploaded documents
- caregiver interview / intake information

Potential ePHI may also exist outside the app in:

- downloaded exports
- backups
- browser cache
- local devices used by staff

## Risk Rating Scale

- High: likely or high-impact issue that should be remediated before broad PHI use
- Medium: meaningful risk that should be scheduled and documented soon
- Low: currently reduced risk, still monitor

## Risk Register

| Asset / Process | ePHI? | Threat / Vulnerability | Current Safeguards | Risk | Recommended Remediation | Owner | Target |
|---|---|---|---|---|---|---|---|
| AWS root and admin access | Yes (indirect) | Account compromise could expose entire environment | AWS account exists, infrastructure isolated in AWS | High | Enable MFA for root and all admin IAM users; confirm least-privilege access; remove unused credentials | Owner/Admin | Immediate |
| App user accounts | Yes | Weak passwords, stale accounts, shared credentials, excess access | Role-based access exists; inactive status available | High | Enforce strong passwords; remove test/starter users; reset suspicious accounts; review all user access; create offboarding process | Owner/Admin | Immediate |
| Lightsail server | Yes | Server compromise, outdated packages, SSH exposure, misconfiguration | HTTPS enabled through Caddy; app isolated on server | High | Restrict SSH to known IPs; keep OS patched; document patch cadence; consider additional monitoring | Owner/Admin | Immediate |
| RDS PostgreSQL | Yes | Unauthorized DB access, bad credentials handling, failed backups | Separate managed DB; SSL in use; Secrets Manager available | High | Confirm password rotation process; verify security group restrictions; document backup retention; perform restore test | Owner/Admin | Immediate |
| S3 document storage | Yes | Unauthorized document access, misconfigured bucket permissions, unsecured downloads | S3-backed document storage configured | High | Verify bucket is not public; confirm object access is app-controlled only; document retention/deletion policy | Owner/Admin | Immediate |
| Secrets management | Yes (indirect) | Exposed credentials or secrets drift | AWS Secrets Manager in use | Medium | Rotate secrets on schedule; document where each secret is used; verify no secrets remain in code/local notes | Owner/Admin | Soon |
| Local laptops / desktops used by staff | Yes | Lost/stolen device, weak device password, no disk encryption, PHI downloads | Unknown / not formally documented | High | Require device passcode, disk encryption, auto-lock, OS updates, and approved-device policy | Owner/Admin | Immediate |
| Browser sessions | Yes | Shared computers, unattended sessions, cached PHI | Login required; logout exists | Medium | Review session timeout behavior; prohibit shared logins; train staff to log out on shared devices | Owner/Admin | Soon |
| Audit logging | Yes (metadata) | Inability to investigate inappropriate access or changes | Audit log feature exists | Medium | Verify logging of login success/failure, user changes, note edits, exports, deletions; assign review cadence | Owner/Admin | Soon |
| Exports / downloaded files | Yes | Files copied to local machines and left unsecured | Export functionality exists | High | Create export handling policy; limit who can export; store exports only on encrypted devices; review whether all exports are necessary | Owner/Admin | Immediate |
| Backups and restore | Yes | Data loss, ransomware, inability to recover operations | Backup/export tooling exists in app; AWS services available | High | Verify production backups; test restore procedure; document recovery steps and responsible person | Owner/Admin | Immediate |
| Multi-agency use in one environment | Yes | Cross-organization data exposure | Not enabled as formal tenant model | High | Do not mix agencies in one environment until tenant isolation is designed; prefer separate deployment per agency for now | Owner/Admin | Immediate |
| Staff training / policies | Yes | Secure system used insecurely in practice | Informal knowledge only | High | Create written policies for access, device security, incident response, exports, and offboarding | Owner/Admin | Soon |

## Current Strengths

- HTTPS is enabled for production
- production app, database, and file storage are separated
- role-based application access exists
- BCBA/Admin workflows are being actively reviewed
- secrets are not intended to live in source code
- draft operational and audit features already exist

## Key Gaps

The most important current gaps to close before treating the system as PHI-ready are:

1. MFA and AWS account hardening
2. formal user/password/offboarding controls
3. documented backup and restore validation
4. local device security requirements
5. written incident response and breach response workflow
6. audit log review process
7. export/download handling policy

## Immediate Remediation Plan

### 1. Access and identity

- enable MFA for AWS root account
- enable MFA for AWS admin/IAM users
- remove all test/starter accounts from production
- confirm every active user is a real named person
- reset passwords for any questionable accounts

### 2. Infrastructure hardening

- restrict SSH to known IPs only
- verify Lightsail, RDS, and S3 access rules
- rotate database password and document rotation steps
- confirm secrets are only stored in Secrets Manager and env config, not in notes/files

### 3. Data protection and recovery

- verify backup process for database and documents
- perform one restore test with non-production data if possible
- document restore steps, who can do them, and how long recovery should take

### 4. Operational policy

- create a short acceptable-use/device policy
- create user provisioning/offboarding checklist
- create export/download handling rules
- create incident escalation process

### 5. Monitoring and review

- review audit log coverage
- define who checks logs and how often
- define how suspicious access is escalated

## Step 2 Recommendation

After this risk analysis is reviewed, the next implementation step should be:

1. MFA on AWS and admin accounts
2. SSH lock-down
3. production user/account cleanup
4. backup + restore verification

## Review / Approval

- Reviewer:
- Date reviewed:
- Approved by:
- Next review date:
