// Shared helpers for the launch-pipeline scripts.
// Tiny, dependency-light. Only `js-yaml` is required from npm.

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");

function loadConfig() {
  const cfgPath = path.join(ROOT, "site.config.yaml");
  if (!fs.existsSync(cfgPath)) {
    console.error("✗ site.config.yaml not found. Copy site.config.example.yaml first.");
    process.exit(1);
  }
  const raw = fs.readFileSync(cfgPath, "utf8");
  const cfg = yaml.load(raw);
  applyDefaults(cfg);
  return cfg;
}

function applyDefaults(cfg) {
  const s = cfg.site;
  // build_date: an unquoted `2026-05-29` is parsed by js-yaml as a Date (YAML
  // timestamp). Normalize once to a W3C YYYY-MM-DD string so the sitemap
  // <lastmod> and any Last-Modified logic read a consistent value.
  if (s.build_date instanceof Date) {
    s.build_date = s.build_date.toISOString().slice(0, 10);
  } else if (s.build_date != null) {
    s.build_date = String(s.build_date);
  }
  // og_locale
  if (!s.og_locale) {
    s.og_locale = ({ ZA: "en_ZA", BW: "en_ZA", NA: "en_ZA", US: "en_US", GB: "en_GB" }[s.address.country_iso]) || "en";
  }
  // favicon defaults to logo — sharp resizes to 32/192/512/180 for apple-touch
  if (!s.favicon) s.favicon = s.logo;

  // schema price range
  if (!s.schema.price_range) s.schema.price_range = "$$";
  // languages
  if (!s.schema.languages) s.schema.languages = ["en"];

  // Stylesheet path injected by inject-seo.js (preload + noscript fallback).
  if (!s.stylesheet) s.stylesheet = "css/styles.css";
  // FAQ container class(es) scraped by extract-faqs.js (string or list).
  if (!s.schema.faq_container) s.schema.faq_container = ["service-content", "service-main"];
  else if (typeof s.schema.faq_container === "string") s.schema.faq_container = [s.schema.faq_container];
  // Image-optimization size threshold (KB) for optimize-images.js.
  if (!s.images) s.images = {};
  if (s.images.size_threshold_kb == null) s.images.size_threshold_kb = 200;

  // Agency "designed by" credit enforced by verify-launch.js. Defaults to the
  // Avily credit so internal client launches are unchanged; set required:false
  // (or override `match`) to use the kit on any other project.
  if (!s.agency_credit) s.agency_credit = {};
  const ac = s.agency_credit;
  if (ac.required == null) ac.required = true;
  if (!ac.match) ac.match = "avily.co.za/";
  if (!Array.isArray(ac.deprecated)) ac.deprecated = ["avily.azureedge.net"];

  // currencies derived from country_iso
  const currencyMap = {
    BW: "BWP, ZAR, USD", ZA: "ZAR", KE: "KES", NG: "NGN",
    GH: "GHS", UG: "UGX", TZ: "TZS", RW: "RWF", ZM: "ZMW",
    NA: "NAD, ZAR", LS: "LSL, ZAR", SZ: "SZL, ZAR",
    US: "USD", GB: "GBP", EU: "EUR",
  };
  if (!s.schema.currencies_accepted) {
    s.schema.currencies_accepted = currencyMap[s.address.country_iso] || "USD";
  }

  // canonical host
  if (!s.canonical_host) s.canonical_host = "apex";
  s.canonical_hostname = s.canonical_host === "www" ? `www.${s.domain}` : s.domain;
  s.non_canonical_hostname = s.canonical_host === "www" ? s.domain : `www.${s.domain}`;

  // Country full names
  const countryNames = {
    BW: "the Republic of Botswana", ZA: "the Republic of South Africa",
    KE: "the Republic of Kenya", NG: "the Federal Republic of Nigeria",
    GH: "the Republic of Ghana", UG: "the Republic of Uganda",
    NA: "the Republic of Namibia", LS: "the Kingdom of Lesotho",
    US: "the United States of America", GB: "the United Kingdom",
  };

  // Data-protection law lookup
  const dpLaws = {
    BW: { full: "the Data Protection Act, 2018 (Act No. 32 of 2018)", short: "the Data Protection Act, 2018" },
    ZA: { full: "the Protection of Personal Information Act 4 of 2013 (POPIA)", short: "POPIA" },
    KE: { full: "the Data Protection Act, 2019", short: "the Data Protection Act, 2019" },
    NG: { full: "the Nigeria Data Protection Regulation (NDPR)", short: "the NDPR" },
    GH: { full: "the Data Protection Act, 2012 (Act 843)", short: "the Data Protection Act 2012" },
    UG: { full: "the Data Protection and Privacy Act, 2019", short: "the Data Protection and Privacy Act 2019" },
    US: { full: "applicable state privacy laws", short: "applicable state privacy laws" },
    GB: { full: "the UK GDPR and the Data Protection Act 2018", short: "the UK GDPR" },
  };
  const cc = s.address.country_iso;
  cfg.legal = {
    jurisdiction_full: countryNames[cc] || cc,
    governing_law_jurisdiction: countryNames[cc] || cc,
    data_protection_law_full: (dpLaws[cc] || dpLaws.BW).full,
    data_protection_law_short: (dpLaws[cc] || dpLaws.BW).short,
  };
}

