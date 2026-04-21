# AWS Lightsail Deployment

This is the recommended lower-cost deployment path for the ABA Practice MVP.

Lightsail will host the Node app. RDS will store clinical data. S3 will store uploads and documents.

## What You Already Have

- Domain: `app.triumphbehavioral.com`
- DNS provider: Squarespace
- PostgreSQL RDS:
  - host: `database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com`
  - port: `5432`
  - database: `postgres`
  - user: `aba_admin`
- S3 bucket: `triumph-aba-uploads-prod`
- Secrets Manager:
  - database secret: `aba-practice/prod/database`
  - app secret: `triumph-aba/prod/app`

## 1. Create A Lightsail Instance

In AWS Lightsail:

1. Click **Create instance**
2. Platform: **Linux/Unix**
3. Blueprint: **OS Only**
4. OS: **Ubuntu 24.04 LTS** or **Ubuntu 22.04 LTS**
5. Plan: start with the smallest plan that has at least **1 GB RAM**
6. Name it `triumph-aba-prod`

After it is created:

1. Go to **Networking**
2. Attach a **static IP**
3. Open firewall ports:
   - `22` SSH
   - `80` HTTP
   - `443` HTTPS

Do not open port `3000` to the public internet. Caddy will receive public traffic and forward it to Node privately.

## 2. Point The Domain

In Squarespace DNS, add:

| Type | Host | Value |
| --- | --- | --- |
| `A` | `app` | the Lightsail static IP |

DNS can take time to update.

## 3. Connect To The Server

Use the browser SSH terminal in Lightsail, or connect from Terminal:

```bash
ssh ubuntu@YOUR_LIGHTSAIL_STATIC_IP
```

## 4. Install Server Tools

Run these on the Lightsail server:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## 5. Upload The App Code

The cleanest path is GitHub:

```bash
cd /opt
sudo git clone YOUR_GITHUB_REPO_URL aba-practice
sudo chown -R ubuntu:ubuntu /opt/aba-practice
cd /opt/aba-practice
npm ci --omit=dev
```

## 6. Add Production Secrets

Create a local env file on the server:

```bash
nano /opt/aba-practice/.env.production
```

Paste this, replacing only the secret values:

```bash
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
APP_BASE_URL=https://app.triumphbehavioral.com

DATA_STORE=postgres
DOCUMENT_STORE=s3

DB_HOST=database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=aba_admin
DB_PASSWORD=replace-with-real-db-password
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true

AWS_REGION=us-east-1
S3_BUCKET=triumph-aba-uploads-prod

ALLOW_STARTER_USERS=false
```

Lock the file:

```bash
chmod 600 /opt/aba-practice/.env.production
```

Do not commit `.env.production` to GitHub.

## 7. Give Lightsail AWS Access

The app needs permission to use S3.

For the first MVP launch, create a limited IAM user or role with only these S3 actions:

- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`

Limit the resource to:

```text
arn:aws:s3:::triumph-aba-uploads-prod/*
```

If using access keys, add these to `/opt/aba-practice/.env.production`:

```bash
AWS_ACCESS_KEY_ID=replace-me
AWS_SECRET_ACCESS_KEY=replace-me
```

## 8. Start The App With PM2

Run this from `/opt/aba-practice`:

```bash
set -a
source .env.production
set +a
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

PM2 will print one extra command. Copy and run that command too. That makes the app restart after server reboot.

Check status:

```bash
pm2 status
pm2 logs aba-practice
```

## 9. Configure HTTPS With Caddy

Copy the Caddy config:

```bash
sudo cp /opt/aba-practice/deploy/lightsail/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will automatically request and renew the HTTPS certificate for `app.triumphbehavioral.com`.

## 10. Migrate Existing Local Data

Run this once from your Mac, because your current `data/db.json` lives on your Mac:

```bash
DB_HOST=database-1.co3ksgyeg6vl.us-east-1.rds.amazonaws.com \
DB_PORT=5432 \
DB_NAME=postgres \
DB_USER=aba_admin \
DB_PASSWORD='your-real-db-password' \
DB_SSL=true \
npm run migrate:postgres
```

This copies the current `data/db.json` app data into PostgreSQL.

## 11. Production Smoke Test

Open:

```text
https://app.triumphbehavioral.com
```

Then verify:

- Login works
- Users are real production users
- A client loads
- A session saves
- Graphs update
- SOAP note saves
- Document upload works
- Audit log records actions

## 12. Ongoing Maintenance

At least weekly:

```bash
sudo apt update
sudo apt upgrade -y
pm2 status
```

Useful logs:

```bash
pm2 logs aba-practice
sudo journalctl -u caddy --no-pager -n 100
```

## Common Issues

### The site does not load

Check DNS:

```bash
dig app.triumphbehavioral.com
```

Check Caddy:

```bash
sudo systemctl status caddy
```

Check the app:

```bash
pm2 status
pm2 logs aba-practice
```

### The app cannot connect to RDS

Most likely causes:

- RDS security group does not allow traffic from the Lightsail static IP
- Wrong database password
- RDS is not publicly reachable
- RDS is in a VPC that Lightsail cannot reach

### Uploads fail

Most likely causes:

- S3 permissions are missing
- Wrong bucket name
- AWS access keys are missing from `.env.production`
