// scripts/preflight.js
//
// Readiness "doctor" — run BEFORE building (or deploying) to confirm the kit is
// correctly dropped into this HTML project and Cloudflare-ready:
//   - project looks like an HTML project (has index.html)
//   - site.config.yaml exists, parses, and has real (non-placeholder) values
//   - the shipped templates/ are present and render with no leftover tokens
//   - the pipeline scripts are present
//   - tooling (Node, wrangler, sharp) is available
//
// Exits non-zero on any failure so it can gate a launch. Warnings never fail.
//
//   node scripts/preflight.js

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath;

const fails = [];
const warns = [];
const passes = [];
const fail = (m) => fails.push(m);
const warn = (m) => warns.push(m);
const pass = (m) => passes.push(m);

// Example/placeholder values that mean "not configured yet".
const PLACEHOLDERS = {
  "site.domain": "example.co.za",
  "site.worker_name": "example-business",
  "site.business_name": "Example Business",
  "site.contact.email": "owner@example.co.za",
  "site.gtm_id": "GTM-XXXXXXX",
};
const RECAPTCHA_PLACEHOLDER = "PUBLIC_V3_SITE_KEY";
// The Avily account Secrets Store — a constant, pre-filled in the example config.
// It is not a placeholder, so a value that ISN'T this is the suspicious case.
const AVILY_SECRETS_STORE_ID = "0fbc4b9b538940cabc4dc3b766687b10";

function get(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

// --- 1. Project structure ---
if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  fail("index.html not found at the project root — drop the kit into the root of an HTML site (scripts/ one level under it).");
} else pass("index.html present (project root looks correct)");

// --- 2. Config presence + parse ---
const cfgPath = path.join(ROOT, "site.config.yaml");
let cfg = null;
if (!fs.existsSync(cfgPath)) {
  fail("site.config.yaml missing — copy site.config.example.yaml to site.config.yaml and fill it in.");
} else {
  try {
    cfg = require("./_lib.js").loadConfig();
    pass("site.config.yaml parses");
  } catch (e) {
    fail(`site.config.yaml failed to load: ${e.message}`);
  }
}

// --- 3. Config completeness ---
if (cfg) {
  for (const [key, placeholder] of Object.entries(PLACEHOLDERS)) {
    const val = get(cfg, key);
    if (val == null || val === "") fail(`config: ${key} is missing`);
    else if (val === placeholder) {
      // recaptcha/gtm placeholders affect runtime, not the build → warn; identity → fail.
      const blocking = ["site.domain", "site.worker_name", "site.business_name", "site.contact.email"].includes(key);
      (blocking ? fail : warn)(`config: ${key} is still the example value ("${placeholder}")`);
    }
  }
  if (get(cfg, "site.contact.phone_e164") == null) fail("config: site.contact.phone_e164 is missing");
  // SENDGRID_API_KEY is the only Secrets Store binding. RECAPTCHA_SECRET is a
  // Worker Secret set out-of-band, so there is no store id to check for it.
  const storeId = get(cfg, "site.sendgrid.secrets_store_id");
  if (!storeId) fail("config: site.sendgrid.secrets_store_id is missing");
  else if (storeId !== AVILY_SECRETS_STORE_ID) {
    warn(`config: site.sendgrid.secrets_store_id is "${storeId}", not the usual Avily store (${AVILY_SECRETS_STORE_ID}) — correct only if this is a different Cloudflare account.`);
  } else pass("config: SendGrid Secrets Store id ok");
  // Every pages[] file that isn't generated later should already exist.
  const GENERATED = new Set(["thank-you.html", "404.html", "privacy-policy.html", "terms-and-conditions.html"]);
  let hasForm = false;
  for (const p of cfg.pages || []) {
    const file = p.slug === "/" ? "index.html" : p.slug;
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      if (!GENERATED.has(file)) warn(`pages[]: ${file} listed in config but not found (will fail verify if never created)`);
      continue;
    }
    const html = fs.readFileSync(full, "utf8");
    if (/<form\b/i.test(html)) hasForm = true;
    // inject-seo anchors the GTM head block after <meta charset="UTF-8">; without
    // that exact tag the head GTM silently won't inject and verify will fail.
    if (!/<meta charset="UTF-8">/i.test(html)) {
      warn(`${file}: no <meta charset="UTF-8"> — add it or GTM head won't inject (verify will then fail GTM).`);
    }
  }
  // A real reCAPTCHA site key is only required if the site actually has a form
  // (build-contact-js refuses to render the handler with the placeholder).
  if (get(cfg, "site.recaptcha_site_key") === RECAPTCHA_PLACEHOLDER) {
    if (hasForm) fail("config: site.recaptcha_site_key is still the placeholder but the site has a contact form — set the v3 site key.");
    else warn("config: site.recaptcha_site_key is still the placeholder (no form found, so non-blocking).");
  }
}

