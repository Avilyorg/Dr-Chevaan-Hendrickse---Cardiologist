// scripts/form-contract.js
//
// SINGLE SOURCE OF TRUTH for the contact-form field contract.
//
// The client handler (templates/ContactUs.template.js, rendered by
// build-contact-js.js) is GENERATED from this table, and the build-time gate
// (scripts/check-forms.js) validates every form's real markup against the SAME
// table. Because both sides read one object, the handler and the markup can no
// longer silently disagree on input `name`s — the bug where a form carries
// name="username" but the handler reads name="first_name" (so every submission
// dies at "Please complete the form") is now caught at build time.
//
// IMPORTANT: this adapts the HANDLER to the markup, never the reverse. To
// support a field whose `name` isn't listed, ADD the alias here — never rename
// the form markup.

// Hidden honeypot the worker relies on to silently drop bots. Every form must
// carry it; check-forms.js fails the build if it's absent.
const HONEYPOT = "website";

// Logical fields the worker/email need. For each, the handler tries the input
// `name` aliases in order and uses the first present on the form. A form
// satisfies a required field when it has an input/textarea/select whose `name`
// matches any alias.
const FIELDS = [
  {
    key: "name",
    required: true,
    // The name is special: it may be one field, or split given/family. `parts`
    // are read individually; `whole` is the single-field fallback.
    parts: {
      given: ["first_name", "firstname", "fname", "given_name"],
      family: ["last_name", "lastname", "surname", "lname", "family_name"],
    },
    whole: ["username", "name", "fullname", "full_name", "your_name", "contact_name"],
  },
  { key: "emailaddress",  required: true,  aliases: ["emailaddress", "email", "email_address", "e_mail", "your_email"] },
  { key: "telephone",     required: true,  aliases: ["telephone", "phone", "tel", "mobile", "cell", "phone_number", "contact_number"] },
  { key: "sendermessage", required: true,  aliases: ["sendermessage", "message", "enquiry", "inquiry", "comments", "comment", "your_message"] },
  { key: "service",       required: false, aliases: ["service", "subject", "department", "service_type", "interest"] },
];

// Keys the rendered worker destructures from the submission (worker.template.js
// handleForm). The contract test asserts the handler's payload includes every
// one of these. `website` is the honeypot; `token` comes from reCAPTCHA.
const WORKER_PAYLOAD = [
  "username", "first_name", "last_name",
  "emailaddress", "telephone", "sendermessage", "service",
  "website", "token",
];

// Flatten a field's accepted `name`s (name field spreads parts + whole).
function aliasesFor(field) {
  if (field.parts || field.whole) {
    return [...(field.parts?.given || []), ...(field.parts?.family || []), ...(field.whole || [])];
  }
  return field.aliases || [];
}

module.exports = { HONEYPOT, FIELDS, WORKER_PAYLOAD, aliasesFor };
