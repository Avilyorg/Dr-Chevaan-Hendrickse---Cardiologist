// scripts/check-forms.js
//
// Build-time gate: every <form> in the site's HTML must be satisfiable by the
// generated contact handler. Mirrors how build-contact-js.js fails on leftover
// %%TOKENS%% — here we fail on a form/handler `name` mismatch: the bug where a
// form has name="username" but the handler reads name="first_name", so every
// submission silently dies at "Please complete the form".
//
//   node scripts/check-forms.js        # exits non-zero on any mismatch
//
// The handler is ADAPTED to the markup via scripts/form-contract.js — this gate
// never asks you to edit a form. When it fails, add an alias to the contract.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, walkHtmlFiles } = require("./_lib.js");
const { FIELDS, HONEYPOT, aliasesFor } = require("./form-contract.js");

// Every input/textarea/select `name` inside one <form>…</form> block.
function formFieldNames(formHtml) {
  const names = [];
  const re = /<(?:input|textarea|select)\b[^>]*?\bname\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(formHtml)) !== null) names.push(m[1]);
  return names;
}

// Validate one form's names against the contract. Returns an array of messages
// (empty = OK). `fields`/`honeypot` are injectable so tests can reproduce the
// original (pre-fix) handler contract.
function checkForm(names, fields = FIELDS, honeypot = HONEYPOT) {
  const present = new Set(names.filter(Boolean));
  const errors = [];
  for (const field of fields) {
    if (!field.required) continue;
    const aliases = aliasesFor(field);
    if (!aliases.some((a) => present.has(a))) {
      errors.push(
        `no input for required field "${field.key}" — the handler reads ` +
        `${aliases.map((a) => `name="${a}"`).join(", ")}, but this form has ` +
        `${names.length ? names.map((n) => `"${n}"`).join(", ") : "no named inputs"}. ` +
        `If this form legitimately uses a different name, add it to scripts/form-contract.js.`
      );
    }
  }
  if (!present.has(honeypot)) {
    errors.push(`missing honeypot input name="${honeypot}" (the worker relies on it to drop bots)`);
  }
  return errors;
}

// Walk the site and collect issues without printing/exiting (reused by verify).
function collectFormIssues() {
  const fails = [], warns = [], passes = [];
  const known = new Set([...FIELDS.flatMap(aliasesFor), HONEYPOT]);
  for (const file of walkHtmlFiles()) {
    const html = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
    if (!forms.length) continue;
    if (!/src="js\/ContactUs\.js"/.test(html)) {
      fails.push(`${rel} — has a <form> but does not load js/ContactUs.js (form is inert)`);
    }
    forms.forEach((form, i) => {
      const label = forms.length > 1 ? `${rel} (form #${i + 1})` : rel;
      const names = formFieldNames(form);
      const errs = checkForm(names);
      if (errs.length) errs.forEach((e) => fails.push(`${label} — ${e}`));
      else passes.push(label);
      const ignored = names.filter((n) => n && !known.has(n));
      if (ignored.length) {
        warns.push(`${label} — inputs the handler ignores (check for a typo'd field name): ${ignored.map((n) => `"${n}"`).join(", ")}`);
      }
    });
  }
  return { fails, warns, passes };
}

module.exports = { formFieldNames, checkForm, collectFormIssues };

if (require.main === module) {
  const { fails, warns, passes } = collectFormIssues();
  console.log(`\n=== check-forms ===\n`);
  console.log(`Forms OK: ${passes.length}`);
  console.log(`Warnings: ${warns.length}`);
  console.log(`Failed:   ${fails.length}\n`);
  if (warns.length) { console.log("Warnings (non-blocking):"); for (const w of warns) console.log(`  ⚠ ${w}`); console.log(""); }
  if (fails.length) {
    console.log("Failures:");
    for (const f of fails) console.log(`  ✗ ${f}`);
    console.log("\nA form and the contact handler disagree on field names. Adapt the handler by adding the alias to scripts/form-contract.js — do NOT rename the form markup.");
    process.exit(1);
  }
  console.log("✓ every form is satisfiable by the contact handler");
}
