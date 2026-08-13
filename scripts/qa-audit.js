// scripts/qa-audit.js
//
// Pre-launch QA sweep — the machine-checkable half of `site-qa.md`.
// Everything visual (mobile layout, spacing, polish) stays in that document;
// this script only reports what can be proven from the files on disk:
// dead links, missing images, placeholder content, contact-detail drift, and
// the agency footer credit.
//
// Blockers exit non-zero; everything else is a warning. Run before handing a
// site to the client:  node scripts/qa-audit.js

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig, walkHtmlFiles } = require("./_lib.js");

const cfg = loadConfig();
const site = cfg.site;

const fails = [];
const warns = [];
const passes = [];

function fail(msg) { fails.push(msg); }
function warn(msg) { warns.push(msg); }
function pass(msg) { passes.push(msg); }

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const lineOf = (content, index) => content.slice(0, index).split("\n").length;
const at = (file, content, index) => `${rel(file)}:${lineOf(content, index)}`;

// A page the search engines see — 404/thank-you are noindex shells and are
// exempt from the credit + heading rules.
const NOINDEX_FILES = new Set(["404.html", "thank-you.html", "error.html"]);
const isIndexable = (file) => !NOINDEX_FILES.has(path.basename(file));

// --- Link/asset resolution -------------------------------------------------

const EXTERNAL_RE = /^(https?:|mailto:|tel:|whatsapp:|sms:|javascript:|data:|#)/i;

// Resolve an href/src as the browser would: "/x" from the site root, "x" from
// the page's own directory. Query/hash are stripped first.
function resolveTarget(fromFile, target) {
  const clean = decodeURI(target.split("#")[0].split("?")[0]);
  if (!clean) return null;
  const base = clean.startsWith("/") ? ROOT : path.dirname(fromFile);
  return path.join(base, clean.replace(/^\//, ""));
}

function targetExists(fromFile, target) {
  const resolved = resolveTarget(fromFile, target);
  if (!resolved) return true;
  if (fs.existsSync(resolved)) return true;
  // Extensionless URLs may be served as .html by the worker's asset handler.
  if (!path.extname(resolved) && fs.existsSync(`${resolved}.html`)) return true;
  return false;
}

// --- Footer credit ---------------------------------------------------------

// templates/designed-by-avily.html ships one credit variant per specialty. The
// right one is derived from the schema type, refined by medical_specialty.
function expectedSpecialty() {
  const type = String(site.schema.type || "");
  const specialties = [].concat(site.schema.medical_specialty || []).join(" ").toLowerCase();

  if (/^Dentist$/i.test(type)) return "dental";
  if (/^VeterinaryCare$/i.test(type)) return "veterinary";
  if (/^Psychologist$/i.test(type) || /psych/.test(specialties)) return "psychology";
  if (/^Optician$/i.test(type) || /optometr|ophthalm/.test(specialties)) return "optometry";
  if (/^Physiotherapy$/i.test(type) || /physio|physicaltherapy/.test(specialties)) return "physiotherapy";
  if (/gyn|obstetric/.test(specialties)) return "gynaecology";
  if (/paediatric|pediatric/.test(specialties)) return "paediatrician";
  if (/^(Physician|Hospital|MedicalClinic|MedicalSpa|MedicalBusiness|MedicalOrganization)$/i.test(type)) return "medical";
  return null; // non-medical (LawFirm, Restaurant, …) — can't guess; don't guess.
}

// --- Per-page checks -------------------------------------------------------

const htmlFiles = walkHtmlFiles();
if (!htmlFiles.length) fail("no HTML files found — is this the site repo root?");

const credit = site.agency_credit;
const specialty = expectedSpecialty();

const phones = [site.contact.phone_e164, ...(site.locations || []).map((l) => l.phone_e164)]
  .filter(Boolean)
  .map((p) => String(p).replace(/[\s-]/g, ""));

const DUMMY_RE = /(lorem ipsum|\bTODO\b|\bFIXME\b|Your Company|Company Name Here|XXXXX|\bTBC\b|placeholder text)/gi;

for (const file of htmlFiles) {
  const c = fs.readFileSync(file, "utf8");
  const name = rel(file);

  // Collect this page's anchor targets once, for the #fragment check.
  const ids = new Set();
  for (const m of c.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  for (const m of c.matchAll(/\bname="([^"]+)"/g)) ids.add(m[1]);

  // --- Links ---
  for (const m of c.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/gi)) {
    const [tag, href] = m;
    const where = at(file, c, m.index);

    if (href === "" || href === "#" || /^javascript:\s*void/i.test(href)) {
      fail(`${where} — placeholder link (href="${href}") — point it somewhere or remove it`);
      continue;
    }
    if (/example\.(com|org)|yourdomain|lorem/i.test(href)) {
      fail(`${where} — placeholder domain in href: ${href}`);
      continue;
    }
    if (href.startsWith("#")) {
      const id = href.slice(1);
      if (id && !ids.has(id)) fail(`${where} — dead in-page anchor: ${href} (no matching id)`);
      continue;
    }
    if (/^tel:/i.test(href)) {
      const num = href.slice(4).replace(/[\s()-]/g, "");
      if (!/^\+\d{7,15}$/.test(num)) {
        fail(`${where} — tel: link is not E.164 (expected +27…): ${href}`);
      } else if (phones.length && !phones.includes(num)) {
        warn(`${where} — tel:${num} is not a number in site.config.yaml (${phones.join(", ")})`);
      }
      continue;
    }
    if (/^mailto:/i.test(href)) {
      const addr = href.slice(7).split("?")[0].trim();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(addr)) {
        fail(`${where} — malformed mailto: ${href}`);
      } else if (addr.toLowerCase() !== String(site.contact.email).toLowerCase()) {
        warn(`${where} — mailto:${addr} differs from site.contact.email (${site.contact.email})`);
      }
      continue;
    }
    if (/^https?:/i.test(href)) {
      // Off-site link opened in a new tab must not hand the opener over.
      if (/target="_blank"/i.test(tag) && !/rel="[^"]*noopener/i.test(tag)) {
        warn(`${where} — target="_blank" without rel="noopener": ${href}`);
      }
      continue;
    }
    if (EXTERNAL_RE.test(href)) continue;

    if (!targetExists(file, href)) fail(`${where} — dead internal link: ${href}`);
  }

  // --- Images ---
  for (const m of c.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const where = at(file, c, m.index);
    const src = (tag.match(/\bsrc="([^"]*)"/i) || [])[1];

    if (!src) {
      fail(`${where} — <img> with no src`);
    } else if (!EXTERNAL_RE.test(src) && !targetExists(file, src)) {
      fail(`${where} — missing image file: ${src}`);
    }
    if (!/\balt=/i.test(tag)) {
      fail(`${where} — <img> without alt (use alt="" if purely decorative): ${src || "?"}`);
    }
    // Width/height prevent layout shift; the <picture> rewrite normally adds them.
    if (!/\bwidth=/i.test(tag) || !/\bheight=/i.test(tag)) {
      warn(`${where} — <img> without width/height (causes CLS): ${src || "?"}`);
    }
  }

  // --- <picture> sources ---
  for (const m of c.matchAll(/<source\b[^>]*\bsrcset="([^"]*)"/gi)) {
    const where = at(file, c, m.index);
    for (const candidate of m[1].split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (!url || EXTERNAL_RE.test(url)) continue;
      if (!targetExists(file, url)) fail(`${where} — <source> srcset points at a missing file: ${url}`);
    }
  }

  // --- Dummy content ---
  const body = (c.match(/<body[\s\S]*<\/body>/i) || [c])[0];
  const bodyOffset = c.indexOf(body);
  for (const m of body.matchAll(DUMMY_RE)) {
    fail(`${at(file, c, bodyOffset + m.index)} — placeholder/dummy content: "${m[0]}"`);
  }

  // --- Headings ---
  if (isIndexable(file)) {
    const h1s = (c.match(/<h1\b/gi) || []).length;
    if (h1s === 0) warn(`${name} — no <h1>`);
    else if (h1s > 1) warn(`${name} — ${h1s} <h1> elements (should be exactly one)`);
  }

  // --- Agency footer credit ---
  if (credit.required && isIndexable(file)) {
    if (!c.includes(credit.match)) {
      fail(`${name} — agency credit missing (no "${credit.match}" link in the footer)`);
    } else if (specialty && !new RegExp(`avily\\.co\\.za/${specialty}[a-z-]*`, "i").test(c)) {
      warn(`${name} — agency credit is not the "${specialty}" variant expected for schema.type ${site.schema.type} (see templates/designed-by-avily.html)`);
    }
    for (const dep of credit.deprecated || []) {
      if (c.includes(dep)) fail(`${name} — deprecated agency reference "${dep}" — replace with cdn.avily.com/avily-logo-small.png`);
    }
  }
}

