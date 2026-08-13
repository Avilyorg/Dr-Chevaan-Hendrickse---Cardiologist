// scripts/inject-seo.js
//
// For every page in site.config.yaml -> pages[], idempotently inject the
// per-page <head> SEO block (theme-color, canonical, OG, Twitter, manifest,
// favicon, apple-touch-icon, hreflang), the GTM head + noscript blocks, and
// the JSON-LD schemas appropriate to that page's schema_role.
//
// Re-running is safe — each block is guarded by a unique marker comment.

const {
  loadConfig, isMedicalSchemaType, canonicalUrl, escAttr, escDesc, readHtml, writeHtml,
} = require("./_lib.js");

const cfg = loadConfig();
const s = cfg.site;
const base = `https://${s.canonical_hostname}`;
const ogImg = `${base}/images/og-default.jpg`;
const businessNameAttr = escAttr(s.business_name);

function seoHeadBlock(page) {
  const canon = canonicalUrl(cfg, page.slug);
  const cssHref = `/${String(s.stylesheet).replace(/^\//, "")}`;
  const titleSuffix = page.slug === "/" ? "" : ` | ${s.business_name}`;
  // Home page title is the tagline alone for stronger keyword targeting.
  const titleFull = page.slug === "/"
    ? `${page.title} | ${s.business_name}`
    : `${page.title}${titleSuffix}`;
  const titleAttr = escAttr(titleFull);
  const desc = escDesc(page.description);
  const keywordsTag = page.keywords
    ? `\n  <meta name="keywords" content="${escDesc(page.keywords)}">`
    : "";
  const robots = page.schema_role === "thank_you"
    ? `<meta name="robots" content="noindex, nofollow">`
    : `<meta name="robots" content="index, follow">`;
  return `<!-- BEGIN: seo-head (inject-seo.js) -->
  <title>${titleAttr}</title>
  <meta name="description" content="${desc}">${keywordsTag}
  <meta name="theme-color" content="${s.brand_color}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://www.googletagmanager.com">
  <link rel="preload" as="style" href="${cssHref}" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="${cssHref}"></noscript>
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/images/favicon-192.png">
  <link rel="icon" type="image/png" sizes="512x512" href="/images/favicon.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="canonical" href="${canon}">
  ${robots}

  <meta property="og:site_name" content="${businessNameAttr}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${titleAttr}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${ogImg}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${s.og_locale}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${titleAttr}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${ogImg}">

  <link rel="alternate" hreflang="en" href="${canon}">
  <link rel="alternate" hreflang="x-default" href="${canon}">
  <!-- END: seo-head -->`;
}

function gtmHeadBlock() {
  return `<!-- BEGIN: gtm-head (inject-seo.js) -->
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','${s.gtm_id}');</script>
  <!-- End Google Tag Manager -->
  <!-- END: gtm-head -->`;
}

function gtmBodyBlock() {
  return `<!-- BEGIN: gtm-body (inject-seo.js) -->
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${s.gtm_id}"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
  <!-- END: gtm-body -->`;
}

function cwvReporterBlock() {
  return `<!-- BEGIN: cwv-reporter (inject-seo.js) -->
  <script defer src="/js/web-vitals.iife.js"></script>
  <script>
    (function () {
      function report(metric) {
        (window.dataLayer = window.dataLayer || []).push({
          event: "web_vitals",
          web_vitals_name: metric.name,
          web_vitals_value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
          web_vitals_rating: metric.rating,
          web_vitals_delta: Math.round(metric.name === "CLS" ? metric.delta * 1000 : metric.delta),
          web_vitals_navigation_type: metric.navigationType,
          web_vitals_id: metric.id,
        });
      }
      function start() {
        if (!window.webVitals) return;
        webVitals.onLCP(report);
        webVitals.onCLS(report);
        webVitals.onINP(report);
        webVitals.onFCP(report);
        webVitals.onTTFB(report);
      }
      if (document.readyState === "complete") start();
      else window.addEventListener("load", start);
    })();
  </script>
  <!-- END: cwv-reporter -->`;
}

