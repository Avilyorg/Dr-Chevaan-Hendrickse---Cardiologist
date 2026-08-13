# Operator Guide — launching a site with the Cloudflare Launch Kit

This is the **human walkthrough** for an operator running a launch. It sits alongside
`cloudflare-site-launch.md` (the runbook Claude executes) and `README.md` (the script reference).
Where this guide and the runbook touch the same step, they now say the same thing — if they ever
disagree, the runbook wins.

You don't need to be a developer. Claude Code does the building; your job is to gather the right
values, paste the runbook, and confirm the prompts. Read every prompt before clicking yes.

---

## 0. Before you start

- **Get `cloudflare-launch-kit.zip`.** If you don't have it, ask your team lead — they hold the
  latest version. Extract (unzip) all files.
- **Tooling** (Node, Wrangler, PowerShell): don't worry about installing these up front. Claude will
  prompt you and either set them up or give you the commands when a step needs them.
- **Get the website on your PC.** If you've never worked on this site, clone its repo so it's on your
  local machine.

---

## 1. Drop the kit into the site repo

1. Select **all** files in the extracted `cloudflare-launch-kit` folder.
2. Copy them **into the root of your local site repo** — using the file explorer, **not** by
   dragging into VS Code. (Copying in the explorer avoids VS Code mangling paths.)

---

## 2. Fill in `site.config.example.yaml`

Open `site.config.example.yaml` and fill in the missing details (worker name, domain, business
info, etc.).

- You can ask Claude to pre-fill some of it from the live website. **Double-check everything it
  fills**, especially the **worker name** — and complete anything it couldn't.

### reCAPTCHA keys

1. Create the reCAPTCHA v3 keys in the Google console:
   <https://console.cloud.google.com/security/recaptcha>
2. Put the **site key** (public) into `recaptcha_site_key` in `site.config.example.yaml`.
3. The **secret key** is *not* pasted into the YAML and *not* put in Secrets Store. It goes on the
   worker itself, as a **Secret** — see step 3 below.

### Secrets Store ID

Nothing to do. `sendgrid.secrets_store_id` is already filled in with the Avily account store
(`0fbc4b9b538940cabc4dc3b766687b10`) and only changes if the Cloudflare account changes. It is the
only Secrets Store binding the kit uses — it holds the shared `SENDGRID_API_KEY`.

### Analytics / Tag Manager

1. Set up GTM / analytics.
2. Put the container ID into `gtm_id`, replacing `GTM-XXXXXXX`. Save all changes.

---

## 3. Add the reCAPTCHA secret to the Worker

The reCAPTCHA secret lives **on the worker**, never in Secrets Store:

Cloudflare → **Workers & Pages** → your worker (`worker_name` from the config) → **Settings** →
**Variables and Secrets** → **Add**:

- **Type:** Secret (not Variable — a plaintext Variable gets wiped on the next deploy).
- **Name:** `RECAPTCHA_SECRET` (must match `recaptcha_secret_name`).
- **Value:** the reCAPTCHA **secret** key (server-side, not the site key).

The worker has to exist before you can add a secret to it, so on a brand-new site the order is:
deploy once (step 5 gets you there) → add the secret → re-test the contact form. An encrypted Secret
**survives every deploy** — you never re-add it.

CLI equivalent, if you prefer: `npx wrangler secret put RECAPTCHA_SECRET`.

---

## 4. Generate `site.config.yaml`

Tell Claude:

> please create `site.config.yaml` and update it using `site.config.example.yaml`

---

## 5. Run the 10-phase build

1. Start a **fresh** Claude Code session (top-right "start new session" button).
2. Open `cloudflare-site-launch.md`, copy the **entire** file, paste it into the new chat, send.
3. Claude runs the phases. **Read each prompt** before confirming.

### Prompts you should expect

- **Config / path fixes.** Claude may flag a mismatch before running scripts (e.g. legal-page slugs
  that get corrected after Phase 5.5). Read it and confirm — it won't do destructive renames without
  your OK.
- **Secrets already set?** When it asks about the reCAPTCHA secret / SendGrid store, you can say
  **"done"** (you handled them in steps 2–3).