// --- CSS: url() references -------------------------------------------------

function walkCss(dir = ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".wrangler", "templates"].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCss(p));
    else if (entry.name.endsWith(".css")) out.push(p);
  }
  return out;
}

for (const file of walkCss()) {
  const c = fs.readFileSync(file, "utf8");
  for (const m of c.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    const url = m[1].trim();
    if (EXTERNAL_RE.test(url)) continue;
    if (!targetExists(file, url)) fail(`${at(file, c, m.index)} — CSS url() points at a missing file: ${url}`);
  }
}

if (!fails.length) pass("no broken links, missing images, or placeholder content found");

// --- Output ----------------------------------------------------------------

console.log(`\n=== qa-audit ===\n`);
console.log(`Files scanned: ${htmlFiles.length} HTML`);
console.log(`Warnings:      ${warns.length}`);
console.log(`Blockers:      ${fails.length}\n`);

if (warns.length) {
  console.log("Warnings (fix if you can, non-blocking):");
  for (const w of warns) console.log(`  ⚠ ${w}`);
  console.log("");
}

if (fails.length) {
  console.log("Blockers:");
  for (const f of fails) console.log(`  ✗ ${f}`);
  console.log("\nFix these before the client sees the site, then re-run.");
  process.exit(1);
}

console.log("✓ automated QA sweep clean — now do the page-by-page review in site-qa.md");
