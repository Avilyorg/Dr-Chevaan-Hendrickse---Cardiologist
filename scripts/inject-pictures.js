// scripts/inject-pictures.js
//
// Walks every *.html in the repo. For each <img src="images/x.jpg"> where x.jpg
// appears in images/optimized/manifest.json, rewrites it to a <picture> block
// with WebP responsive variants + JPG fallback.
//
// Attribute preservation: ALL original <img> attributes are carried through
// (class, style, id, aria-*, alt, data-*, etc.) — only src/width/height/
// loading/fetchpriority/decoding are re-stamped from the manifest. This keeps
// styled images (e.g. class="service-card__image", inline-styled heroes) intact.
// Add data-no-optimize to an <img> to opt it out of rewriting entirely.
//
// First <img> inside <main> on each page gets fetchpriority="high" (LCP).
// All other rewritten images get loading="lazy".

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, walkHtmlFiles } = require("./_lib.js");

const MANIFEST_PATH = path.join(ROOT, "images", "optimized", "manifest.json");
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error("✗ images/optimized/manifest.json not found. Run `npm run optimize-images` first.");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

function manifestEntry(src) {
  // src is e.g. "images/foo.jpg" — the manifest is keyed by path relative to images/.
  const key = src.replace(/^images\//, "");
  return manifest[key] || manifest[key.replace(/\\/g, "/")];
}

// Strip the attributes we re-stamp from the manifest, keep everything else
// (class, style, id, aria-*, alt, data-*, …) so styling/semantics survive.
function preservedAttrs(rawAttrs) {
  return rawAttrs
    .replace(/\b(width|height|loading|fetchpriority|decoding)\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPictureBlock(src, rawAttrs, entry, { isHero }) {
  const baseName = path.basename(src, path.extname(src));
  // Build srcset from the manifest's stored paths (which preserve subdirectories),
  // not from baseName alone — otherwise images under images/<subdir>/ get a broken
  // WebP srcset pointing at images/optimized/<name>.webp instead of the real path.
  const sources = entry.variants
    .map((v) => `    ${v.file} ${v.width}w`)
    .join(",\n");
  const widths = entry.variants.length ? sources : `    ${entry.webp || `images/optimized/${baseName}.webp`} ${entry.width || 1200}w`;
  const sizesAttr = `(max-width: 800px) 100vw, 50vw`;
  const fallbackJpg = entry.fallback ? entry.fallback : `images/optimized/${baseName}.jpg`;
  const loadAttr = isHero ? 'fetchpriority="high"' : 'loading="lazy"';
  const extra = preservedAttrs(rawAttrs);
  const extraStr = extra ? ` ${extra}` : "";
  return `<picture>
  <source type="image/webp" srcset="
${widths}" sizes="${sizesAttr}">
  <img src="${fallbackJpg}" width="${entry.width || ""}" height="${entry.height || ""}" ${loadAttr}${extraStr}>
</picture>`;
}

// Match a simple <img src="images/x.jpg" alt="..." [other attrs]>
// We deliberately only handle <img> with src starting with "images/" and not
// already inside a <picture>.
const IMG_RE = /<img\s+([^>]*?)\bsrc="(images\/[^"]+\.(?:jpe?g|png))"([^>]*?)>/gi;

let total = 0;
let pagesTouched = 0;

for (const file of walkHtmlFiles()) {
  if (file.includes(path.sep + "templates" + path.sep)) continue;
  const original = fs.readFileSync(file, "utf8");

  // Skip if already converted (presence of <picture> with optimized webp source).
  let nextHeroSeen = false;
  const newContent = original.replace(IMG_RE, (match, beforeSrc, srcVal, afterSrc) => {
    const rawAttrs = `${beforeSrc} ${afterSrc}`;
    // Explicit opt-out, and skip nav-logo + footer-logo (own size constraints).
    if (/\bdata-no-optimize\b/.test(rawAttrs)) return match;
    if (/class="(nav-logo-img|footer-logo-img)"/.test(rawAttrs)) return match;
    const entry = manifestEntry(srcVal);
    if (!entry) return match;
    // Idempotent: the rewritten <img src> points to images/optimized/, which
    // doesn't match IMG_RE, so re-runs won't double-wrap.
    const isHero = !nextHeroSeen;
    if (isHero) nextHeroSeen = true;
    total++;
    return buildPictureBlock(srcVal, rawAttrs, entry, { isHero });
  });

  if (newContent !== original) {
    fs.writeFileSync(file, newContent, "utf8");
    pagesTouched++;
    console.log(`✓ ${path.relative(ROOT, file)}`);
  }
}

console.log(`\nDone. ${total} <img> tags rewritten across ${pagesTouched} pages.`);
