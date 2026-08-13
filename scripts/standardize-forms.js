// scripts/standardize-forms.js
//
// Automates runbook Phase 2.2 across every root *.html containing a <form>:
//   - injects the reCAPTCHA v3 + js/ContactUs.js <script> tags once per page
//   - drops form action=/method= and adds the onsubmit guard
//   - renames fields to the handler's contract (first_name/emailaddress/
//     telephone/sendermessage), updating matching id= and <label for=>
//   - adds the honeypot input if missing
//   - converts the submit control to <button type="button" onclick="onSubmit(event)">
//
// Idempotent: re-running makes no changes once a page is standardized.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig } = require("./_lib.js");
const { buildContactJs } = require("./build-contact-js.js");

const cfg = loadConfig();
const siteKey = cfg.site.recaptcha_site_key;

const htmlFiles = fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"));
const hasForm = htmlFiles.some((f) => /<form\b/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")));

// The <script src="js/ContactUs.js"> tag injected below must resolve to a real
// file, so render it now (with the site key substituted) — but only if this
// site actually has a form (a form-less brochure site needs no contact JS / key).
if (hasForm) console.log(`✓ ${path.relative(ROOT, buildContactJs(cfg))}`);
else console.log("  (no <form> found — skipping js/ContactUs.js)");

const FIELD_RENAMES = [
  ["username", "first_name"],
  ["name", "first_name"],
  ["email", "emailaddress"],
  ["phone", "telephone"],
  ["message", "sendermessage"],
];

const HONEYPOT =
  '<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" ' +
  'style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">';

const SCRIPTS =
  `  <script async defer src="https://www.google.com/recaptcha/api.js?render=${siteKey}"></script>\n` +
  `  <script src="js/ContactUs.js" defer></script>\n`;

function renameField(html, oldName, newName) {
  return html
    .replace(new RegExp(`(<(?:input|textarea|select)\\b[^>]*\\b(?:id|name)=")${oldName}("[^>]*)`, "g"),
      (m) => m.replace(new RegExp(`\\b(id|name)="${oldName}"`, "g"), `$1="${newName}"`))
    .replace(new RegExp(`(<label\\b[^>]*\\bfor=")${oldName}(")`, "g"), `$1${newName}$2`);
}

function standardizeForm(formHtml) {
  let f = formHtml;
  // Drop action/method, ensure onsubmit guard.
  f = f.replace(/<form\b([^>]*)>/i, (m, attrs) => {
    let a = attrs.replace(/\s+action="[^"]*"/i, "").replace(/\s+method="[^"]*"/i, "");
    if (!/onsubmit=/i.test(a)) a += ' onsubmit="event.preventDefault(); return false;"';
    return `<form${a}>`;
  });
  for (const [oldN, newN] of FIELD_RENAMES) f = renameField(f, oldN, newN);
  // Honeypot before the first button if absent.
  if (!/name="website"/.test(f)) {
    f = f.replace(/(\s*)(<button\b)/i, (m, ws, btn) => `${ws}${HONEYPOT}${ws}${btn}`);
  }
  // Convert submit control to a type=button onclick handler.
  f = f.replace(/<button\b([^>]*)>/gi, (m, attrs) => {
    if (/onclick="onSubmit/i.test(attrs)) return m;
    let a = attrs
      .replace(/\s+type="[^"]*"/i, "")
      .replace(/\s+data-(sitekey|callback|action)="[^"]*"/gi, "")
      .replace(/\s*\bg-recaptcha\b\s*/g, " ");
    return `<button${a} type="button" onclick="onSubmit(event)">`;
  });
  return f;
}

// Strip legacy reCAPTCHA v2 / invisible-captcha scaffolding that pre-built themes
// often ship. Left in place it loads grecaptcha twice (once v2, once via our v3
// loader with ?render=) which breaks grecaptcha.execute(). We only remove the BARE
// loader (no ?render= query) so our v3 loader — which always has ?render= — survives.
function stripLegacyRecaptcha(html) {
  return html
    // <script src="https://www.google.com/recaptcha/api.js"></script>  (no ?render=)
    .replace(/\s*<script\s+src=(["'])https:\/\/www\.google\.com\/recaptcha\/api\.js\1\s*>\s*<\/script>/gi, "")
    // dead invisible-captcha helper: <script ...>function YourOnSubmitFn(){…}</script>
    .replace(/\s*<script\b[^>]*>\s*function\s+YourOnSubmitFn\b[\s\S]*?<\/script>/gi, "");
}

let touched = 0;
for (const file of htmlFiles) {
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, "utf8");
  if (!/<form\b/i.test(html)) continue;
  const before = html;

  // Remove conflicting legacy reCAPTCHA v2 scaffolding before injecting our v3 loader.
  html = stripLegacyRecaptcha(html);

  // Inject scripts once.
  if (!html.includes("js/ContactUs.js")) {
    const fonts = /(<link href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>\r?\n)/;
    html = fonts.test(html)
      ? html.replace(fonts, (m) => m + SCRIPTS)
      : html.replace(/(\s*)<\/head>/i, (m, ws) => `\n${SCRIPTS}${ws}</head>`);
  }

  // Transform each <form>…</form>.
  html = html.replace(/<form\b[\s\S]*?<\/form>/gi, (form) => standardizeForm(form));

  if (html !== before) { fs.writeFileSync(p, html); touched++; console.log(`✓ ${file}`); }
  else console.log(`  ${file} (already standardized)`);
}
console.log(`\nDone. ${touched} pages updated.`);
