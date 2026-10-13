# Triumph Behavioral Care Website

This is a standalone static marketing site for Triumph Behavioral Care. It is separate from the clinical webapp in `public/`.

Open `index.html` directly in a browser to preview it.

## Google Analytics 4

`index.html` contains one standard asynchronous Google tag for `G-60KE4Q0RGV`.
Collection is active: `window['ga-disable-G-60KE4Q0RGV'] = false`.
The account owner verified Enhanced Measurement OFF, Google Signals OFF, and
user-provided data collection unavailable for the Health industry category.

The single `config` call sends the initial page view; do not add a second tag or
an additional manual `page_view` event. No custom events or form listeners were
added for analytics. Existing navigation and consultation-email behavior remain
in `script.js`.

Analytics receives a fixed public homepage URL and a fixed marketing-site title.
The tag omits the visitor's URL path, query string, fragment, referrer, and campaign
values. Google signals and advertising personalization are disabled, and the
advertising consent categories are denied. No user ID, user properties, form
values, or patient data are configured. Standard GA4 browser/session identifiers
and analytics cookies still apply; this is not anonymous or cookieless analytics.

### Account settings to preserve

In GA4 **Admin → Data streams → select the web stream for G-60KE4Q0RGV**, keep
**Enhanced measurement off**. This prevents automatic form, outbound-link,
site-search, scroll, video, download, and history-change tracking. In particular,
the site's contact flow uses a `mailto:` URL containing form values, so automatic
link tracking must remain off. The snippet's initial page view still works.
`send_page_view` alone does not disable Enhanced Measurement.

**User-provided data collection** is unavailable for this property's Health
industry category. If it becomes available, leave it and automatic detection off.
Keep Google Signals off. Do not enable Ads links, remarketing, or extra tags for
this installation. These account-side settings are separate from the static site.

If automatic interaction events appear in subsequent checks, set
`window['ga-disable-G-60KE4Q0RGV'] = true` in `index.html` and recheck the stream
settings. The opt-out switch stops Analytics
collection but the Google tag library itself still downloads.

Google references: [page views](https://developers.google.com/analytics/devguides/collection/ga4/views),
[configuration](https://developers.google.com/analytics/devguides/collection/ga4/reference/config),
and [Enhanced Measurement](https://support.google.com/analytics/answer/9216061).

### Local verification

From the repository root, serve only the marketing directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory website
```

1. With collection active, open
   `http://127.0.0.1:8080/?privacy_probe=TEST_ONLY&utm_term=TEST_ONLY#TEST_ONLY`.
   Use synthetic values only. Local requests will count in this GA4 property and
   report the fixed public URL, so keep test visits brief.
2. In browser DevTools → Network, confirm exactly one `gtag/js?id=G-60KE4Q0RGV`
   load. Filter by `collect`; inspect the request query string and POST payload.
   Confirm `tid=G-60KE4Q0RGV`, one initial `en=page_view`,
   `dl=https://triumphbehavioral.com/`, and
   `dt=Triumph Behavioral Care | Public Website`. Referrer (`dr`), user ID (`uid`),
   campaign values, and `TEST_ONLY` must be absent or empty.
3. Navigate between section anchors and fill the form with dummy values. Confirm
   no extra page views, `form_start`, `form_submit`, `click`, or `view_search_results`
   events and no field values. Do not send the prepared email. GA4 may still send
   built-in session/engagement signals; the site adds no custom events.
4. Check GA4 Realtime for the visit; reporting can lag and blockers can prevent
   collection. Verify the mobile menu and consultation-email behavior still work.
   Stop the local server with Ctrl+C.

To inspect just the queued setup without recording a visit, block
`*googletagmanager.com*` and `*google-analytics.com*` in DevTools before loading,
then inspect `window.dataLayer`. This confirms configuration, not GA4 delivery.

Activation verification on 2026-10-13: desktop (1440px) and mobile (390px)
browser checks loaded the actual Google tag and intercepted all collection
requests before delivery. Each run loaded one tag and one configuration and
produced one `page_view`, plus GA4's built-in `user_engagement` signals. Form
entry/submission, anchor/history navigation, scrolling, and an outbound-link
click produced no enhanced-measurement events. Synthetic query, fragment,
campaign, referrer, and form values were absent from request URLs and payloads.
Mobile navigation and the consultation-email preparation still worked; SEO,
page content/layout, and Search Console verification were unchanged. These
checks validate outbound requests, not receipt in GA4 Realtime.

## Files

- `index.html` - Homepage content and structure.
- `styles.css` - Custom visual system matched to the webapp.
- `script.js` - Mobile navigation and consultation email behavior.
- `assets/` - Local logo and social-sharing image assets.
- `robots.txt` - Search crawler instructions for static hosting.
- `sitemap.xml` - Minimal sitemap for the one-page launch site.
- `domain-migration-plan.md` - DNS migration plan that keeps `app.triumphbehavioral.com` safe.
- `NETLIFY_DEPLOY.md` - Simplest Netlify launch steps.
- `squarespace-custom.css` - CSS-only option for the current Squarespace site.
- `site-style-notes.md` - Notes from inspecting the live Squarespace site.

## Next Deployment Options

- Netlify
- Vercel
- Cloudflare Pages
- AWS Amplify
- Static hosting from the existing Node app under a separate route

## Launch Checklist

- Point `triumphbehavioral.com` at the chosen host.
- Confirm the canonical URL and sitemap URL match the final domain.
- Replace the `mailto:` consultation flow with a secure form endpoint before collecting anything beyond general inquiries.
- Confirm privacy/contact language with counsel or compliance support before launch.
