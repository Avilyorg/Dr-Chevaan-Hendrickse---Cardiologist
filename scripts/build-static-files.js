// scripts/build-static-files.js
//
// Generates robots.txt and site.webmanifest from site.config.yaml — the two
// static files the runbook used to ask you to paste by hand (Phase 5.1/5.2),
// so the scripted pipeline can produce a complete site without manual steps.
// Also copies the vendored Core Web Vitals reporter into the site's js/, which
// inject-seo.js links from every page and verify-launch.js requires.
//
//   node scripts/build-static-files.js            # create only missing files
//   node scripts/build-static-files.js --force    # overwrite existing
//
// Idempotent by default: existing files are skipped (use --force to overwrite).

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig } = require("./_lib.js");

const cfg = loadConfig();
const s = cfg.site;

function robotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /src/

Sitemap: https://${s.canonical_hostname}/sitemap.xml
`;
}

function webmanifest() {
  return JSON.stringify(
    {
      name: s.business_name,
      short_name: s.business_name,
      icons: [
        { src: "/images/favicon-32.png", sizes: "32x32", type: "image/png" },
        { src: "/images/favicon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/images/favicon.png", sizes: "512x512", type: "image/png" },
      ],
      theme_color: s.brand_color,
      background_color: "#ffffff",
      display: "standalone",
      start_url: "/",
    },
    null,
    2
  ) + "\n";
}

const files = { "robots.txt": robotsTxt, "site.webmanifest": webmanifest };
const force = process.argv.slice(2).includes("--force");

for (const [file, gen] of Object.entries(files)) {
  const dest = path.join(ROOT, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !force) {
    console.log(`  ${file} (exists — skipped; use --force to overwrite)`);
    continue;
  }
  fs.writeFileSync(dest, gen());
  console.log(`✓ wrote ${file}`);
}

// --- Vendored assets ---
// inject-seo.js puts <script defer src="/js/web-vitals.iife.js"> on every page
// and its inline reporter calls the webVitals.* globals this file defines, so
// the library has to land in the site or every page 404s on it.
const VENDORED = { "assets/js/web-vitals.iife.js": "js/web-vitals.iife.js" };

for (const [from, to] of Object.entries(VENDORED)) {
  const src = path.join(ROOT, from);
  const dest = path.join(ROOT, to);
  if (!fs.existsSync(src)) {
    console.error(`✗ ${from} missing from the kit — re-copy the launch kit (site pages link /${to}).`);
    process.exitCode = 1;
    continue;
  }
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !force) {
    console.log(`  ${to} (exists — skipped; use --force to overwrite)`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`✓ wrote ${to}`);
}
