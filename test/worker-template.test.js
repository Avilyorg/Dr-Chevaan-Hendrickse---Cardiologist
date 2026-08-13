// Unit tests for templates/worker.template.js.
//   node --test test/
//
// The worker is the only thing between the public internet and the form handler,
// and it is generated, not hand-written. These tests render it exactly as
// scripts/build-worker.js does and assert that (a) the render is valid JS with no
// leftover tokens, and (b) the security invariants verify-launch.js gates on are
// actually in the template — so a bad edit fails here, not in production.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE = path.join(ROOT, "templates", "worker.template.js");

// Same token table as scripts/build-worker.js.
const TOKENS = {
  "%%CANONICAL_HOST%%": "example.co.za",
  "%%NON_CANONICAL_HOST%%": "www.example.co.za",
  "%%LAST_MODIFIED%%": "Thu, 01 Jan 2026 00:00:00 GMT",
  "%%DOMAIN%%": "example.co.za",
  "%%CONTACT_EMAIL%%": "owner@example.co.za",
  "%%FROM_EMAIL%%": "example-business@secureform.co.za",
  "%%BUSINESS_NAME%%": "Example Business",
  "%%LEGACY_REDIRECTS_JSON%%": JSON.stringify({ "/old-page": "/new-page.html" }),
};

function render() {
  let out = fs.readFileSync(TEMPLATE, "utf8");
  for (const [token, value] of Object.entries(TOKENS)) out = out.split(token).join(value);
  return out;
}

const worker = render();

test("every token is substituted", () => {
  const leftover = worker.match(/%%[A-Z_]+%%/g);
  assert.equal(leftover, null, `unsubstituted tokens: ${leftover && [...new Set(leftover)].join(", ")}`);
  assert.ok(!/\{\{[^}]+\}\}/.test(worker), "runbook-style {{...}} placeholder left in the template");
});

test("the rendered worker is syntactically valid ES module JS", () => {
  // The worker uses `export default` — parse it as a module, not CommonJS.
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wk-")), "worker.mjs");
  fs.writeFileSync(tmp, worker);
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});

test("non-canonical host is 301-redirected to the canonical one", () => {
  assert.match(worker, /NON_CANONICAL_HOST/);
  assert.match(worker, /status:\s*301/);
  assert.ok(worker.includes("www.example.co.za"), "non-canonical host not substituted");
});

test("form input is HTML-escaped before it reaches the email body", () => {
  assert.match(worker, /function escapeHtml/);
  // Every interpolated field in the SendGrid body must go through escapeHtml —
  // an unescaped ${field} here is stored XSS in the recipient's inbox.
  const body = worker.match(/const emailBody = `([\s\S]*?)`;/);
  assert.ok(body, "emailBody template literal not found");
  const rawInterpolations = body[1].match(/\$\{(?!escapeHtml|serviceRow)[^}]+\}/g);
  assert.equal(rawInterpolations, null, `unescaped field(s) in the email body: ${rawInterpolations}`);
});

test("the honeypot silently accepts and drops bot submissions", () => {
  assert.match(worker, /website/);
  assert.match(worker, /rejected_honeypot/);
});

test("legacy URL redirects: exact path, trailing slash, and pass-through", async () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wk-")), "worker.mjs");
  fs.writeFileSync(tmp, worker);
  try {
    const mod = await import(`file://${tmp.replace(/\\/g, "/")}`);
    const env = { ASSETS: { fetch: async () => new Response("ok") } };

    const redirected = await mod.default.fetch(new Request("https://example.co.za/old-page/"), env, {});
    assert.equal(redirected.status, 301);
    assert.equal(redirected.headers.get("Location"), "https://example.co.za/new-page.html");

    const redirectedNoSlash = await mod.default.fetch(new Request("https://example.co.za/old-page"), env, {});
    assert.equal(redirectedNoSlash.status, 301);
    assert.equal(redirectedNoSlash.headers.get("Location"), "https://example.co.za/new-page.html");

    const passthrough = await mod.default.fetch(new Request("https://example.co.za/some-other-page"), env, {});
    assert.equal(passthrough.status, 200);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});

test("reCAPTCHA is verified server-side with a score threshold", () => {
  assert.match(worker, /recaptcha\/api\/siteverify/);
  assert.match(worker, /env\.RECAPTCHA_SECRET/);
  assert.match(worker, /score/);
});

test("the security headers verify-launch requires are all present", () => {
  for (const header of [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Cross-Origin-Opener-Policy",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ]) {
    assert.ok(worker.includes(header), `${header} missing from the worker template`);
  }
});

test("the CSP allows the third parties the site actually loads", () => {
  // Each of these was a real breakage: reCAPTCHA frames, Google Maps embeds,
  // GTM, and the Cloudflare Web Analytics beacon all get blocked without them.
  for (const origin of [
    "https://www.google.com/recaptcha/",
    "https://maps.google.com",
    "https://www.googletagmanager.com",
    "static.cloudflareinsights.com",
  ]) {
    assert.ok(worker.includes(origin), `CSP does not allow ${origin}`);
  }
});

test("responses are wrapped so static assets get the security headers", () => {
  assert.match(worker, /function withSecurityHeaders/);
  assert.match(worker, /env\.ASSETS\.fetch/);
  // Canonical Link header + Last-Modified on HTML responses.
  assert.match(worker, /rel="canonical"/);
  assert.match(worker, /Last-Modified/);
});
