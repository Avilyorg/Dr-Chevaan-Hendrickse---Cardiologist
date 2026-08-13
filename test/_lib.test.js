// Unit tests for the config-derivation logic in scripts/_lib.js.
//   node --test test/
//
// applyDefaults() is where a wrong country_iso silently becomes the wrong
// currency, the wrong privacy law, or the wrong canonical host — all of which
// end up baked into JSON-LD and legal pages, where nobody re-reads them.

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyDefaults, isMedicalSchemaType } = require("../scripts/_lib.js");

// Minimal config with only the fields applyDefaults() needs.
function baseConfig(overrides = {}) {
  const cfg = {
    site: {
      domain: "example.co.za",
      business_name: "Example Business",
      logo: "images/logo.png",
      address: { country_iso: "ZA" },
      schema: {},
      ...overrides,
    },
    pages: [],
  };
  return cfg;
}

test("currency is derived from country_iso", () => {
  const za = baseConfig();
  applyDefaults(za);
  assert.equal(za.site.schema.currencies_accepted, "ZAR");

  const bw = baseConfig({ address: { country_iso: "BW" } });
  applyDefaults(bw);
  assert.equal(bw.site.schema.currencies_accepted, "BWP, ZAR, USD");
});

test("an unknown country falls back to USD rather than throwing", () => {
  const cfg = baseConfig({ address: { country_iso: "XX" } });
  applyDefaults(cfg);
  assert.equal(cfg.site.schema.currencies_accepted, "USD");
});

test("an explicit currency is not overwritten", () => {
  const cfg = baseConfig({ schema: { currencies_accepted: "EUR" } });
  applyDefaults(cfg);
  assert.equal(cfg.site.schema.currencies_accepted, "EUR");
});

test("og_locale is derived from country_iso", () => {
  const za = baseConfig();
  applyDefaults(za);
  assert.equal(za.site.og_locale, "en_ZA");

  const gb = baseConfig({ address: { country_iso: "GB" } });
  applyDefaults(gb);
  assert.equal(gb.site.og_locale, "en_GB");

  const xx = baseConfig({ address: { country_iso: "XX" } });
  applyDefaults(xx);
  assert.equal(xx.site.og_locale, "en");
});

test("data-protection law is looked up per jurisdiction", () => {
  const za = baseConfig();
  applyDefaults(za);
  assert.match(za.legal.data_protection_law_full, /Protection of Personal Information Act/);
  assert.equal(za.legal.data_protection_law_short, "POPIA");
  assert.equal(za.legal.governing_law_jurisdiction, "the Republic of South Africa");

  const bw = baseConfig({ address: { country_iso: "BW" } });
  applyDefaults(bw);
  assert.match(bw.legal.data_protection_law_full, /Data Protection Act, 2018/);
});

test("canonical + non-canonical hostnames flip with canonical_host", () => {
  const apex = baseConfig({ canonical_host: "apex" });
  applyDefaults(apex);
  assert.equal(apex.site.canonical_hostname, "example.co.za");
  assert.equal(apex.site.non_canonical_hostname, "www.example.co.za");

  const www = baseConfig({ canonical_host: "www" });
  applyDefaults(www);
  assert.equal(www.site.canonical_hostname, "www.example.co.za");
  assert.equal(www.site.non_canonical_hostname, "example.co.za");
});

test("canonical_host defaults to apex", () => {
  const cfg = baseConfig();
  applyDefaults(cfg);
  assert.equal(cfg.site.canonical_host, "apex");
  assert.equal(cfg.site.canonical_hostname, "example.co.za");
});

test("an unquoted YAML build_date (a Date) is normalized to YYYY-MM-DD", () => {
  // js-yaml parses `build_date: 2026-06-15` as a Date — the sitemap <lastmod>
  // and the worker's LAST_MODIFIED both need a plain string.
  const cfg = baseConfig({ build_date: new Date("2026-06-15T00:00:00Z") });
  applyDefaults(cfg);
  assert.equal(cfg.site.build_date, "2026-06-15");
  assert.equal(typeof cfg.site.build_date, "string");
});

test("defaults fill in stylesheet, favicon, price range, languages, image threshold", () => {
  const cfg = baseConfig();
  applyDefaults(cfg);
  assert.equal(cfg.site.stylesheet, "css/styles.css");
  assert.equal(cfg.site.favicon, "images/logo.png"); // falls back to the logo
  assert.equal(cfg.site.schema.price_range, "$$");
  assert.deepEqual(cfg.site.schema.languages, ["en"]);
  assert.equal(cfg.site.images.size_threshold_kb, 200);
});

test("agency credit defaults to the Avily credit and can be turned off", () => {
  const cfg = baseConfig();
  applyDefaults(cfg);
  assert.equal(cfg.site.agency_credit.required, true);
  assert.equal(cfg.site.agency_credit.match, "avily.co.za/");
  assert.deepEqual(cfg.site.agency_credit.deprecated, ["avily.azureedge.net"]);

  const off = baseConfig({ agency_credit: { required: false } });
  applyDefaults(off);
  assert.equal(off.site.agency_credit.required, false);
});

test("faq_container accepts a bare string and is normalized to a list", () => {
  const cfg = baseConfig({ schema: { faq_container: "content-wrap" } });
  applyDefaults(cfg);
  assert.deepEqual(cfg.site.schema.faq_container, ["content-wrap"]);
});

test("isMedicalSchemaType recognizes medical types only", () => {
  assert.ok(isMedicalSchemaType("Dentist"));
  assert.ok(isMedicalSchemaType("MedicalClinic"));
  assert.ok(!isMedicalSchemaType("LocalBusiness"));
  assert.ok(!isMedicalSchemaType("LawFirm"));
});
