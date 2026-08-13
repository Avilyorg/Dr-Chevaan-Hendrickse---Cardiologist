# Cloudflare Launch Kit (v3)

A reusable kit for shipping a static site on **Cloudflare Workers** with a hardened worker, a
working reCAPTCHA + SendGrid contact form, full local-SEO JSON-LD, an image pipeline, and a
one-command verification gate.

`cloudflare-site-launch.md` is the **full runbook** — paste it into a fresh Claude Code session
opened on the new site's repo and it executes the phases end-to-end. This README is the quick
reference for doing it (or driving the scripts) by hand.

## What's in here

```
cloudflare-site-launch.md     The full 10-phase runbook (source of truth)
site-qa.md                    Standalone pre-launch QA review prompt (paste into a fresh session)
site.config.example.yaml      Copy to site.config.yaml and edit — single source of truth
package.json                  npm aliases for every script + deps (js-yaml, sharp)
.gitignore.template           Copy to .gitignore
.assetsignore.template        Copy to .assetsignore (security-critical: what the edge serves)

scripts/                      The pipeline (all read site.config.yaml)
  preflight.js                Readiness "doctor": config + templates + tooling + structure
  launch.js                   One-command orchestrator: preflight -> build -> verify
  scaffold-config.js          Generate the pages[] table from existing HTML  -> stdout
  standardize-forms.js        Rewrite every <form> to the handler contract (incl. username->first_name)
  check-forms.js              Fail the build if any form's field names can't be satisfied by the handler
                              + inject v3 scripts + strip legacy reCAPTCHA v2 scaffolding
  build-worker.js             Render src/worker.js from templates/worker.template.js
  build-contact-js.js         Render js/ContactUs.js from the template (substitutes site key)
  build-shell-pages.js        Generate branded 404.html + minimal self-contained thank-you.html
  build-static-files.js       Generate robots.txt + site.webmanifest; copy the web-vitals reporter
  fix-copyright-year.js       Make the footer copyright year dynamic
  optimize-images.js          sharp -> WebP/responsive/JPEG + favicons + og-default.jpg
  inject-seo.js               Per-page <head> SEO + GTM + JSON-LD (idempotent, de-dups heads)
  extract-faqs.js             FAQPage JSON-LD scraped from service pages
  build-sitemap.js            sitemap.xml (with image entries)
  inject-pictures.js          <img> -> <picture> using the optimize-images manifest
  verify-launch.js            Pre-deploy invariant check (gates the launch)
  qa-audit.js                 Pre-launch QA sweep: dead links, missing images, placeholder content,
                              contact-detail drift, footer credit (see site-qa.md for the visual half)
  _lib.js                     Shared config loader + helpers

test/                         Unit tests (node --test, no extra deps)
  _lib.test.js                Config-derivation logic (currency/locale/legal/host)
  worker-template.test.js     Worker renders to valid JS + keeps security invariants

templates/
  worker.template.js          Tokenized worker rendered by build-worker.js
  ContactUs.template.js       Tokenized form handler rendered to js/ContactUs.js by build-contact-js.js
                              (adaptive: reads whatever field names each form uses, per scripts/form-contract.js)
  designed-by-avily.html      Footer "designed by" credit fragments + year script
  privacy-policy.html         Jurisdiction-aware privacy policy template
  terms-and-conditions.html   Jurisdiction-aware T&Cs template

assets/js/
  web-vitals.iife.js          Vendored Core Web Vitals reporter (web-vitals v4 IIFE).
                              build-static-files.js copies it to the site's js/ — every page
                              links it and verify-launch fails without it.
```

## Setup in a new site repo

1. Copy the kit into the repo root:
   - `scripts/`, `templates/`, `assets/`, `package.json`
   - `.gitignore.template` → `.gitignore`, `.assetsignore.template` → `.assetsignore`
   - `site.config.example.yaml` → `site.config.yaml`
   - (`js/ContactUs.js` and `js/web-vitals.iife.js` are generated/copied by the scripts — don't
     place them by hand)
2. Edit `site.config.yaml` (domain, business, address, schema type, GTM, SendGrid, build_date, …).
   **Every value in the example is a placeholder** — `preflight.js` fails on any you leave unchanged.
   Never copy a GTM ID, reCAPTCHA key or phone number over from a previous client.
