// scripts/build-shell-pages.js
//
// Generates branded 404.html and thank-you.html.
//   - 404.html clones the live nav + footer from the home page (absolute /paths so
//     it works at any depth) and is self-contained (GTM, noindex).
//   - thank-you.html is a MINIMAL self-contained page: GTM (so the form_submit
//     conversion trigger still fires), noindex, a 2s meta-refresh back to "/", and a
//     centred branded message. It deliberately does NOT clone the nav/footer or load
//     site JS — a post-submit confirmation page should be lightweight, and cloning the
//     shell drags in dependencies (e.g. js/nav.js) that 404 on a stripped page.
//     Because it is self-contained it does NOT belong in pages[] and needs no inject-seo.
//
//   node scripts/build-shell-pages.js              # create only missing files
//   node scripts/build-shell-pages.js --force      # overwrite existing
//   node scripts/build-shell-pages.js --stdout 404 # preview one page, no write
//
// Idempotent by default: existing files are skipped.

const fs = require("node:fs");
const path = require("node:path");
const { ROOT, loadConfig, getSiteShell, NAV_SCRIPTS_HTML } = require("./_lib.js");

const cfg = loadConfig();
const s = cfg.site;
const cssHref = `/${String(s.stylesheet).replace(/^\//, "")}`;

const { header, footer } = getSiteShell();
const contactPage = cfg.pages.find((p) => p.schema_role === "contact");
const contactHref = contactPage ? `/${contactPage.slug === "/" ? "index.html" : contactPage.slug}` : "/index.html";

const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Lato:ital,wght@0,300;0,400;0,700;1,300;1,400&display=swap" rel="stylesheet">';

function thankYou() {
  const gtm = `  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','${s.gtm_id}');</script>
  <!-- End Google Tag Manager -->`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
${gtm}
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta http-equiv="refresh" content="2;url=/" />
  <title>Thank you for your enquiry! | ${s.business_name}</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: 'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background: #ffffff;
      color: ${s.brand_color};
      text-align: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .thank-you h1 { font-size: 2rem; font-weight: 700; margin: 0 0 12px; }
    .thank-you p { font-size: 1.05rem; color: #444; margin: 0; }
    .thank-you a { color: ${s.brand_color}; }
  </style>
</head>
<body>
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${s.gtm_id}"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
  <div class="thank-you">
    <h1>Thank you for your enquiry!</h1>
    <p>We&rsquo;ll be in contact shortly. Redirecting you to the <a href="/">home page</a>&hellip;
    If your enquiry is urgent, call <a href="tel:${s.contact.phone_e164}">${s.contact.phone_display}</a>.</p>
  </div>
</body>
</html>
`;
}

function notFound() {
  const gtm = `  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','${s.gtm_id}');</script>
  <!-- End Google Tag Manager -->`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
${gtm}
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Not Found | ${s.business_name}</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="${s.brand_color}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  ${FONTS}
  <link rel="stylesheet" href="${cssHref}">
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png">
  <link rel="manifest" href="/site.webmanifest">
</head>
<body>
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${s.gtm_id}"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->

  ${header}

  <main>
    <div style="text-align:center; padding: 80px 24px 40px;">
      <p style="color:${s.brand_color}; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 8px;">404</p>
      <h1 style="font-size:2rem; margin:0;">We couldn&rsquo;t find that page</h1>
    </div>
    <section style="padding: 0 24px 80px;">
      <div style="text-align:center; max-width:680px; margin:0 auto;">
        <p>The page you were looking for may have moved or no longer exists.</p>
        <div style="margin-top: 32px;">
          <a href="/index.html" style="display:inline-block; margin:0 8px; padding:12px 28px; background:${s.brand_color}; color:#fff; text-decoration:none; border-radius:4px;">Return Home</a>
          <a href="${contactHref}" style="display:inline-block; margin:0 8px; padding:12px 28px; background:${s.brand_color}; color:#fff; text-decoration:none; border-radius:4px;">Contact Us</a>
        </div>
      </div>
    </section>
  </main>

  ${footer}

  ${NAV_SCRIPTS_HTML}
</body>
</html>
`;
}

const pages = { "404.html": notFound, "thank-you.html": thankYou };

const args = process.argv.slice(2);
const force = args.includes("--force");
const stdoutIdx = args.indexOf("--stdout");
if (stdoutIdx !== -1) {
  const which = (args[stdoutIdx + 1] || "404").includes("thank") ? "thank-you.html" : "404.html";
  process.stdout.write(pages[which]());
  return;
}

for (const [file, gen] of Object.entries(pages)) {
  const dest = path.join(ROOT, file);
  const exists = fs.existsSync(dest) && fs.statSync(dest).size > 0;
  if (exists && !force) { console.log(`  ${file} (exists — skipped; use --force to overwrite)`); continue; }
  fs.writeFileSync(dest, gen());
  console.log(`✓ wrote ${file}`);
}
