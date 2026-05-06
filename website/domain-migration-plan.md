# Triumph Domain Migration Plan

Current state checked on May 6, 2026:

| Host | Current target | Purpose |
| --- | --- | --- |
| `triumphbehavioral.com` | `198.49.23.145`, `198.185.159.144`, `198.185.159.145`, `198.49.23.144` | Squarespace public website |
| `www.triumphbehavioral.com` | `ext-sq.squarespace.com` resolving to Squarespace IPs | Squarespace public website redirect |
| `app.triumphbehavioral.com` | `100.51.246.1` | Production clinical webapp |

The app is live at `https://app.triumphbehavioral.com` and is served through Caddy, which reverse proxies to the Node app on `127.0.0.1:3000`.

## Recommended Migration Strategy

Keep the app subdomain independent from the marketing website cutover.

1. Deploy the new static website to a temporary preview URL.
2. Verify the static website on the preview URL.
3. Point only `triumphbehavioral.com` and `www.triumphbehavioral.com` to the new website host.
4. Leave `app.triumphbehavioral.com` pointed at the current app server unless we are intentionally moving the app too.
5. Smoke test both surfaces after DNS changes:
   - `https://triumphbehavioral.com`
   - `https://www.triumphbehavioral.com`
   - `https://app.triumphbehavioral.com`

## If DNS Stays At Squarespace

This is the lowest-change path.

- Remove the Squarespace website records for the root and `www`.
- Add the records required by the chosen static host for:
  - `triumphbehavioral.com`
  - `www.triumphbehavioral.com`
- Do not change the `app` A record.
- Do not change email-related records such as MX, SPF, DKIM, DMARC, or Google/Microsoft verification TXT records.

## If DNS Moves To Cloudflare

This is a bigger migration because all DNS records move, not just the website.

Before changing nameservers:

- Copy every existing DNS record from Squarespace into Cloudflare.
- Confirm these records exist in Cloudflare before cutover:
  - `app` A record -> `100.51.246.1`
  - any MX records for email
  - SPF TXT record
  - DKIM TXT/CNAME records
  - DMARC TXT record
  - Google/Microsoft/other verification TXT records
  - root and `www` records for the new website host

After nameserver cutover:

- Confirm `app.triumphbehavioral.com` still resolves to `100.51.246.1`.
- Confirm Caddy still has a valid certificate for `app.triumphbehavioral.com`.
- Confirm login, uploads, and core app workflows still work.

## Hosting Choices

For this static website, good options are:

| Host | Notes |
| --- | --- |
| Cloudflare Pages | Great if moving DNS to Cloudflare. Fast and simple once records are copied. |
| Netlify | Very simple static hosting. Can work while keeping DNS at Squarespace. |
| Vercel | Also simple static hosting. Good preview deployments. |
| Existing app server | Possible, but I would keep marketing and clinical app hosting separate for cleaner operations. |

## Simplest Recommended Path

Use Netlify for the public website and keep DNS management at Squarespace for now.

This means:

- Netlify hosts `triumphbehavioral.com` and `www.triumphbehavioral.com`.
- The app stays exactly where it is:

```text
app.triumphbehavioral.com -> 100.51.246.1
```

Netlify will provide the exact root and `www` DNS records after the site is created. Add those to Squarespace DNS, but leave the `app` record and email records alone.

## Safe Cutover Checklist

Before DNS changes:

- Lower TTLs where possible.
- Deploy website to preview URL.
- Confirm mobile and desktop layout.
- Confirm contact links and email form behavior.
- Confirm `app.triumphbehavioral.com` is healthy.
- Take screenshots of all current DNS records.

During DNS changes:

- Change only root and `www` records unless doing a full DNS provider migration.
- Keep the `app` record unchanged or copied exactly.
- Keep email records unchanged or copied exactly.

After DNS changes:

- Visit `https://triumphbehavioral.com`.
- Visit `https://www.triumphbehavioral.com`.
- Visit `https://app.triumphbehavioral.com`.
- Login to the app.
- Upload or open one existing document if testing production app storage.
- Confirm HTTPS certificates are valid on both website and app.