// --- JSON-LD builders ---

function buildHoursSpec() {
  const hours = [];
  const dayMap = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  const grouped = {};
  for (const [k, v] of Object.entries(s.schema.hours || {})) {
    const day = dayMap[k];
    if (!day || !v) continue;
    grouped[v] = grouped[v] || [];
    grouped[v].push(day);
  }
  for (const [range, days] of Object.entries(grouped)) {
    const [opens, closes] = range.split("-");
    hours.push({ "@type": "OpeningHoursSpecification", dayOfWeek: days, opens, closes });
  }
  return hours;
}

function dentistEntityLd() {
  const types = [s.schema.type, ...(s.schema.secondary_types || [])];
  const ldType = types.length === 1 ? `"${types[0]}"` : JSON.stringify(types);
  const hours = buildHoursSpec();

  const obj = {
    "@context": "https://schema.org",
    "@type": types.length === 1 ? types[0] : types,
    "@id": `${base}/#entity`,
    name: s.business_name,
    image: ogImg,
    url: `${base}/`,
    telephone: s.contact.phone_e164,
    email: s.contact.email,
    priceRange: s.schema.price_range,
    currenciesAccepted: s.schema.currencies_accepted,
    paymentAccepted: s.schema.payment_accepted,
  };
  if (isMedicalSchemaType(s.schema.type) && s.schema.medical_specialty) {
    obj.medicalSpecialty = s.schema.medical_specialty;
  }
  obj.address = {
    "@type": "PostalAddress",
    streetAddress: s.address.street,
    addressLocality: s.address.city,
    ...(s.address.postal_code ? { postalCode: s.address.postal_code } : {}),
    addressCountry: s.address.country_iso,
  };
  if (s.address.geo) {
    obj.geo = {
      "@type": "GeoCoordinates",
      latitude: s.address.geo.latitude,
      longitude: s.address.geo.longitude,
    };
  }
  if (s.address.google_maps_url) obj.hasMap = s.address.google_maps_url;
  obj.areaServed = [
    { "@type": "City", name: s.address.city },
    ...(s.address.street ? [{ "@type": "Place", name: s.address.street.split(",")[1]?.trim() || s.address.city }] : []),
    { "@type": "Country", name: cfg.legal.jurisdiction_full.replace(/^the /, "") },
  ];
  if (s.contact.whatsapp_e164) {
    obj.contactPoint = {
      "@type": "ContactPoint",
      telephone: s.contact.whatsapp_e164,
      contactType: "customer service",
      availableLanguage: s.schema.languages,
    };
  }
  if (hours.length) obj.openingHoursSpecification = hours;
  if (s.socials) {
    const same = Object.values(s.socials).filter(Boolean);
    if (same.length) obj.sameAs = same;
  }
  return wrapLd(obj);
}

function organizationLd() {
  const logoPath = s.logo || "images/logo.png";
  const obj = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: s.business_name,
    url: `${base}/`,
    logo: `${base}/${logoPath}`,
    contactPoint: {
      "@type": "ContactPoint",
      telephone: s.contact.phone_e164,
      contactType: "customer service",
      email: s.contact.email,
      areaServed: s.address.country_iso,
      availableLanguage: s.schema.languages,
    },
  };
  if (s.socials) {
    const same = Object.values(s.socials).filter(Boolean);
    if (same.length) obj.sameAs = same;
  }
  return wrapLd(obj);
}

function branchLd(loc, idx) {
  const countryIso = loc.country_iso || s.address.country_iso;
  const obj = {
    "@context": "https://schema.org",
    "@type": s.schema.type,
    "@id": `${base}/#location-${idx + 1}`,
    name: loc.label ? `${s.business_name} — ${loc.label}` : s.business_name,
    branchOf: { "@id": `${base}/#entity` },
    parentOrganization: { "@id": `${base}/#organization` },
    telephone: s.contact.phone_e164,
    email: s.contact.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: loc.street,
      addressLocality: loc.city,
      ...(loc.postal_code ? { postalCode: loc.postal_code } : {}),
      addressCountry: countryIso,
    },
  };
  if (loc.geo) {
    obj.geo = {
      "@type": "GeoCoordinates",
      latitude: loc.geo.latitude,
      longitude: loc.geo.longitude,
    };
  }
  if (loc.google_maps_url) obj.hasMap = loc.google_maps_url;
  const hours = buildHoursSpec();
  if (hours.length) obj.openingHoursSpecification = hours;
  return wrapLd(obj);
}

