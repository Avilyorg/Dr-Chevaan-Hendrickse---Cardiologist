// Cloudflare Worker template — rendered by scripts/build-worker.js from site.config.yaml.
// Do not edit the generated src/worker.js by hand; edit this template instead.
// Placeholder tokens are substituted at build time. Assumes canonical_host = apex for the
// corsFor() fallback origin; adjust if you canonicalize on www.
//
// Cloudflare Worker: static site + contact form handler (hardened)
//
// Bindings:
//   SENDGRID_API_KEY   - Secrets Store binding (shared across Avily sites)
//   RECAPTCHA_SECRET   - Worker Secret (v3 secret key), set on the worker under
//                        Settings > Variables and Secrets — NOT in Secrets Store
//   ASSETS             - Static assets binding (auto-created by [assets])

const FORM_ENDPOINT = "/PHPFORMS/contact-form";
const CANONICAL_HOST = "%%CANONICAL_HOST%%";   // canonical apex
const NON_CANONICAL_HOST = "%%NON_CANONICAL_HOST%%"; // gets 301-redirected to CANONICAL_HOST
const LAST_MODIFIED = "%%LAST_MODIFIED%%"; // bump per deploy

// One-time URL-migration map (old path → new path), keyed without a trailing
// slash. Populated from site.legacy_redirects — safe to leave empty ({}) for
// a greenfield site with no prior URL structure to preserve.
const LEGACY_REDIRECTS = %%LEGACY_REDIRECTS_JSON%%;

const ALLOWED_ORIGINS = new Set([
  "https://%%DOMAIN%%",
  "https://www.%%DOMAIN%%",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);

function corsFor(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  // Only echo an origin we explicitly allow. A disallowed cross-origin caller
  // gets NO Access-Control-Allow-Origin header, so the browser blocks the
  // response. The real contact form is same-origin (the worker serves the
  // site), and same-origin requests don't need CORS at all — so hard-blocking
  // here doesn't affect legitimate submissions.
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATIC_ASSET_RE = /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|webmanifest|xml|txt|map|mp4|webm)$/i;

function cacheControlFor(pathname) {
  if (STATIC_ASSET_RE.test(pathname)) return "public, max-age=86400, s-maxage=2592000";
  return "public, max-age=300, s-maxage=3600";
}

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  // Content-Security-Policy.
  //
  // `script-src` and `style-src` carry 'unsafe-inline' deliberately, and it
  // cannot simply be removed without breaking the site:
  //   - GTM injects tag <script>s at runtime, so it needs either 'unsafe-inline'
  //     or a per-request nonce paired with 'strict-dynamic'.
  //   - inject-seo.js emits two inline <script>s (GTM bootstrap, CWV reporter)
  //     and an inline `onload="..."` handler on the CSS-preload <link>.
  //   - the GTM <noscript> iframe uses an inline `style` attribute.
  //
  // UPGRADE PATH to drop 'unsafe-inline': have this worker rewrite each HTML
  // response (HTMLRewriter) to stamp a fresh per-request nonce into both this
  // header and every inline <script>, switch script-src to
  // "'self' 'nonce-<n>' 'strict-dynamic'", and refactor the inline `onload`
  // handler in inject-seo.js into a nonce'd <script>. That is a larger change
  // with real GTM-breakage risk, so it is intentionally left out of the kit.
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://www.googletagmanager.com https://static.cloudflareinsights.com 'unsafe-inline'",
    "frame-src https://www.google.com https://maps.google.com https://www.googletagmanager.com https://td.doubleclick.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "media-src 'self'",
    "connect-src 'self' https://www.google.com/recaptcha/ https://www.googletagmanager.com https://www.google-analytics.com https://analytics.google.com https://cloudflareinsights.com https://static.cloudflareinsights.com https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://td.doubleclick.net https://www.googleadservices.com",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; "),
};

function isHtmlPath(pathname) {
  return pathname === "/" || /\.html?$/i.test(pathname) || !/\.[a-z0-9]+$/i.test(pathname);
}

function canonicalUrlFor(pathname) {
  let p = pathname === "/index.html" ? "/" : pathname;
  return `https://${CANONICAL_HOST}${p}`;
}

function withSecurityHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (pathname && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", cacheControlFor(pathname));
  }
  if (pathname && isHtmlPath(pathname)) {
    if (!headers.has("Last-Modified")) headers.set("Last-Modified", LAST_MODIFIED);
    if (!headers.has("Link")) {
      headers.set("Link", `<${canonicalUrlFor(pathname)}>; rel="canonical"`);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // www → apex 301 (eliminate duplicate content)
    if (url.hostname === NON_CANONICAL_HOST) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Legacy URL migration — old site's paths 301 to their new equivalents.
    const trimmedPath = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
    const legacyTarget = LEGACY_REDIRECTS[trimmedPath];
    if (legacyTarget) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `https://${CANONICAL_HOST}${legacyTarget}${url.search}`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname === FORM_ENDPOINT) {
      const cors = { ...corsFor(request), "Cache-Control": "no-store" };
      if (request.method === "OPTIONS") {
        return withSecurityHeaders(new Response(null, { status: 204, headers: cors }));
      }
      if (request.method === "POST") {
        return withSecurityHeaders(await handleForm(request, env, cors));
      }
      return withSecurityHeaders(
        new Response("Method Not Allowed", { status: 405, headers: cors })
      );
    }

    const assetResponse = await env.ASSETS.fetch(request);
    return withSecurityHeaders(assetResponse, url.pathname);
  },
};

async function handleForm(request, env, cors) {
  const requestId = crypto.randomUUID();
  try {
    const contentType = request.headers.get("content-type") || "";
    let data;
    if (contentType.includes("application/json")) {
      data = await request.json();
    } else {
      const formData = await request.formData();
      data = Object.fromEntries(formData);
    }

    const {
      emailaddress, sendermessage, telephone, username, token,
      first_name, last_name, service, website,
    } = data;

    // Honeypot — fake success so bots never learn they were blocked.
    if (website && String(website).trim().length > 0) {
      console.log("form_submission", { requestId, status: "rejected_honeypot" });
      return Response.json({ success: true }, { status: 200, headers: cors });
    }

    if (!token) {
      console.log("form_submission", { requestId, status: "rejected_no_token" });
      return Response.json(
        { success: false, error: "No captcha token" },
        { status: 400, headers: cors }
      );
    }

    const recaptchaResponse = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: env.RECAPTCHA_SECRET,
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || "",
        }),
      }
    );

    const recaptchaResult = await recaptchaResponse.json();
    if (!recaptchaResult.success || (recaptchaResult.score ?? 0) < 0.5) {
      console.log("form_submission", {
        requestId,
        status: "rejected_recaptcha",
        score: recaptchaResult.score ?? null,
      });
      return Response.json(
        { success: false, error: "Captcha verification failed" },
        { status: 403, headers: cors }
      );
    }

    const sendgridKey = await env.SENDGRID_API_KEY.get();

    const serviceRow = service && String(service).trim()
      ? `<b>Service:</b> ${escapeHtml(service)}<br/>`
      : "";

    const emailBody = `
    <html>
      <p>
        <b>First Name:</b> ${escapeHtml(first_name)} ${escapeHtml(last_name)}<br/>
        <b>Telephone:</b> ${escapeHtml(telephone)}<br/>
        <b>Email:</b> ${escapeHtml(emailaddress)}<br/>
        ${serviceRow}
        <b>Message:</b> ${escapeHtml(sendermessage)}
      </p>
    </html>`;

    const emailResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          { to: [{ email: "%%CONTACT_EMAIL%%", name: "%%BUSINESS_NAME%%" }], subject: "Website Contact Request" },
        ],
        from: { email: "%%FROM_EMAIL%%", name: username },
        reply_to: { email: emailaddress, name: username },
        subject: "Website Contact Request",
        content: [{ type: "text/html", value: emailBody }],
      }),
    });

    if (!emailResponse.ok) {
      const errText = await emailResponse.text();
      console.error("form_handler_failed", {
        requestId,
        stage: "sendgrid",
        status: emailResponse.status,
        details: errText,
      });
      return Response.json(
        { success: false, error: "Email send failed", status: emailResponse.status, details: errText },
        { status: 500, headers: cors }
      );
    }

    console.log("form_submission", { requestId, status: "accepted" });
    return Response.json({ success: true }, { headers: cors });
  } catch (err) {
    console.error("form_handler_failed", {
      requestId,
      stage: "handler",
      err: err && err.message,
      stack: err && err.stack,
    });
    return Response.json(
      { success: false, error: "Internal error" },
      { status: 500, headers: cors }
    );
  }
}
