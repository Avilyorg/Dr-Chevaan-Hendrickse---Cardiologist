// scripts/build-sitemap.js
//
// Emit sitemap.xml from site.config.yaml. Includes the Google image-sitemap
// extension when a hero image can be derived from each page's HTML.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig, canonicalUrl, getHeroImage } = require("./_lib.js");

const cfg = loadConfig();
// build_date is normalized to a W3C YYYY-MM-DD string in _lib.js#applyDefaults.
const lastmod = cfg.site.build_date;
const base = `https://${cfg.site.canonical_hostname}`;

function escXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function priorityFor(role) {
  switch (role) {
    case "home": return "1.0";
    case "contact": return "0.9";
    case "about": case "service": return "0.8";
    case "legal": return "0.3";
    default: return "0.5";
  }
}

function changefreqFor(role) {
  switch (role) {
    case "home": return "weekly";
    case "service": case "about": case "contact": return "monthly";
    case "legal": return "yearly";
    default: return "monthly";
  }
}

const entries = cfg.pages
  .filter((p) => p.schema_role !== "thank_you")
  .map((p) => {
    let block = `  <url>\n    <loc>${escXml(canonicalUrl(cfg, p.slug))}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreqFor(p.schema_role)}</changefreq>\n    <priority>${priorityFor(p.schema_role)}</priority>`;
    const hero = getHeroImage(cfg, p.slug);
    if (hero) {
      const imgUrl = `${base}/images/${hero}`;
      const title = `${p.title} at ${cfg.site.business_name}`;
      block += `\n    <image:image>\n      <image:loc>${escXml(imgUrl)}</image:loc>\n      <image:title>${escXml(title)}</image:title>\n    </image:image>`;
    }
    block += `\n  </url>`;
    return block;
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml, "utf8");
console.log(`✓ sitemap.xml emitted with ${cfg.pages.filter((p) => p.schema_role !== "thank_you").length} URLs.`);
