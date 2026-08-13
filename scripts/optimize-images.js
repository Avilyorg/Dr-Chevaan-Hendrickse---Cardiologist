// Image optimization pipeline
//
// Walks ./images recursively (skipping images/optimized) and, for every JPG/PNG
// larger than the size threshold, generates into ./images/optimized/<same-path>/:
//   - <name>.webp                full-resolution WebP (quality 80)
//   - <name>-480.webp etc.       responsive WebP widths (480/800/1200/1920) when smaller than original
//   - <name>.jpg                 mozjpeg-encoded JPEG fallback (quality 82)
//
// Also generates ./images/og-default.jpg at 1200x630 from a portrait or hero source.
// Writes ./images/optimized/manifest.json with width/height for every output image
// so the HTML updates know exact dimensions (used to prevent CLS).

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const IMAGES_DIR = path.join(ROOT, "images");
const OUT_DIR = path.join(IMAGES_DIR, "optimized");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const OG_OUTPUT = path.join(IMAGES_DIR, "og-default.jpg");

// Derive OG candidate filenames by scanning each page's HTML for its hero
// image (home page first, then about, then the rest). Falls back to a globby
// auto-detect when the kit hasn't been wired into a real repo yet.
function loadOgCandidates() {
  try {
    const { loadConfig, getHeroImage } = require("./_lib.js");
    const cfg = loadConfig();
    const pages = cfg.pages || [];
    const homeSlug = pages.find((p) => p.schema_role === "home")?.slug;
    const aboutSlug = pages.find((p) => p.schema_role === "about")?.slug;
    const home = homeSlug ? getHeroImage(cfg, homeSlug) : null;
    const about = aboutSlug ? getHeroImage(cfg, aboutSlug) : null;
    const rest = pages.map((p) => getHeroImage(cfg, p.slug)).filter(Boolean);
    const ordered = [home, about, ...rest].filter(Boolean);
    if (ordered.length) return [...new Set(ordered)];
  } catch (_) {}
  // Fallback: any file in images/ matching hero/about keywords
  try {
    return fsSync.readdirSync(IMAGES_DIR)
      .filter((n) => /hero|about/i.test(n) && /\.(jpe?g|png)$/i.test(n));
  } catch (_) { return []; }
}

const OG_SOURCE_CANDIDATES = loadOgCandidates();

const RESPONSIVE_WIDTHS = [480, 800, 1200, 1920];
// Skip anything already small (size_threshold_kb) and skip whole directories whose
// images aren't referenced on the site (images.skip). Both come from site.config.yaml.
let SIZE_THRESHOLD_KB = 200;
let SKIP_REL_DIRS = [];
try {
  const { loadConfig } = require("./_lib.js");
  const imagesCfg = loadConfig().site.images || {};
  if (imagesCfg.size_threshold_kb != null) SIZE_THRESHOLD_KB = imagesCfg.size_threshold_kb;
  // images.skip: array of repo-relative dirs, e.g. ["images/home/team"].
  if (Array.isArray(imagesCfg.skip)) SKIP_REL_DIRS = imagesCfg.skip;
} catch (_) {}
const SIZE_THRESHOLD_BYTES = SIZE_THRESHOLD_KB * 1024;
// Generated outputs we must never re-ingest as sources.
const SKIP_NAMES = new Set([
  "favicon.png",
  "favicon-32.png",
  "favicon-192.png",
  "apple-touch-icon.png",
  "og-default.jpg",
]);

function isImage(file) {
  return /\.(jpe?g|png)$/i.test(file);
}

// Directories to skip entirely (config-driven), resolved to absolute paths.
const SKIP_DIRS = new Set(SKIP_REL_DIRS.map((d) => path.resolve(ROOT, d)));

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (p === OUT_DIR || SKIP_DIRS.has(p)) continue;
      files.push(...(await walk(p)));
    } else if (isImage(entry.name)) {
      files.push(p);
    }
  }
  return files;
}

