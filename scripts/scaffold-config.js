// scripts/scaffold-config.js
//
// Scans the repo's root *.html files and prints a `pages:` YAML block to stdout,
// ready to paste into site.config.yaml. Scrapes each page's <title> and
// <meta name="description"> and guesses schema_role from the filename.
//
// Non-destructive: only writes to stdout. Run during Phase 0 when migrating a
// pre-built site so you don't hand-build the pages[] table.
//
//   node scripts/scaffold-config.js > pages.snippet.yaml

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// Best-effort business_name so we can strip the " | Business" title suffix.
let businessName = "";
try { businessName = require("./_lib.js").loadConfig().site.business_name || ""; } catch (_) {}

function roleFor(file) {
  const n = file.toLowerCase();
  if (n === "index.html") return "home";
  if (n === "404.html") return null; // not part of pages[]
  if (/^about/.test(n)) return "about";
  if (/^contact/.test(n)) return "contact";
  if (/^thank[-_]?you/.test(n)) return "thank_you";
  if (/(privacy|terms|disclaimer|cookie|popia|gdpr)/.test(n)) return "legal";
  return "service"; // sensible default for the remaining content pages
}

function scrape(html, re) {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function stripSuffix(title) {
  if (businessName && title.endsWith(`| ${businessName}`)) {
    return title.slice(0, -(`| ${businessName}`).length).trim();
  }
  return title;
}

function yamlString(s) {
  // Quote if it contains YAML-significant characters.
  return /[:#\-?&*!|>'"%@`{}\[\],]/.test(s) ? JSON.stringify(s) : s;
}

const files = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith(".html"))
  .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));

const lines = ["pages:"];
for (const file of files) {
  const role = roleFor(file);
  if (role === null) continue;
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const slug = file === "index.html" ? '"/"' : file;
  const title = stripSuffix(scrape(html, /<title>([\s\S]*?)<\/title>/i)) || file.replace(/\.html$/, "");
  const desc = scrape(html, /<meta\s+name="description"\s+content="([^"]*)"/i);

  lines.push(`  - slug: ${slug}`);
  lines.push(`    title: ${yamlString(title)}`);
  lines.push(`    description: ${yamlString(desc)}`);
  lines.push(`    schema_role: ${role}`);
  if (role === "about") {
    lines.push(`    # One practitioner → person:  |  multiple → people: (list every one shown on the page)`);
    lines.push(`    # person:`);
    lines.push(`    #   name: `);
    lines.push(`    #   job_title: `);
    lines.push(`    #   portrait: `);
    lines.push(`    # people:`);
    lines.push(`    #   - { name: , job_title: , portrait: }`);
  }
  lines.push("");
}

process.stdout.write(lines.join("\n") + "\n");