function websiteLd() {
  return wrapLd({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    url: `${base}/`,
    name: s.business_name,
    publisher: { "@id": `${base}/#entity` },
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}/?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  });
}

// Render one Person node. `idx`/`total` disambiguate multiple practitioners on
// the same about page with a stable @id (so the nodes don't collapse).
function personLd(p, page, idx = 0, total = 1) {
  const pageUrl = canonicalUrl(cfg, page.slug);
  const obj = {
    "@context": "https://schema.org",
    "@type": "Person",
    ...(total > 1 ? { "@id": `${pageUrl}#person-${idx + 1}` } : {}),
    name: p.name,
    jobTitle: p.job_title,
    url: pageUrl,
    image: p.portrait ? `${base}/${p.portrait}` : ogImg,
    worksFor: { "@id": `${base}/#entity` },
  };
  if (p.alumni_of) {
    obj.alumniOf = { "@type": "CollegeOrUniversity", name: p.alumni_of };
  }
  if (Array.isArray(p.credentials) && p.credentials.length) {
    obj.hasCredential = p.credentials.map((c) => ({
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "Professional registration",
      recognizedBy: { "@type": "Organization", name: c.authority },
      identifier: c.id,
    }));
  }
  if (Array.isArray(p.knows_about) && p.knows_about.length) {
    obj.knowsAbout = p.knows_about;
  }
  return wrapLd(obj);
}

function serviceLd(page) {
  const t = page.schema_type || (isMedicalSchemaType(s.schema.type) ? "MedicalProcedure" : "Service");
  return wrapLd({
    "@context": "https://schema.org",
    "@type": t,
    name: page.title,
    description: page.description,
    url: canonicalUrl(cfg, page.slug),
    serviceType: page.service_type || page.title,
    provider: { "@id": `${base}/#entity` },
    performer: { "@id": `${base}/#entity` },
    areaServed: [
      { "@type": "City", name: s.address.city },
      { "@type": "Country", name: cfg.legal.jurisdiction_full.replace(/^the /, "") },
    ],
  });
}

function breadcrumbLd(page) {
  return wrapLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: page.title, item: canonicalUrl(cfg, page.slug) },
    ],
  });
}

function wrapLd(obj) {
  return `  <script type="application/ld+json">\n${JSON.stringify(obj, null, 2).split("\n").map((l) => "  " + l).join("\n")}\n  </script>`;
}

function jsonLdForPage(page) {
  const blocks = [];
  switch (page.schema_role) {
    case "home":
      blocks.push(dentistEntityLd(), organizationLd(), websiteLd());
      for (const [i, loc] of (s.locations || []).entries()) {
        blocks.push(branchLd(loc, i));
      }
      break;
    case "contact":
      blocks.push(dentistEntityLd(), breadcrumbLd(page));
      break;
    case "about": {
      // `people:` (list) or `person:` (single, or even a list) — every listed
      // practitioner gets a Person node. Don't silently feature just the first.
      const raw = page.people ?? page.person;
      const people = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      people.forEach((p, i) => blocks.push(personLd(p, page, i, people.length)));
      blocks.push(breadcrumbLd(page));
      break;
    }
    case "service":
      blocks.push(serviceLd(page), breadcrumbLd(page));
      break;
    case "legal":
    case "other":
      blocks.push(breadcrumbLd(page));
      break;
  }
  if (!blocks.length) return "";
  return `<!-- BEGIN: json-ld (inject-seo.js) -->\n${blocks.join("\n")}\n  <!-- END: json-ld -->`;
}

// --- Injection helpers ---

