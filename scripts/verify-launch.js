// scripts/verify-launch.js
//
// Final pre-deploy invariant check. Asserts that all 8+ phases produced
// the expected markers. Exits non-zero on any failure so CI can gate on it.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig, readHtml } = require("./_lib.js");
const { collectFormIssues } = require("./check-forms.js");

const cfg = loadConfig();
const fails = [];
const passes = [];
const warns = [];

function pass(msg) { passes.push(msg); }
function fail(msg) { fails.push(msg); }
function warn(msg) { warns.push(msg); }

// --- Per-page checks ---

for (const page of cfg.pages) {
  const f = readHtml(page.slug);
  if (!f) { fail(`${page.slug} — file missing`); continue; }
  const c = f.content;

  // GTM head + noscript
  if ((c.match(new RegExp(cfg.site.gtm_id, "g")) || []).length < 2) {
    fail(`${page.slug} — GTM (${cfg.site.gtm_id}) head + noscript not both present`);
  } else pass(`${page.slug} — GTM ok`);

  // hreflang × 2
  if ((c.match(/hreflang=/g) || []).length < 2) {
    fail(`${page.slug} — hreflang self + x-default missing`);
  }

  // theme-color
  if (!c.includes(`<meta name="theme-color"`)) fail(`${page.slug} — theme-color missing`);

  // canonical
  if (!c.includes(`<link rel="canonical"`)) fail(`${page.slug} — canonical missing`);

  // og:image:width/height
  if (page.schema_role !== "thank_you") {
    if (!c.includes(`og:image:width`) || !c.includes(`og:image:height`)) {
      fail(`${page.slug} — og:image dimensions missing`);
    }
  }

  // robots index/follow on indexable, noindex on thank_you
  if (page.schema_role === "thank_you") {
    if (!/<meta name="robots" content="noindex/.test(c)) fail(`${page.slug} — should be noindex`);
  } else if (page.schema_role !== "404") {
    if (!/<meta name="robots" content="index/.test(c)) fail(`${page.slug} — should be index,follow`);
  }

  // BreadcrumbList on inner pages
  if (["about", "contact", "service", "legal", "other"].includes(page.schema_role)) {
    if (!c.includes("BreadcrumbList")) fail(`${page.slug} — BreadcrumbList missing`);
  }

  // FAQPage on service pages — SEO nice-to-have, not a deploy blocker.
  // extract-faqs.js only emits a block when the page has <h2>+<p> FAQ content,
  // so a service page legitimately without an FAQ section warns rather than fails.
  if (page.schema_role === "service" && !c.includes("FAQPage")) {
    warn(`${page.slug} — no FAQPage schema (add an FAQ section + re-run scripts/extract-faqs.js for SEO; safe to skip)`);
  }

  // Home: WebSite + Organization + entity
  if (page.schema_role === "home") {
    for (const t of ["WebSite", "Organization", cfg.site.schema.type, "SearchAction"]) {
      if (!c.includes(t)) fail(`${page.slug} — ${t} schema missing`);
    }
  }

  // keywords meta only when configured
  if (page.keywords) {
    if (!c.includes(`<meta name="keywords"`)) fail(`${page.slug} — keywords expected but missing`);
  }

  // Agency "designed by" credit on indexable pages (configurable via
  // site.agency_credit; required + match string default to the Avily credit).
  const ac = cfg.site.agency_credit;
  if (ac.required && page.schema_role !== "thank_you" && page.schema_role !== "404") {
    if (!c.includes(ac.match)) {
      fail(`${page.slug} — agency credit "${ac.match}" missing (paste from templates/designed-by-avily.html into footer, or set site.agency_credit.required: false)`);
    }
  }

  // Core Web Vitals reporter
  if (!c.includes("/js/web-vitals.iife.js")) {
    fail(`${page.slug} — CWV reporter missing (re-run scripts/inject-seo.js)`);
  }
  // Deprecated host/URL substrings that must not appear (configurable).
  for (const dep of ac.deprecated) {
    if (c.includes(dep)) {
      fail(`${page.slug} — uses deprecated reference "${dep}" — update it (e.g. Avily: cdn.avily.com/avily-logo-small.png)`);
    }
  }

  // Exactly one <title> (catches duplicate hand-authored + injected titles).
  const titleCount = (c.match(/<title>/gi) || []).length;
  if (titleCount !== 1) fail(`${page.slug} — expected exactly 1 <title>, found ${titleCount}`);

  // Every JSON-LD block must be valid JSON.
  const ldBlocks = c.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    const json = block.replace(/<script type="application\/ld\+json">/i, "").replace(/<\/script>/i, "");
    try { JSON.parse(json); }
    catch (e) { fail(`${page.slug} — malformed JSON-LD: ${e.message}`); }
  }

  // Footer copyright year must be dynamic (.current-year), not a bare static year.
  if (/(&copy;|&#169;|©)\s*\d{4}\b/.test(c)) {
    fail(`${page.slug} — hardcoded copyright year (run scripts/fix-copyright-year.js)`);
  }
}

// --- Worker checks ---

const workerPath = path.join(ROOT, "src", "worker.js");
if (!fs.existsSync(workerPath)) {
  fail("src/worker.js missing");
} else {
  const w = fs.readFileSync(workerPath, "utf8");
  for (const marker of ["escapeHtml", "Cross-Origin-Opener-Policy", "CANONICAL_HOST", "Last-Modified", "honeypot", "rel=\"canonical\""]) {
    if (!w.includes(marker)) fail(`src/worker.js — ${marker} missing`);
  }
}

// --- Form markup ↔ handler field-name contract (see scripts/check-forms.js) ---
{
  const { fails: formFails, warns: formWarns } = collectFormIssues();
  for (const ff of formFails) fail(`form/handler mismatch: ${ff}`);
  for (const fw of formWarns) warn(fw);
  if (!formFails.length) pass("every form is satisfiable by the contact handler");
}

// --- Contact-form JS checks ---
// Any page that loads js/ContactUs.js must have the file present and fully
// rendered (no leftover %%TOKEN%% / {{token}}), or the form is dead on first load.
const formPages = cfg.pages
  .map((p) => readHtml(p.slug))
  .filter((f) => f && f.content.includes('src="js/ContactUs.js"'));
if (formPages.length) {
  const contactJs = path.join(ROOT, "js", "ContactUs.js");
  if (!fs.existsSync(contactJs)) {
    fail("js/ContactUs.js missing but referenced by a form page (run scripts/build-contact-js.js)");
  } else {
    const cj = fs.readFileSync(contactJs, "utf8");
    if (/%%[A-Z_]+%%|\{\{[^}]+\}\}/.test(cj)) {
      fail("js/ContactUs.js has an unsubstituted placeholder (re-run scripts/build-contact-js.js)");
    } else pass("js/ContactUs.js present and rendered");
  }
}

// --- wrangler.toml checks ---
const wranglerPath = path.join(ROOT, "wrangler.toml");
if (fs.existsSync(wranglerPath)) {
  const wt = fs.readFileSync(wranglerPath, "utf8");
  // Without run_worker_first, static assets bypass the worker and ship without
  // the security headers (HSTS/CSP/COOP) it injects.
  if (!/run_worker_first\s*=\s*true/.test(wt)) {
    fail("wrangler.toml — [assets] run_worker_first = true missing (security headers won't reach static pages)");
  } else pass("wrangler.toml — run_worker_first ok");
  // RECAPTCHA_SECRET is an encrypted Worker Secret (Settings → Variables and
  // Secrets, type Secret; or `wrangler secret put RECAPTCHA_SECRET`). It is set
  // out-of-band and leaves no trace in wrangler.toml, so it can't be checked
  // statically — remind, never fail. (A plaintext dashboard *Variable* WOULD be
  // wiped on deploy; only an encrypted Secret persists.)
  warn("RECAPTCHA_SECRET is a Worker Secret and can't be verified from here — confirm it exists on the worker (Settings → Variables and Secrets, type: Secret) and is the reCAPTCHA v3 SECRET key.");
}

// --- Sitemap checks ---

const smPath = path.join(ROOT, "sitemap.xml");
if (!fs.existsSync(smPath)) {
  fail("sitemap.xml missing (run scripts/build-sitemap.js)");
} else {
  const sm = fs.readFileSync(smPath, "utf8");
  if (!sm.includes(`xmlns:image="http://www.google.com/schemas/sitemap-image`)) {
    fail("sitemap.xml — image namespace missing");
  }
}

// --- Static-file checks ---

for (const f of [
  "robots.txt", "site.webmanifest", "404.html", "thank-you.html",
  ".assetsignore", ".gitignore", "wrangler.toml",
  "images/favicon.png", "images/favicon-192.png", "images/favicon-32.png", "images/apple-touch-icon.png",
  "images/og-default.jpg",
  "js/web-vitals.iife.js",
  cfg.site.stylesheet.replace(/^\//, ""),
]) {
  if (!fs.existsSync(path.join(ROOT, f))) fail(`${f} missing`);
}

// --- Output ---

console.log(`\n=== verify-launch ===\n`);
console.log(`Passed checks: ${passes.length}`);
console.log(`Warnings:      ${warns.length}`);
console.log(`Failed checks: ${fails.length}\n`);

if (warns.length) {
  console.log("Warnings (non-blocking):");
  for (const w of warns) console.log(`  ⚠ ${w}`);
  console.log("");
}

if (fails.length) {
  console.log("Failures:");
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}

console.log("✓ all invariants pass");