// --- 4. Template integrity ---
const TEMPLATES = [
  "worker.template.js", "ContactUs.template.js",
  "privacy-policy.html", "terms-and-conditions.html", "designed-by-avily.html",
];
for (const t of TEMPLATES) {
  if (!fs.existsSync(path.join(ROOT, "templates", t))) fail(`templates/${t} missing (toolkit incomplete)`);
}
// Render smoke: build-worker --stdout works on the example config and must leave
// no %%TOKENS%%. Proves the worker template + renderer are intact end-to-end.
if (cfg && fs.existsSync(path.join(ROOT, "templates", "worker.template.js"))) {
  try {
    const out = execFileSync(NODE, [path.join(ROOT, "scripts", "build-worker.js"), "--stdout"], { encoding: "utf8" });
    if (/%%[A-Z_]+%%/.test(out)) fail("templates/worker.template.js renders with leftover %%TOKENS%%");
    else pass("worker template renders cleanly");
  } catch (e) {
    fail(`worker template failed to render: ${(e.stderr || e.message || "").toString().trim()}`);
  }
}

// --- 5. Pipeline scripts + vendored assets present ---
const SCRIPTS = [
  "build-worker.js", "build-contact-js.js", "standardize-forms.js", "inject-seo.js",
  "extract-faqs.js", "build-shell-pages.js", "build-static-files.js", "build-sitemap.js",
  "fix-copyright-year.js", "optimize-images.js", "inject-pictures.js", "verify-launch.js",
  "qa-audit.js",
];
for (const sc of SCRIPTS) {
  if (!fs.existsSync(path.join(ROOT, "scripts", sc))) fail(`scripts/${sc} missing (toolkit incomplete)`);
}

// inject-seo.js links /js/web-vitals.iife.js from every page and verify-launch.js
// requires it; build-static-files.js copies it out of assets/. Missing here means
// every page would ship a 404 script tag.
if (!fs.existsSync(path.join(ROOT, "assets", "js", "web-vitals.iife.js"))) {
  fail("assets/js/web-vitals.iife.js missing (toolkit incomplete) — every page links /js/web-vitals.iife.js");
} else pass("vendored web-vitals reporter present");

// --- 6. Tooling ---
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 18) fail(`Node ${process.versions.node} — the scripts need Node 18+`);
else pass(`Node ${process.versions.node}`);

try {
  require.resolve("js-yaml", { paths: [ROOT] });
  pass("js-yaml installed");
} catch { fail("js-yaml not installed — run `npm install`"); }

try {
  require.resolve("sharp", { paths: [ROOT] });
  pass("sharp installed (image pipeline available)");
} catch { warn("sharp not installed — image pipeline (optimize-images) will be skipped until you `npm install`"); }

try {
  execSync("wrangler --version", { stdio: "ignore", timeout: 8000 });
  pass("wrangler on PATH");
} catch { warn("wrangler not found on PATH — that's fine, use `npx wrangler …` for dev/deploy"); }

// --- Output ---
console.log(`\n=== preflight ===\n`);
console.log(`Passed:   ${passes.length}`);
console.log(`Warnings: ${warns.length}`);
console.log(`Failed:   ${fails.length}\n`);

if (warns.length) {
  console.log("Warnings (non-blocking):");
  for (const w of warns) console.log(`  ⚠ ${w}`);
  console.log("");
}
if (fails.length) {
  console.log("Failures:");
  for (const f of fails) console.log(`  ✗ ${f}`);
  console.log("\nNot ready — resolve the failures above, then re-run preflight.");
  process.exit(1);
}
console.log("✓ ready to build (node scripts/launch.js) — warnings above are optional.");