function isMedicalSchemaType(t) {
  return /^(Dentist|Physician|Hospital|MedicalSpa|MedicalBusiness|MedicalClinic|MedicalOrganization)$/.test(t);
}

function getPage(cfg, slug) {
  return cfg.pages.find((p) => p.slug === slug);
}

function canonicalUrl(cfg, slug) {
  const base = `https://${cfg.site.canonical_hostname}`;
  if (slug === "/") return `${base}/`;
  return `${base}/${slug}`;
}

function slugToFile(slug) {
  if (slug === "/") return "index.html";
  return slug;
}

function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escDesc(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function readHtml(slug) {
  const filename = slugToFile(slug);
  const full = path.join(ROOT, filename);
  if (!fs.existsSync(full)) return null;
  return { path: full, content: fs.readFileSync(full, "utf8") };
}

// Resolve a `<img src>` or srcset basename to the on-disk original in images/.
// inject-pictures.js rewrites src→images/optimized/<base>.<ext>, so we probe
// jpg/jpeg/png to find the un-optimized source the launch scripts expect.
function resolveImageInImages(baseOrFile) {
  const stripped = baseOrFile.replace(/\.(jpe?g|png|webp)$/i, "");
  for (const ext of ["jpg", "jpeg", "png"]) {
    const candidate = `${stripped}.${ext}`;
    if (fs.existsSync(path.join(ROOT, "images", candidate))) return candidate;
  }
  return null;
}

// Derive the hero image filename (relative to images/) for a given page by
// scanning its HTML. Prefers the first <img src="images/..."> inside <main>,
// then falls back to a <picture><source srcset="images/optimized/...">, then
// document-wide first <img>, then to site.logo.
function getHeroImage(cfg, slug) {
  const f = readHtml(slug);
  if (f) {
    const c = f.content;
    const mainMatch = c.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const haystacks = [mainMatch ? mainMatch[1] : null, c].filter(Boolean);

    for (const h of haystacks) {
      const imgMatch = h.match(/<img[^>]*\bsrc="(images\/[^"]+\.(?:jpe?g|png|webp))"/i);
      if (imgMatch) {
        const rel = imgMatch[1].replace(/^images\/optimized\//, "").replace(/^images\//, "");
        const resolved = resolveImageInImages(rel);
        if (resolved) return resolved;
      }
      const srcsetMatch = h.match(/<source[^>]*\bsrcset="\s*images\/optimized\/([^"\s,]+?)-\d+\.webp/i);
      if (srcsetMatch) {
        const resolved = resolveImageInImages(srcsetMatch[1]);
        if (resolved) return resolved;
      }
    }
  }
  const logo = (cfg && cfg.site && cfg.site.logo) || "";
  return logo.replace(/^images\//, "") || null;
}

function writeHtml(slug, content) {
  const filename = slugToFile(slug);
  fs.writeFileSync(path.join(ROOT, filename), content, "utf8");
}

// Clone the live <nav>...</nav> and <footer>...</footer> from the home page,
// with all relative href/src rewritten to absolute /paths so the fragments
// work when reused on a shell page at any depth (404, legal pages, etc.).
function getSiteShell() {
  const home = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const header = home.slice(home.indexOf("<nav"), home.indexOf("<main"));
  const footer = home.slice(home.indexOf("<footer"), home.indexOf("</footer>") + "</footer>".length);
  const absolutize = (html) =>
    html
      .replace(/href="(?!https?:|\/|#|tel:|mailto:)([^"]+)"/g, 'href="/$1"')
      .replace(/src="(?!https?:|\/)([^"]+)"/g, 'src="/$1"');
  return { header: absolutize(header).trim(), footer: absolutize(footer).trim(), absolutize };
}

// Minimal script set needed for the cloned Divi nav's mobile hamburger toggle
// to work on generated shell pages (404, legal). The kit's original `js/nav.js`
// reference doesn't exist on Divi-exported sites — the toggle behaviour lives
// in Divi's own bundled scripts.min.js (jQuery + et-core common.js as deps).
const NAV_SCRIPTS_HTML = [
  "js/jquery.min.js",
  "js/jquery-migrate.min.js",
  "js/common.js",
  "js/scripts.min.js",
].map((src) => `<script src="/${src}"></script>`).join("\n  ");

function walkHtmlFiles(dir = ROOT) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "templates") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkHtmlFiles(p));
    } else if (entry.name.endsWith(".html")) {
      out.push(p);
    }
  }
  return out;
}

module.exports = {
  ROOT,
  loadConfig,
  applyDefaults,
  isMedicalSchemaType,
  getPage,
  canonicalUrl,
  slugToFile,
  escAttr,
  escDesc,
  readHtml,
  writeHtml,
  walkHtmlFiles,
  getHeroImage,
  getSiteShell,
  NAV_SCRIPTS_HTML,
};
