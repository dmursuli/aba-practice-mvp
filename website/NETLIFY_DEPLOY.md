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

## Automatic deployment filtering

The root `netlify.toml` sets:

```toml
[build]
  publish = "website"
  command = "echo 'Static site: no build required'"
  ignore = "bash ./scripts/netlify-ignore.sh"
```

Keep the base directory at the repository root (unset/default) and automatic
publishing enabled. The Bash/Git guard needs no dependency installation. Netlify
runs it before the build: exit 0 skips; exit 1 continues normal deployment.

The guard compares `CACHED_COMMIT_REF` (last built commit) with `COMMIT_REF`,
covering the full range since the last build. Changes to any file under
`website/`, root `netlify.toml`, or `scripts/netlify-ignore.sh` trigger deployment.
Clinical application code, its tests, AWS files, root package manifests, and
unrelated documentation alone are skipped. Website documentation counts as a
website change. If future website build inputs live elsewhere, add their paths
to the guard and its tests.

Initial builds, absent/invalid/unavailable refs, identical refs (including builds
without cache), mismatched checkouts, divergent/incomplete history, and Git errors
all continue deployment. No network fetch or dependency installation is needed.
Netlify build hooks bypass ignore commands; this filtering targets Git-triggered
builds. Retry without cache when intentionally rebuilding unchanged content or
after changing dashboard-only settings.

Run regression tests from the repository root:

```sh
node --test tests/netlify-ignore.test.mjs
bash -n scripts/netlify-ignore.sh
```

The tests use temporary Git repositories and are also included in `npm test`.
Publish output, redirects, headers, analytics, and the `consultation` form are
unchanged. Skipping a build leaves the existing published site and form in place;
allowed builds still use normal Netlify HTML form detection and post-processing.

After this configuration reaches `main`, verify in Netlify:

1. The resolved configuration uses the root config, `website` publish directory,
   and the ignore command above; this configuration commit should deploy.
2. On the next clinical-only Git push with a usable cache, the log says
   `Netlify: skip (website and deployment configuration unchanged).` and the
   build stops before publishing. A skipped/canceled entry may still appear.
3. On a website change, the log says deploy and the new site publishes normally.
4. Form detection remains enabled and `consultation` remains registered. Follow
   `website/CONTACT_FORM.md` for a synthetic submission/storage verification.

References: [Netlify ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)
and [Git metadata variables](https://docs.netlify.com/build/configure-builds/environment-variables/#git-metadata).
