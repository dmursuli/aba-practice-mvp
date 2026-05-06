# Triumph Behavioral Website

This is a standalone static marketing site for Triumph Behavioral. It is separate from the clinical webapp in `public/`.

Open `index.html` directly in a browser to preview it.

## Files

- `index.html` - Homepage content and structure.
- `styles.css` - Custom visual system matched to the webapp.
- `script.js` - Mobile navigation and consultation email behavior.
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
