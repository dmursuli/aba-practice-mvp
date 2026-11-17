# Consultation form

The existing static homepage defines the `consultation` Netlify form directly in
HTML. No build step, dependencies, API keys, functions, or AWS changes are needed.
JavaScript submits URL-encoded fields by same-origin POST to `/`, without query
parameters or a referrer. The contact email and phone remain available as alternatives.
JavaScript must be enabled; otherwise the page offers the phone number.

## Configuration before launch

1. In the existing Netlify site's Forms settings, enable form detection, then
   deploy through the existing workflow after review. Publish directory stays `website`.
2. Confirm the `consultation` form and honeypot extra spam protection appear in
   Netlify. All fields, including hidden attribution fields, are in the HTML.
3. Check the account's plan and Forms usage. Configure a form email notification
   to the practice's chosen recipient in Netlify if desired; no notification is
   configured by this code. Limit dashboard access to staff handling inquiries.
4. Preserve GA4 Enhanced Measurement OFF, Google Signals OFF, user-provided data
   collection OFF/unavailable, and existing denied advertising consent. See README.
   Do not add form tracking, Ads pixels, user IDs, or form values to analytics.

## Field contract for a future n8n integration

| Field | Meaning |
| --- | --- |
| `form-name` | `consultation`, stable form identity |
| `name` | Required name, up to 120 characters |
| `email` | Required email address |
| `phone` | Required phone, 7-15 digits with permitted formatting |
| `preferred_contact_method` | Required `Email` or `Phone` |
| `privacyAcknowledgment` | Required `acknowledged` |
| `referral_source` | Required self-reported dropdown selection |
| `message` | Optional multiline inquiry, up to 1,000 characters |
| `utm_source`, `utm_medium`, `utm_campaign` | Optional captured campaign labels |
| `landing_page` | Sanitized public homepage URL |
| `submitted_at` | Browser-generated UTC ISO timestamp; not an authoritative server time |
| `bot-field` | Honeypot; must be empty |

Referral source is never inferred from or overwritten by UTM values. Attribution
is captured on page load in memory, with no cookies or browser storage added.
Only bounded alphanumeric campaign labels with spaces, underscores, or hyphens
are accepted; email/URL-like values and phone-like digit sequences are discarded.
Campaign labels must never contain personal information. Arbitrary names cannot
be reliably identified as personal data by a character filter. The landing URL is
normalized to the canonical homepage: no arbitrary path, query, or fragment is retained.
Nothing from these fields is passed to GA4, advertising tools, or navigation URLs.

Future flow (not implemented): verified Netlify submission -> authenticated
server-side receiver -> n8n inquiry workflow. Use Netlify's submission ID for
deduplication, server receipt time for ordering, validate fields again, and ignore
spam. Hidden inputs and browser validation are untrusted. Keep receiver secrets
out of the static site, restrict workflow access, redact execution logs, and set
an appropriate retention policy. Do not route inquiry details into marketing
analytics. No webhook, notification, n8n account, or paid integration is created.

## Submission behavior and verification

Run `node website/qa/contact-form.cjs` from the repository root using the existing
Playwright installation. It starts and stops a temporary local server, intercepts
all submissions, and blocks external traffic. Screenshots are written under `/tmp`.
Automated checks passed at 1440, 820, 390, and 320 pixel widths, including validation,
honeypot blocking, attribution, delayed success, duplicate prevention, HTTP/network
failures, timeout, homepage fallback, navigation, and local image paths. Desktop
and mobile screenshots were visually reviewed. No live submissions were sent.

The form uses native required/email/format validation plus name/phone checks.
While sending, its button is disabled and duplicate events are ignored. A 20-second
timeout, network failure, HTTP error, or homepage fallback leaves entries intact
and offers retry/phone contact. Success is announced in a focused live region only
after a successful HTTP response; the form clears and further sends on that page
are blocked. There are no automatic retries: a timeout can occur after receipt.
This UI response cannot prove storage, spam classification, or email delivery.

Local checks should intercept POST `/` using synthetic contact data. Cover delayed
success, duplicate submissions, 4xx/5xx, offline/timeout, and HTTP 200 returning
the homepage. Check required fields, email/phone validity, required referral source,
optional inquiry length and inclusion in the POST body,
honeypot blocking, attribution sanitization, unchanged URL, and desktop/tablet/mobile
overflow. Block Google collection during local tests to avoid polluting analytics.
Static HTML inspection confirms detection markup only, not Netlify's deployed parser.

After an approved deployment, send one synthetic inquiry on the production domain.
Confirm the record and every field in Netlify's Verified submissions (also inspect
Spam), then verify the configured notification separately. Test a filled honeypot
against Netlify directly with synthetic data to confirm server-side rejection.
Check Network for no contact values in Analytics requests or URLs. Check the form
on a real phone. Remove synthetic submissions afterwards. None of those production
storage/delivery checks have been performed as part of this local implementation.

## Pricing and usage checked November 17, 2026

Netlify's current documentation says Forms are free and unlimited on credit-based
plans. Legacy plans meter verified submissions and upload storage per site; paid
legacy tiers can automatically upgrade when limits are reached, and free legacy
tiers have limits. The site's actual plan has not been inspected. Confirm it in
the account before launch. Ordinary hosting usage and plan restrictions still
apply. This form has no file uploads and introduces no additional paid service.

Official references:
- [Forms usage and billing](https://docs.netlify.com/manage/forms/usage-and-billing/)
- [Credit-based pricing](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Form detection and AJAX setup](https://docs.netlify.com/manage/forms/setup/)
- [Spam filtering and honeypots](https://docs.netlify.com/manage/forms/spam-filters/)
- [Notifications](https://docs.netlify.com/manage/forms/notifications/)
