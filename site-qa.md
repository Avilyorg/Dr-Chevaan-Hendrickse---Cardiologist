# Pre-Launch QA Review — Static Site (Cloudflare Launch Kit)

> Paste this **entire file** into a fresh Claude Code session opened against the site's repo, after
> the launch runbook (`cloudflare-site-launch.md`) has completed and `verify-launch.js` passes.
>
> `verify-launch.js` proves the **build** is correct (SEO tags, schema, headers, honeypot). This
> document is the **quality** pass: does the site actually work and look finished for a human?
> Run it before the client sees the site, and again before any re-launch.

You are a senior website QA specialist and front-end reviewer. Perform a full pre-launch quality
assurance review of this website. Go page by page. Be thorough and critical — treat this as the final
gate before a professional client sign-off.

---

## Inputs

- The site repo (you are in it).
- `site.config.yaml` — the source of truth for business name, phone numbers, email, address,
  schema type, and the `pages[]` table. Every contact detail on the site must agree with it.
- **The client's content document**, if the operator has one. Ask for it. If provided, diff the live
  copy against it — missing paragraphs, wrong headings, and stale service names are common and are
  invisible to every automated check.

---

## Step 1 — Automated sweep

```bash
node scripts/qa-audit.js
```

This reports what can be proven from the files: dead internal links, dead in-page anchors, placeholder
links (`href="#"`, `example.com`), missing image files, `<img>` without `alt` or dimensions, malformed
or mismatched `tel:`/`mailto:` links, lorem/TODO content, `target="_blank"` without `rel="noopener"`,
and the agency footer credit. Blockers exit non-zero.

Fix (or consciously accept) everything it reports **before** starting the manual review — otherwise
you'll spend the visual pass rediscovering the same problems.

---

## Step 2 — Page-by-page review

Work through every page in `pages[]`, plus `404.html` and `thank-you.html`. For each, check:

### General

- Every internal link goes to the right page; every external link opens the right site in a new tab.
- Phone links are `tel:` with the E.164 number, and the **displayed** text matches
  `phone_display` in the config. Same for every branch in `locations[]`.
- Email links are `mailto:` and match `contact.email`. WhatsApp links use `https://wa.me/<E.164 digits>`.
- Buttons, nav items (including dropdowns), social icons, and CTAs all do something — no dead
  hover-only menus, no buttons that scroll nowhere.
- No placeholder links, missing images, broken icons, or dummy copy.
- Every page loads with the shared header/footer and no console errors.
- Copy matches the client's content document.

### Mobile responsiveness

Check at **360px**, **390px**, and **768px** (and one desktop width for comparison):

- Content stacks cleanly — no horizontal scrollbar, no text or image overflowing its container.
- Spacing, padding, and margins stay proportionate; no giant empty gaps, no crowded blocks.
- Body text stays readable (≈16px minimum); headings don't wrap into single-word lines.
- Tap targets are at least ~44×44px and not overlapping.
- The mobile nav menu opens, **scrolls** when it's taller than the viewport, and closes again.
- Sliders, tabs, accordions, popups, and any interactive element work by touch.
- Sticky headers, floating CTAs, and cookie banners don't cover content or block buttons.

### Layout & design consistency

- Heading sizes follow one scale across every page; the same button style everywhere.
- Section spacing is consistent — sections don't randomly have twice the padding of their neighbours.
- Image proportions and crops are right; no stretched or squashed photos.
- Content containers line up — the same left edge down the page.
- Look for uneven gaps, misalignment, and anything that reads as "unfinished".

### HTML / front-end cleanup

- Remove empty tags, redundant wrapper `<div>`s, duplicate spacer elements, and dead code.
- No invalid nesting (e.g. a `<div>` inside a `<p>`, a block element inside an `<a>` that also
  wraps block content).
- Semantic markup where it's cheap: `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`.
- Exactly one `<h1>` per page; heading levels don't skip.

### Performance & final polish

- Every `<img>` has `width`/`height` (the `<picture>` rewrite from Phase 6 should have done this) —
  this is what keeps CLS near zero.
- The LCP image carries `fetchpriority="high"`, not `loading="lazy"`.
- Hero/section CSS `background-image`s use the optimized files via `image-set()` (runbook Phase 6.5) —
  the image pipeline does **not** rewrite them automatically, so this is a routine miss.
- Run Lighthouse on the deployed URL — aim for ≥90 on Performance, Accessibility, Best Practices, SEO.
- Run an accessibility pass (axe DevTools): colour contrast, focus outlines, form labels.

### Footer credit (required)

Every indexable page's footer must carry the Avily "designed by" credit:

- It links to **`https://www.avily.co.za/…`** and the logo is `https://cdn.avily.com/avily-logo-small.png`
  (the old `avily.azureedge.net` URL is retired — it must not appear anywhere).
- It uses the **specialty variant matching this client**, from
  [templates/designed-by-avily.html](templates/designed-by-avily.html): medical, dental, gynaecology,
  psychology, optometry, physiotherapy, paediatrician, or veterinary — derived from
  `site.schema.type` / `site.schema.medical_specialty`. A medical client reads
  "Medical Website Design by [Avily logo]"; a dental client reads "Dental Website Design by …".
  Don't hardcode "Medical" on a non-medical site.
- The copyright year is the dynamic `<span class="current-year">`, not a frozen literal.

---

## Step 3 — Live checks (post-deploy)

- Submit the contact form for real → you land on `/thank-you.html` **and** the email arrives at
  `site.contact.email`. Check the spam folder before declaring failure.
- Submit with a field empty → you get the validation message, not a silent failure.
- `curl.exe -I https://<domain>/` → `strict-transport-security`, `content-security-policy`,
  `cross-origin-opener-policy` all present. (On Windows use `curl.exe`, not the PowerShell alias.)
- `curl.exe -I https://www.<domain>/` → `301` to the canonical host.
- `curl.exe -I https://<domain>/site.config.yaml` (and `/src/worker.js`, `/scripts/inject-seo.js`)
  → **404**. A 200 here is a security blocker; fix `.assetsignore` and redeploy immediately.
- Open a page with a Google Maps embed and one with the contact form → neither is blocked by CSP
  (check the browser console).

---

## Tooling note

The mobile/visual checks need a real browser. Use the `/run` skill or a Playwright/browser MCP if one
is connected — take screenshots at 360/768/1440px and inspect them. If no browser tooling is
available, say so plainly and hand that section to the operator as a manual checklist rather than
guessing from the CSS.

---

## Output

Report back in three parts:

1. **Issues found** — grouped by severity, each with a `file:line` reference and what's wrong:
   - **Blocker** — broken functionality, dead links, missing images, security/privacy exposure,
     wrong contact details, missing footer credit. Cannot launch.
   - **Should fix** — layout breaks on mobile, inconsistent styling, accessibility failures,
     performance regressions. Fix before sign-off.
   - **Nice to have** — polish, minor copy, code cleanup.
2. **Recommended fixes** — concrete, per issue. Where a launch-kit script already fixes it
   (`inject-pictures.js`, `fix-copyright-year.js`, `standardize-forms.js`, …), say so instead of
   hand-editing HTML.
3. **Additional improvements** — anything you'd suggest before launch that isn't strictly a defect.

Do not fix anything until the operator has seen the list and chosen what to apply.
