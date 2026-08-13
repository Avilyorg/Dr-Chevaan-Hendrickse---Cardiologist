// scripts/extract-faqs.js
//
// For every page with schema_role: service in site.config.yaml, scrape <h2>
// elements + their following <p> siblings inside <main class="service-main">
// and emit a FAQPage JSON-LD block before </head>. Idempotent — guarded by a
// BEGIN/END marker comment.

const { loadConfig, readHtml, writeHtml } = require("./_lib.js");

const cfg = loadConfig();

function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function extractFaqs(html) {
  // Scrape the configured article container(s) so sidebar <p> tags (address,
  // phone, etc.) don't leak into FAQ answers. site.schema.faq_container is a
  // list of class names; each is tried as both <div> and <main>.
  let mainMatch = null;
  for (const cls of cfg.site.schema.faq_container) {
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    mainMatch = html.match(new RegExp(`<div class="${esc}">([\\s\\S]*?)<\\/div>`))
      || html.match(new RegExp(`<main class="${esc}">([\\s\\S]*?)<\\/main>`));
    if (mainMatch) break;
  }
  if (!mainMatch) return [];
  const main = mainMatch[1];
  const blocks = [...main.matchAll(/<h2[^>]*>([\s\S]+?)<\/h2>([\s\S]*?)(?=<h2|$)/g)];
  const items = [];
  for (const b of blocks) {
    const q = stripTags(b[1]);
    const pMatches = [...b[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
    const aParts = pMatches.map((m) => stripTags(m[1])).filter(Boolean);
    const a = aParts.join(" ").trim();
    if (q && a) items.push({ q, a });
  }
  return items;
}

function buildLdBlock(items) {
  const obj = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
  return `<!-- BEGIN: faqpage (extract-faqs.js) -->
  <script type="application/ld+json">
${JSON.stringify(obj, null, 2).split("\n").map((l) => "  " + l).join("\n")}
  </script>
  <!-- END: faqpage -->`;
}

function injectOrReplace(content, block) {
  const re = /<!-- BEGIN: faqpage[\s\S]*?<!-- END: faqpage -->/;
  // Function replacers so any `$` in FAQ text isn't read as a replacement pattern.
  if (re.test(content)) return content.replace(re, () => block);
  return content.replace(/(\s*)<\/head>/, (m, p1) => `\n  ${block}\n${p1}</head>`);
}

let touched = 0;
for (const page of cfg.pages) {
  if (page.schema_role !== "service") continue;
  const f = readHtml(page.slug);
  if (!f) continue;
  const items = extractFaqs(f.content);
  if (!items.length) {
    console.log(`  ${page.slug} (0 FAQs)`);
    continue;
  }
  const block = buildLdBlock(items);
  const updated = injectOrReplace(f.content, block);
  if (updated !== f.content) {
    writeHtml(page.slug, updated);
    touched++;
    console.log(`✓ ${page.slug} (${items.length} FAQs)`);
  } else {
    console.log(`  ${page.slug} (${items.length} FAQs, no change)`);
  }
}
console.log(`\nDone. ${touched} pages updated.`);
