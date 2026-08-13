// scripts/build-worker.js
//
// Renders src/worker.js from templates/worker.template.js using site.config.yaml,
// so the worker's domain/emails/business-name and the LAST_MODIFIED date never
// need manual editing (LAST_MODIFIED is derived from build_date).
//
//   node scripts/build-worker.js            # writes src/worker.js
//   node scripts/build-worker.js --stdout   # prints to stdout (no write)
//   node scripts/build-worker.js path.js    # writes to a custom path
//
// Re-run after changing the domain, contact/sender email, or build_date.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig } = require("./_lib.js");

const cfg = loadConfig();
const s = cfg.site;

const lastModified = new Date(`${s.build_date}T00:00:00Z`).toUTCString();

const TOKENS = {
  "%%CANONICAL_HOST%%": s.canonical_hostname,
  "%%NON_CANONICAL_HOST%%": s.non_canonical_hostname,
  "%%LAST_MODIFIED%%": lastModified,
  "%%DOMAIN%%": s.domain,
  "%%CONTACT_EMAIL%%": s.contact.email,
  "%%FROM_EMAIL%%": s.sendgrid.from_email,
  "%%BUSINESS_NAME%%": s.business_name,
  "%%LEGACY_REDIRECTS_JSON%%": JSON.stringify(s.legacy_redirects || {}),
};

const tmplPath = path.join(ROOT, "templates", "worker.template.js");
let out = fs.readFileSync(tmplPath, "utf8");
for (const [token, value] of Object.entries(TOKENS)) {
  out = out.split(token).join(value);
}

const leftover = out.match(/%%[A-Z_]+%%/g);
if (leftover) {
  console.error(`✗ unsubstituted tokens remain: ${[...new Set(leftover)].join(", ")}`);
  process.exit(1);
}

const arg = process.argv[2];
if (arg === "--stdout") {
  process.stdout.write(out);
} else {
  const dest = arg ? path.resolve(ROOT, arg) : path.join(ROOT, "src", "worker.js");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
  console.log(`✓ wrote ${path.relative(ROOT, dest)} (LAST_MODIFIED ${lastModified})`);
}