// NOTE: all insertions use function replacers so that `$` characters in the
// injected block (e.g. a "$$" priceRange in JSON-LD) are treated literally and
// not interpreted as String.replace special patterns ($$, $&, $1, ...).
function replaceBlock(content, beginMarker, endMarker, newBlock) {
  const re = new RegExp(`<!-- BEGIN: ${beginMarker}[\\s\\S]*?<!-- END: ${endMarker} -->`, "m");
  if (re.test(content)) return content.replace(re, () => newBlock);
  return null;
}

function ensureBeforeClosingHead(content, block, marker) {
  const replaced = replaceBlock(content, marker, marker, block);
  if (replaced) return replaced;
  return content.replace(/(\s*)<\/head>/, (m, p1) => `\n  ${block}\n${p1}</head>`);
}

function ensureAfterMetaCharset(content, block, marker) {
  const replaced = replaceBlock(content, marker, marker, block);
  if (replaced) return replaced;
  return content.replace(/(<meta charset="UTF-8">)/i, (m) => `${m}\n  ${block}`);
}

function ensureAfterBodyOpen(content, block, marker) {
  const replaced = replaceBlock(content, marker, marker, block);
  if (replaced) return replaced;
  return content.replace(/(<body[^>]*>)/i, (m) => `${m}\n  ${block}`);
}

// Remove hand-authored <title>/<meta description>/font preconnects that live
// OUTSIDE the managed BEGIN/END blocks, so injecting (or re-injecting) seo-head
// on a pre-built page doesn't leave duplicates. Managed blocks are protected,
// so this is idempotent on re-runs. The Google-fonts stylesheet <link> is kept.
function dedupeHandAuthoredHead(content) {
  const blocks = [];
  let out = content.replace(/<!-- BEGIN:[\s\S]*?<!-- END: [a-z-]+ -->/g, (m) => {
    blocks.push(m);
    return `__MANAGEDBLOCK_${blocks.length - 1}__`;
  });
  out = out.replace(/<head\b[^>]*>([\s\S]*?)<\/head>/i, (full, head) => {
    const h = head
      .replace(/^[ \t]*<title>[\s\S]*?<\/title>[ \t]*\r?\n?/gim, "")
      .replace(/^[ \t]*<meta\s+name="description"[^>]*>[ \t]*\r?\n?/gim, "")
      .replace(/^[ \t]*<link\s+rel="preconnect"\s+href="https:\/\/fonts\.googleapis\.com">[ \t]*\r?\n?/gim, "")
      .replace(/^[ \t]*<link\s+rel="preconnect"\s+href="https:\/\/fonts\.gstatic\.com"[^>]*>[ \t]*\r?\n?/gim, "")
      .replace(/^[ \t]*<link\s+rel="preconnect"\s+href="https:\/\/www\.googletagmanager\.com">[ \t]*\r?\n?/gim, "");
    return full.replace(head, h);
  });
  return out.replace(/__MANAGEDBLOCK_(\d+)__/g, (m, i) => blocks[Number(i)]);
}

// --- Main ---

let touched = 0;
for (const page of cfg.pages) {
  const f = readHtml(page.slug);
  if (!f) {
    console.warn(`⚠ skip ${page.slug} — file not found`);
    continue;
  }
  let c = f.content;

  c = dedupeHandAuthoredHead(c);
  c = ensureAfterMetaCharset(c, gtmHeadBlock(), "gtm-head");
  c = ensureAfterBodyOpen(c, gtmBodyBlock(), "gtm-body");
  c = ensureBeforeClosingHead(c, seoHeadBlock(page), "seo-head");
  c = ensureBeforeClosingHead(c, cwvReporterBlock(), "cwv-reporter");
  const ld = jsonLdForPage(page);
  if (ld) c = ensureBeforeClosingHead(c, ld, "json-ld");

  if (c !== f.content) {
    writeHtml(page.slug, c);
    touched++;
    console.log(`✓ ${page.slug}`);
  } else {
    console.log(`  ${page.slug} (no change)`);
  }
}

console.log(`\nDone. ${touched} of ${cfg.pages.length} pages updated.`);