3. `npm install`

## Quick path (standalone)

```bash
npm install
node scripts/preflight.js     # is this project + config + tooling ready? (gates on failures)
node scripts/launch.js        # preflight -> full build -> verify, in order
```

`launch.js` runs every scriptable step, prints the manual steps it can't do (legal pages, reCAPTCHA
secret, custom domains, deploy), and finishes with `verify-launch`. It never deploys. Flags:
`--no-images` (skip the sharp pipeline), `--skip-preflight`. The step-by-step path below is the same
pipeline run by hand.

## Run order (by hand)

```bash
# 0. Pre-built site? Generate the pages[] table and paste it into site.config.yaml
node scripts/scaffold-config.js

# 1. Worker + form
node scripts/build-worker.js          # -> src/worker.js (LAST_MODIFIED derived from build_date)
node scripts/build-contact-js.js      # -> js/ContactUs.js (substitutes recaptcha_site_key)
node scripts/standardize-forms.js     # normalize every <form>, inject form scripts (also runs build-contact-js)

# 2. SEO / content
node scripts/inject-seo.js            # head SEO + GTM + JSON-LD on every pages[] page
node scripts/extract-faqs.js          # FAQPage on service pages
node scripts/build-shell-pages.js     # 404.html + thank-you.html (skips existing; use --force on a re-launch)
node scripts/build-static-files.js    # robots.txt + site.webmanifest
node scripts/build-sitemap.js         # sitemap.xml
node scripts/fix-copyright-year.js    # dynamic footer year

# 3. Images (needs sharp)  — also creates favicons + og-default.jpg
npm run optimize-images
node scripts/inject-pictures.js       # <img> -> <picture>

# 4. Gate
npm test                              # unit tests for _lib + worker template
node scripts/verify-launch.js         # must pass with 0 failures before deploy

# 5. QA (before the client sees it)
node scripts/qa-audit.js              # dead links, missing images, placeholders, footer credit
                                      # then work through site-qa.md for the visual/page-by-page pass
```

Also create `robots.txt` and `site.webmanifest` from the verbatim snippets in the runbook (Phase 5).
All scripts are idempotent — safe to re-run.

## Manual steps (need the Cloudflare account / keys)

```bash
# Add the reCAPTCHA v3 SECRET key as a WORKER SECRET (Worker → Settings → Variables and Secrets,
# type: Secret). Never a plaintext Variable (wiped on deploy) and never Secrets Store.
# The worker must exist first, so deploy once before this on a new site.
npx wrangler secret put RECAPTCHA_SECRET
# Confirm the SendGrid Secrets Store binding exists on the account (SENDGRID_API_KEY — the only one)
npm install && npm run optimize-images     # if not already run
# Attach apex + www as Custom Domains in the Cloudflare dashboard
npx wrangler deploy
# Post-deploy: curl -I the apex (headers), www (301), and a few /src//*.yaml paths (expect 404)
```

> **Windows / PowerShell:** `curl` is an alias for `Invoke-WebRequest`, which does
> not understand `-I`. Use `curl.exe -I https://example.co.za` (the real curl ships
> with Windows 10/11), or `Invoke-WebRequest -Method Head https://example.co.za`.
> The `node scripts/*.js` and `npx wrangler` commands work as-is in PowerShell.

## Notes

- `site.config.yaml`, `node_modules/`, and `*.md` (except README) are gitignored by the template.
- `.assetsignore` keeps `src/`, `scripts/`, `templates/`, `*.yaml`, etc. off the public edge — verify
  post-deploy that those paths return 404.
- Config knobs: `site.stylesheet` (default `css/styles.css`), `schema.faq_container`,
  `site.images.size_threshold_kb`, `site.agency_credit` (`required`/`match`/`deprecated`).
- **Reusable on any HTML project:** the agency "designed by" credit that `verify-launch` enforces is
  configurable — it defaults to the Avily credit, but set `site.agency_credit.required: false` (or
  override `match`) to launch a non-Avily project without it.
- See `cloudflare-site-launch.md` for the authoritative, fully-explained procedure.