- **Keep clicking yes** through the next prompts (still reading them) until **Phase 6.3 — Image
  pipeline**.

### Phase 6.3 — Image pipeline (manual)

Run the commands Claude gives you **in your terminal**. To open a terminal: search "terminal" in the
Windows search bar, or in VS Code press `` Ctrl+` `` (the backtick key below Escape). Use whatever
method you know.

### FAQ / no FAQ section

If the site has no FAQ section, that's **fine** — the kit now treats missing FAQ schema as a
non-blocking warning and keeps going. You shouldn't be stopped by it. (If an older build does stop
and offer "Option B — skip for now," choose to continue; the FAQ schema is a nice-to-have SEO extra
you can add later.)

---

## 6. If you hit one of the old problems

These were genuine kit bugs and have been fixed. If you still see one, the kit may have regressed —
tell your team lead.

| Symptom | Should now be… |
| --- | --- |
| Contact form dead on first load (`js/ContactUs.js` 404) | Fixed — `build-contact-js.js` generates the file (with your site key) and `standardize-forms.js` runs it automatically. |
| reCAPTCHA secret disappears after `wrangler deploy` | You added it as a plaintext **Variable**. Re-add it as type **Secret** (Worker → Settings → Variables and Secrets) — encrypted Secrets persist across deploys. |
| Security headers (HSTS / CSP / COOP) missing on the live site | Fixed — `wrangler.toml` now sets `run_worker_first = true`, so the worker injects headers on every page. |
| Thank-you page not styled / shows the whole site / `js/nav.js` 404 (esp. on a re-launch) | Fixed (v3.1) — `thank-you.html` is now a minimal self-contained page. Run `node scripts/build-shell-pages.js --force` to regenerate a stale one. |
| FAQ step halts the build | Fixed — missing FAQ schema is a warning, not a blocker. |
| Form says "Please complete the form" even when filled in | Fixed (v3.3) — the handler is adaptive (reads whatever `name`s each form uses, per `scripts/form-contract.js`), and `check-forms.js` fails the build if a form and the handler can't agree on field names. |
| reCAPTCHA never returns a token / `grecaptcha.execute is not a function` | Fixed (v3.1) — `standardize-forms.js` strips leftover reCAPTCHA **v2** scaffolding that conflicted with our v3 loader. |
| Google Maps embed shows "This content is blocked" / reCAPTCHA frame blocked by CSP | Fixed (v3.1) — worker CSP `frame-src` allows `www.google.com` + `maps.google.com`. |
| Cloudflare Web Analytics beacon blocked by CSP | Fixed (v3.1) — worker CSP allows `static.cloudflareinsights.com`. |
| Hero/section background image still loads the large original | Expected — CSS `background-image`s aren't auto-optimized; wire them up with `image-set()` per Phase 6.5 of the runbook. |

---

## 7. QA the site before the client sees it

The build passing is not the same as the site being good. Two steps:

1. **Automated sweep** — in the terminal:
   ```bash
   node scripts/qa-audit.js
   ```
   It finds dead links, missing images, `href="#"` placeholders, lorem/TODO text, phone/email
   addresses that don't match `site.config.yaml`, and a missing or wrong-specialty Avily footer
   credit. Anything it lists as a **blocker** must be fixed.
2. **Page-by-page review** — start a fresh Claude Code session, paste the whole of `site-qa.md`, and
   send. Claude reviews every page for mobile responsiveness, layout consistency, messy HTML, and
   polish, then hands you a severity-ranked list. Nothing marked *blocker* may still be open when the
   client signs off.

---

## 8. Post-launch sanity checks

- Submit the contact form → you should land on `/thank-you.html` and receive the email.
- `curl.exe -I https://<domain>/` → confirm `strict-transport-security`, `content-security-policy`,
  and `cross-origin-opener-policy` are present. (On Windows use `curl.exe`, not the `curl` alias.)
- Re-deploy once and re-check the form still works (the secret should still be bound).

> This guide is a snapshot of the current process and will change as the kit is updated.
