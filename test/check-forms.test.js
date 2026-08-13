// Unit tests for scripts/check-forms.js — the build-time gate that stops a form
// and the contact handler from silently disagreeing on input `name`s.
//   node --test test/
//
// The original production bug: a form rendered a single <input name="username">
// while the handler read name="first_name"/"last_name", so validation always
// failed with "Please complete the form". These tests prove the gate now catches
// that class of mismatch at build time.

const test = require("node:test");
const assert = require("node:assert/strict");
const { formFieldNames, checkForm } = require("../scripts/check-forms.js");
const { FIELDS } = require("../scripts/form-contract.js");

const form = (inner) => `<form>${inner}</form>`;
const HP = '<input name="website">';

test("a single username field + honeypot passes (the adaptive fix)", () => {
  const names = formFieldNames(form(`
    <input name="username"><input name="emailaddress">
    <input name="telephone"><textarea name="sendermessage"></textarea>${HP}`));
  assert.deepEqual(checkForm(names), []);
});

test("separate first_name/last_name (with email/phone/message aliases) also passes", () => {
  const names = formFieldNames(form(`
    <input name="first_name"><input name="last_name"><input name="email">
    <input name="phone"><textarea name="message"></textarea>${HP}`));
  assert.deepEqual(checkForm(names), []);
});

test("a form missing the email field fails with a clear message", () => {
  const names = formFieldNames(form(`
    <input name="username"><input name="telephone">
    <textarea name="sendermessage"></textarea>${HP}`));
  const errs = checkForm(names);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /required field "emailaddress"/);
});

test("a missing honeypot fails", () => {
  const names = formFieldNames(form(`
    <input name="username"><input name="emailaddress">
    <input name="telephone"><textarea name="sendermessage"></textarea>`));
  assert.match(checkForm(names).join("\n"), /honeypot input name="website"/);
});

test("REPRODUCES the original bug: the pre-fix handler (first_name/last_name only) rejects a username-only form", () => {
  // Model the OLD hard-coded handler: the name field had no `whole` fallback.
  const legacyFields = FIELDS.map((f) =>
    f.key === "name" ? { ...f, whole: [] } : f);
  const originalMarkup = form(`
    <input name="username" placeholder="Name"><input name="emailaddress">
    <input name="telephone"><textarea name="sendermessage"></textarea>${HP}`);
  const errs = checkForm(formFieldNames(originalMarkup), legacyFields);
  assert.match(errs.join("\n"), /required field "name"/); // build would have failed here
  // ...and the shipped contract (with the `username` alias) now passes it:
  assert.deepEqual(checkForm(formFieldNames(originalMarkup)), []);
});

test("formFieldNames pulls names from input, textarea, and select alike", () => {
  const names = formFieldNames(form(`
    <input type="text" name="first_name" placeholder="Name">
    <select name="service"><option>A</option></select>
    <textarea name="sendermessage"></textarea>`));
  assert.deepEqual(names, ["first_name", "service", "sendermessage"]);
});