function bytesToKB(b) {
  return (b / 1024).toFixed(1);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function processOne(src, manifest, stats) {
  const rel = path.relative(IMAGES_DIR, src);
  const base = path.basename(src, path.extname(src));
  const stat = await fs.stat(src);

  if (SKIP_NAMES.has(path.basename(src))) { stats.skipped++; return; }
  if (stat.size < SIZE_THRESHOLD_BYTES) { stats.skipped++; return; }

  const targetDir = path.join(OUT_DIR, path.dirname(rel));
  await ensureDir(targetDir);

  const img = sharp(src, { failOn: "none" });
  const meta = await img.metadata();
  const origW = meta.width || 0;

  const webpFull = path.join(targetDir, `${base}.webp`);
  await sharp(src).webp({ quality: 80 }).toFile(webpFull);

  const variants = [];
  for (const w of RESPONSIVE_WIDTHS) {
    if (origW > w) {
      const out = path.join(targetDir, `${base}-${w}.webp`);
      await sharp(src).resize({ width: w }).webp({ quality: 80 }).toFile(out);
      variants.push({ width: w, file: out });
    }
  }

  const jpgFallback = path.join(targetDir, `${base}.jpg`);
  await sharp(src).jpeg({ quality: 82, mozjpeg: true }).toFile(jpgFallback);

  manifest[rel.replace(/\\/g, "/")] = {
    width: meta.width || null,
    height: meta.height || null,
    fallback: path.relative(ROOT, jpgFallback).replace(/\\/g, "/"),
    webp: path.relative(ROOT, webpFull).replace(/\\/g, "/"),
    variants: variants.map((v) => ({
      width: v.width,
      file: path.relative(ROOT, v.file).replace(/\\/g, "/"),
    })),
  };

  const newSize = (await fs.stat(jpgFallback)).size;
  const webpSize = (await fs.stat(webpFull)).size;
  stats.totalIn += stat.size;
  stats.totalOut += newSize + webpSize;
  stats.processed++;
  console.log(
    `✓ ${rel}  ${bytesToKB(stat.size)}KB → jpg ${bytesToKB(newSize)}KB, webp ${bytesToKB(webpSize)}KB` +
      (variants.length ? `, +${variants.length} widths` : "")
  );
}

async function generateFavicons() {
  let cfg;
  try {
    const { loadConfig } = require("./_lib.js");
    cfg = loadConfig();
  } catch (_) {
    console.warn("⚠ favicons: could not load site.config.yaml — skipped");
    return;
  }
  const source = cfg.site.favicon || cfg.site.logo;
  if (!source) {
    console.warn("⚠ favicons: no site.favicon or site.logo configured — skipped");
    return;
  }
  const sourcePath = path.join(ROOT, source);
  try { await fs.access(sourcePath); }
  catch (_) {
    console.warn(`⚠ favicons: source ${source} not found — skipped`);
    return;
  }
  const targets = [
    { name: "favicon.png", size: 512 },
    { name: "favicon-192.png", size: 192 },
    { name: "favicon-32.png", size: 32 },
    { name: "apple-touch-icon.png", size: 180 },
  ];
  for (const t of targets) {
    const out = path.join(IMAGES_DIR, t.name);
    await sharp(sourcePath)
      .resize({ width: t.size, height: t.size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`✓ ${t.name} generated from ${source} (${t.size}×${t.size})`);
  }
}

async function generateOgImage() {
  for (const candidate of OG_SOURCE_CANDIDATES) {
    const candidatePath = path.join(IMAGES_DIR, candidate);
    try {
      await fs.access(candidatePath);
      await sharp(candidatePath)
        .resize({ width: 1200, height: 630, fit: "cover", position: "centre" })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(OG_OUTPUT);
      console.log(`✓ og-default.jpg generated from ${candidate} (1200×630)`);
      return;
    } catch (_) {}
  }
  console.warn("⚠ No OG source image found; og-default.jpg was not generated.");
}

async function main() {
  await ensureDir(OUT_DIR);
  const files = await walk(IMAGES_DIR);
  console.log(`Found ${files.length} candidate images under ${IMAGES_DIR}`);

  const manifest = {};
  const stats = { processed: 0, skipped: 0, totalIn: 0, totalOut: 0 };

  for (const f of files) {
    try { await processOne(f, manifest, stats); }
    catch (err) { console.error(`✗ ${path.relative(IMAGES_DIR, f)}: ${err.message}`); }
  }

  await generateFavicons();
  await generateOgImage();
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log("\n=== Summary ===");
  console.log(`Processed: ${stats.processed}`);
  console.log(`Skipped:   ${stats.skipped}`);
  console.log(`Total input:  ${(stats.totalIn / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total output: ${(stats.totalOut / 1024 / 1024).toFixed(2)} MB (WebP + JPEG fallback combined)`);
  console.log(`Manifest:  ${path.relative(ROOT, MANIFEST)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
