// scripts/build-legal-pages.js
//
// Renders privacy-policy.html + terms-and-conditions.html from templates/,
// substituting {{site.*}}/{{legal.*}} tokens and the two custom conditional
// blocks the templates use ({{#site.address.postal_code}}...{{/...}} and the
// "{{< if site.schema.type is medical >}}...{{< /if >}}" doctor-relationship
// clause). Clones the live nav + footer (absolute /paths) the same way
// build-shell-pages.js does for 404.html, so the pages match the rest of the
// site's chrome. Add both slugs to site.config.yaml pages[] with
// schema_role: legal, then run inject-seo.js to fill in the SEO head +
// BreadcrumbList — this script only renders the body content.
//
//   node scripts/build-legal-pages.js              # create only missing files
//   node scripts/build-legal-pages.js --force      # overwrite existing

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig, getSiteShell, isMedicalSchemaType, NAV_SCRIPTS_HTML } = require("./_lib.js");

const cfg = loadConfig();
const s = cfg.site;
const { header, footer } = getSiteShell();

function get(obj, keyPath) {
  return keyPath.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function renderTokens(tpl) {
  return tpl.replace(/\{\{([\w.]+)\}\}/g, (m, keyPath) => {
    const v = get({ site: s, legal: cfg.legal }, keyPath);
    return v == null ? "" : String(v);
  });
}

function stripConditional(tpl, keyPath, keep) {
  const re = new RegExp(`\\{\\{#${keyPath.replace(/\./g, "\\.")}\\}\\}([\\s\\S]*?)\\{\\{\\/${keyPath.replace(/\./g, "\\.")}\\}\\}`, "g");
  return tpl.replace(re, (m, inner) => (keep ? inner : ""));
}

function renderBody(tpl) {
  // The templates already carry their own self-contained content <section>
  // (marked "<!-- Policy Content -->" or "<!-- Content -->"), separate from
  // the page-heading <section class="contact-heading"> above it. Extract just
  // that content section — the caller supplies its own heading + nav/footer.
  const startMarker = tpl.includes("<!-- Policy Content -->") ? "<!-- Policy Content -->" : "<!-- Content -->";
  const start = tpl.indexOf(startMarker);
  const end = tpl.indexOf("{{< inject-seo.js appends the site footer");
  let out = tpl.slice(start, end);
  // Conditional: privacy-policy's optional postal code clause.
  out = stripConditional(out, "site.address.postal_code", !!s.address.postal_code);
  // Conditional: terms-and-conditions' medical doctor-patient clause.
  const isMedical = isMedicalSchemaType(s.schema.type);
  out = out.replace(/\{\{< if site\.schema\.type is medical >\}\}([\s\S]*?)\{\{< \/if >\}\}/g, (m, inner) => (isMedical ? inner : ""));
  return renderTokens(out);
}

function pageShell(titleHeading, subtitle, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
</head>
<body>
  ${header}

  <section style="background:${s.brand_color}; color:#fff; padding: 64px 24px; text-align:center;">
    <h1 style="margin:0 0 8px; font-size:2.1rem;">${titleHeading}</h1>
    <p style="margin:0; opacity:0.9;">${subtitle}</p>
  </section>

${bodyContent}

  ${footer}

  ${NAV_SCRIPTS_HTML}
</body>
</html>
`;
}

function build(templateFile, titleHeading) {
  const raw = fs.readFileSync(path.join(ROOT, "templates", templateFile), "utf8");
  const subtitleMatch = raw.match(/<h1>[^<]*<\/h1>\s*<p>([\s\S]*?)<\/p>/);
  const subtitle = subtitleMatch ? renderTokens(subtitleMatch[1]) : "";
  const body = renderBody(raw);
  return pageShell(titleHeading, subtitle, body);
}

const pages = {
  "privacy-policy.html": () => build("privacy-policy.html", "Privacy Policy"),
  "terms-and-conditions.html": () => build("terms-and-conditions.html", "Terms &amp; Conditions"),
};

const force = process.argv.includes("--force");
for (const [file, gen] of Object.entries(pages)) {
  const dest = path.join(ROOT, file);
  const exists = fs.existsSync(dest) && fs.statSync(dest).size > 0;
  if (exists && !force) { console.log(`  ${file} (exists — skipped; use --force to overwrite)`); continue; }
  fs.writeFileSync(dest, gen());
  console.log(`✓ wrote ${file}`);
}
