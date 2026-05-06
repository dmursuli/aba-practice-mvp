# Netlify Launch Steps

This is the simplest launch path for the new public website while keeping the clinical app online.

## What Stays Untouched

Do not change:

```text
app.triumphbehavioral.com -> 100.51.246.1
```

That record is the production webapp.

## Deploy The Website

1. Go to Netlify.
2. Choose **Add new site**.
3. Choose **Import an existing project**.
4. Connect GitHub.
5. Pick the repo:

```text
dmursuli/aba-practice-mvp
```

6. Netlify should read `netlify.toml` automatically.
7. Confirm:

```text
Publish directory: website
Build command: echo 'Static site: no build required'
```

8. Deploy the site.
9. Open the temporary Netlify preview URL and test it.

## Connect The Domain

In Netlify:

1. Go to the new site.
2. Open **Domain management**.
3. Add:

```text
triumphbehavioral.com
www.triumphbehavioral.com
```

Netlify will show the DNS records it wants.

## Change Squarespace DNS

In Squarespace DNS, change only the public website records:

- Root/apex records for `triumphbehavioral.com`
- `www` record

Do not change:

```text
app.triumphbehavioral.com
```

Do not change email records:

- MX
- SPF
- DKIM
- DMARC
- verification TXT records

## Smoke Test After DNS Changes

Open:

```text
https://triumphbehavioral.com
https://www.triumphbehavioral.com
https://app.triumphbehavioral.com
```

Then login to the app and confirm it still works.

