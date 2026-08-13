// scripts/build-contact-js.js
//
// Renders js/ContactUs.js from templates/ContactUs.template.js using
// site.config.yaml, substituting the public reCAPTCHA v3 SITE key. Mirrors
// build-worker.js so the form handler never ships with an unresolved token.
//
//   node scripts/build-contact-js.js            # writes js/ContactUs.js
//   node scripts/build-contact-js.js --stdout   # prints to stdout (no write)
//
// Also exported as buildContactJs() so standardize-forms.js can guarantee the
// file exists alongside the <script> tag it injects.
//
// Re-run after changing site.recaptcha_site_key.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig } = require("./_lib.js");
const { FIELDS, HONEYPOT } = require("./form-contract.js");

function render(cfg) {
  const siteKey = cfg.site.recaptcha_site_key;
  if (!siteKey || /PUBLIC_V3_SITE_KEY/.test(siteKey)) {
    throw new Error("site.recaptcha_site_key is missing or still the placeholder — set the v3 SITE key in site.config.yaml first.");
  }
  const tmplPath = path.join(ROOT, "templates", "ContactUs.template.js");
  let out = fs.readFileSync(tmplPath, "utf8")
    .split("%%RECAPTCHA_SITE_KEY%%").join(siteKey)
    .split("%%FIELD_CONTRACT%%").join(JSON.stringify({ FIELDS, HONEYPOT }));
  const leftover = out.match(/%%[A-Z_]+%%/g);
  if (leftover) throw new Error(`unsubstituted tokens remain: ${[...new Set(leftover)].join(", ")}`);
  return out;
}

// Write js/ContactUs.js from the current config. Returns the destination path.
function buildContactJs(cfg = loadConfig()) {
  const dest = path.join(ROOT, "js", "ContactUs.js");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, render(cfg));
  return dest;
}

module.exports = { buildContactJs, render };

if (require.main === module) {
  try {
    const cfg = loadConfig();
    if (process.argv[2] === "--stdout") {
      process.stdout.write(render(cfg));
    } else {
      const dest = buildContactJs(cfg);
      console.log(`✓ wrote ${path.relative(ROOT, dest)} (reCAPTCHA site key substituted)`);
    }
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
