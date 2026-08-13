// scripts/launch.js
//
// One-command orchestrator — runs the whole scriptable pipeline in order, so a
// site can be built without pasting the runbook into Claude. Runs preflight
// first (aborts if not ready), then every build step, then the verify gate.
//
//   node scripts/launch.js                # preflight → build → verify
//   node scripts/launch.js --skip-preflight
//   node scripts/launch.js --no-images    # skip the sharp image pipeline
//
// Steps that CANNOT be scripted (Cloudflare account / human decisions) are
// printed as a checklist instead — this never deploys.

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath;
const SCRIPTS = path.join(ROOT, "scripts");
const args = process.argv.slice(2);
const skipPreflight = args.includes("--skip-preflight");
const noImages = args.includes("--no-images");

function run(script, scriptArgs = []) {
  console.log(`\n──────── ${script} ${scriptArgs.join(" ")} ────────`);
  execFileSync(NODE, [path.join(SCRIPTS, script), ...scriptArgs], { stdio: "inherit" });
}

let sharpAvailable = false;
try { require.resolve("sharp", { paths: [ROOT] }); sharpAvailable = true; } catch {}

try {
  // 0. Readiness
  if (!skipPreflight) run("preflight.js");

  // 1. Worker + form handler
  run("build-worker.js");
  run("standardize-forms.js"); // also renders js/ContactUs.js when a form exists
  run("check-forms.js");       // fail the build if any form + handler disagree on field names

  // 2. SEO / content / static files
  run("inject-seo.js");
  run("extract-faqs.js");
  run("build-shell-pages.js");
  run("build-static-files.js");
  run("build-sitemap.js");
  run("fix-copyright-year.js");

  // 3. Images (optional — needs sharp)
  if (noImages) {
    console.log("\n(skipping image pipeline: --no-images)");
  } else if (sharpAvailable) {
    run("optimize-images.js");
    run("inject-pictures.js");
  } else {
    console.log("\n(skipping image pipeline: sharp not installed — run `npm install` then `npm run optimize-images && node scripts/inject-pictures.js`)");
  }
} catch (e) {
  console.error(`\n✗ launch aborted — a build step failed (see output above).`);
  process.exit(1);
}

// 4. Manual steps the toolkit can't do for you
console.log(`
──────── manual steps (not scriptable) ────────
  • Legal pages: generate privacy-policy.html + terms-and-conditions.html from
    templates/ (jurisdiction-aware substitution — see runbook Phase 5.5).
  • Agency credit: paste the snippet from templates/designed-by-avily.html into
    each page's footer (or set site.agency_credit.required: false).
  • reCAPTCHA secret: add the v3 SECRET key as a WORKER SECRET —
    Workers → <worker_name> → Settings → Variables and Secrets → Add →
    type: Secret → name RECAPTCHA_SECRET. (Or \`npx wrangler secret put
    RECAPTCHA_SECRET\`.) Type Secret, never Variable — a plaintext Variable is
    wiped on the next deploy. The worker must exist first, so deploy once.
  • Cloudflare: attach apex + www as Custom Domains, then \`npx wrangler deploy\`.`);

// 5. Final gate
console.log(`\n──────── verify-launch.js ────────`);
let verified = true;
try {
  execFileSync(NODE, [path.join(SCRIPTS, "verify-launch.js")], { stdio: "inherit" });
  console.log("\n✓ build complete and verify passed — finish the manual steps above, then deploy.");
} catch {
  console.error("\n⚠ build complete, but verify-launch reported failures (above). Resolve them before deploying.");
  verified = false;
}

// 6. QA sweep — advisory here. It reports content problems (dead links, missing
// images, placeholder copy), which shouldn't abort a build the way a broken
// build invariant does. The blockers still have to be cleared before the client
// sees the site — see site-qa.md for the page-by-page review that follows.
console.log(`\n──────── qa-audit.js ────────`);
try {
  execFileSync(NODE, [path.join(SCRIPTS, "qa-audit.js")], { stdio: "inherit" });
} catch {
  console.error("\n⚠ qa-audit found blockers (above) — fix them before the client sees the site.");
}
console.log("\nNext: paste site-qa.md into a fresh Claude Code session for the page-by-page QA review.");

if (!verified) process.exit(1);
