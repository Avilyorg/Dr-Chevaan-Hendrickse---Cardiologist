// Verifies the client handler's payload lines up with what the worker reads, so
// a real submission produces a correct email.
//   node --test test/

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { render } = require("../scripts/build-contact-js.js");
const { WORKER_PAYLOAD } = require("../scripts/form-contract.js");

const ROOT = path.resolve(__dirname, "..");

test("the rendered handler sends every key the worker destructures", () => {
  const js = render({ site: { recaptcha_site_key: "TEST_SITE_KEY" } });
  const payloadMatch = js.match(/const payload = \{([\s\S]*?)\};/);
  assert.ok(payloadMatch, "handler payload object not found");
  const payload = payloadMatch[1];

  const worker = fs.readFileSync(path.join(ROOT, "templates", "worker.template.js"), "utf8");
  const destructured = worker.match(/const \{([\s\S]*?)\} = data;/)[1]
    .split(",").map((s) => s.trim()).filter(Boolean);

  for (const key of destructured) {
    if (key === "token") continue; // from reCAPTCHA, still sent by the handler
    assert.ok(new RegExp(`\\b${key}\\b`).test(payload), `handler payload is missing "${key}" (worker reads it)`);
  }
  // And the contract's declared payload matches what the handler emits.
  for (const key of WORKER_PAYLOAD) {
    assert.ok(new RegExp(`\\b${key}\\b`).test(payload), `handler payload is missing contract key "${key}"`);
  }
});

test("the rendered handler has no unsubstituted tokens and embeds the contract", () => {
  const js = render({ site: { recaptcha_site_key: "TEST_SITE_KEY" } });
  assert.ok(!/%%[A-Z_]+%%/.test(js), "unsubstituted %%TOKEN%% left in the rendered handler");
  assert.match(js, /const FORM_CONTRACT = \{/); // contract inlined, not left as a token
  assert.match(js, /"HONEYPOT":"website"/);
});
