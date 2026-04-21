# AWS App Runner Deployment

This app is ready to deploy as a small production container on AWS App Runner.

## Why App Runner

- Simple for an MVP
- HTTPS included
- Easy custom domain mapping
- Good fit for one Node server
- Keeps the app private from direct server management

## What You Already Have

- Domain: `app.triumphbehavioral.com`
- ACM certificate: issued
- PostgreSQL:
  - host: `database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com`
  - port: `5432`
  - database: `postgres`
  - user: `aba_admin`
- S3 bucket: `triumph-aba-uploads-prod`
- Secrets Manager:
  - database secret: `aba-practice/prod/database`
  - app secret: `triumph-aba/prod/app`

## Recommended Secret Layout

`aba-practice/prod/database`

```json
{
  "DB_PASSWORD": "replace-me"
}
```

`triumph-aba/prod/app`

```json
{
  "ALLOW_STARTER_USERS": "false"
}
```

You can add more app-only secrets later if needed.

## 1. Push The Code To GitHub

App Runner deploys most easily from GitHub.

Create a repository, then upload this project.

## 2. Create App Runner Service

In AWS Console:

1. Open **App Runner**
2. Click **Create service**
3. Source: **Source code repository**
4. Connect your GitHub repo
5. Branch: your production branch
6. Deployment trigger: **Manual** for first launch

### Build settings

Use the included `Dockerfile`.

### Service settings

- Port: `3000`
- CPU: start with `1 vCPU`
- Memory: start with `2 GB`

## 3. Add Environment Variables

In the App Runner service configuration, add:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `3000` |
| `APP_BASE_URL` | `https://app.triumphbehavioral.com` |
| `DATA_STORE` | `postgres` |
| `DOCUMENT_STORE` | `s3` |
| `DB_HOST` | `database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `postgres` |
| `DB_USER` | `aba_admin` |
| `DB_SSL` | `true` |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` |
| `AWS_REGION` | `us-east-1` |
| `S3_BUCKET` | `triumph-aba-uploads-prod` |

## 4. Add Secrets

Add App Runner secrets from AWS Secrets Manager:

- `DB_PASSWORD` from `aba-practice/prod/database`
- `ALLOW_STARTER_USERS` from `triumph-aba/prod/app`

If your secret uses JSON, map the specific key from the secret.

## 5. Networking

### Outbound access to PostgreSQL

Your App Runner service must be able to reach the RDS instance.

Recommended setup:

- Put the RDS instance in private subnets
- Create an **App Runner VPC connector**
- Attach it to the same VPC/subnets that can reach RDS
- Update the RDS security group to allow PostgreSQL `5432` from the App Runner connector security group

### S3 access

Attach an IAM role to App Runner with access to:

- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`

restricted to:

- bucket `triumph-aba-uploads-prod`
- objects `arn:aws:s3:::triumph-aba-uploads-prod/*`

## 6. Custom Domain

After the service is live:

1. Open the App Runner service
2. Go to **Custom domains**
3. Add `app.triumphbehavioral.com`
4. Add the DNS records AWS gives you in Squarespace

## 7. Migrate Existing Data

Run the migration once from your Mac after you have the real database password:

```bash
DB_HOST=database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com \
DB_PORT=5432 \
DB_NAME=postgres \
DB_USER=aba_admin \
DB_PASSWORD='your-real-password' \
DB_SSL=true \
npm run migrate:postgres
```

This copies the current `data/db.json` contents into PostgreSQL.

## 8. Production Smoke Test

After deployment:

1. Open `https://app.triumphbehavioral.com`
2. Sign in with a real production user
3. Open an existing client
4. Create one test session
5. Confirm graph update
6. Confirm document upload works
7. Confirm SOAP save/finalize works
8. Confirm audit log records the actions

## 9. Before Real PHI

- Replace starter users with real production accounts
- Verify backups
- Verify RDS encryption and automated snapshots
- Verify S3 encryption and least-privilege IAM
- Verify App Runner logs are flowing to CloudWatch
- Verify domain is HTTPS-only
- Verify only approved staff have access

## 10. Likely First Issue

If App Runner starts but cannot connect to the database, the most likely cause is VPC/security-group routing between App Runner and RDS.
