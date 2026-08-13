// scripts/fix-copyright-year.js
//
// Makes the footer copyright year dynamic so it never goes stale:
//   1. Wraps a hardcoded year in the copyright line (&copy; / © / &#169; + YYYY)
//      in <span class="current-year">YYYY</span> — the literal year stays as a
//      no-JS fallback.
//   2. Ensures a setter runs: if no existing script already sets .current-year
//      (e.g. js/nav.js), injects a tiny managed <script> before </body>.
//
// Idempotent. Default writes in place; `--check` reports pages with a bare
// static year and exits non-zero (for CI / verify gating).
//
//   node scripts/fix-copyright-year.js
//   node scripts/fix-copyright-year.js --check

const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./_lib.js");

const YEAR_RE = /(&copy;|&#169;|©)(\s*)(\d{4})\b/g;
const SETTER_BLOCK =
  '  <!-- BEGIN: footer-year (fix-copyright-year.js) -->\n' +
  '  <script>document.querySelectorAll(".current-year").forEach(function(el){el.textContent=new Date().getFullYear();});</script>\n' +
  '  <!-- END: footer-year -->';

// A setter already exists if the page (inline) or any locally-referenced script
// both targets .current-year and calls getFullYear().
function setterExists(html) {
  const sets = (txt) => txt.includes("current-year") && txt.includes("getFullYear");
  if (sets(html)) return true;
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => !/^https?:/i.test(s));
  for (const src of srcs) {
    const p = path.join(ROOT, src.replace(/^\//, ""));
    if (fs.existsSync(p) && sets(fs.readFileSync(p, "utf8"))) return true;
  }
  return false;
}

const check = process.argv.includes("--check");
const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let changed = 0;
const needWrap = [];

for (const file of files) {
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, "utf8");
  const before = html;

  // 1. Wrap bare copyright year (skips years already inside a <span>, since the
  //    char after &copy; is then "<", not a digit).
  const hadBareYear = YEAR_RE.test(html);
  YEAR_RE.lastIndex = 0;
  if (hadBareYear) {
    html = html.replace(YEAR_RE, (m, sym, sp, yr) => `${sym}${sp}<span class="current-year">${yr}</span>`);
    needWrap.push(file);
  }

  // 2. Ensure a setter exists for any .current-year span.
  if (html.includes('class="current-year"') && !setterExists(html) && !html.includes("BEGIN: footer-year")) {
    html = html.replace(/(\s*)<\/body>/i, (m, ws) => `\n${SETTER_BLOCK}${ws}</body>`);
  }

  if (html !== before) {
    if (!check) fs.writeFileSync(p, html);
    changed++;
    console.log(`${check ? "would update" : "✓"} ${file}`);
  }
}

if (check) {
  if (needWrap.length) {
    console.error(`\n✗ ${needWrap.length} page(s) have a hardcoded copyright year: ${needWrap.join(", ")}`);
    console.error("  Run `node scripts/fix-copyright-year.js` to make it dynamic.");
    process.exit(1);
  }
  console.log("✓ no hardcoded copyright years");
} else {
  console.log(`\nDone. ${changed} page(s) updated.`);
}
