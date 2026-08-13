# Contributing

Thanks for improving the kit. It's used to launch real client sites, so a regression here
ships to production somewhere else. The rules below exist for that reason.

## Getting set up

```bash
git clone https://github.com/Avilyorg/cloudflare-launch-kit.git
cd cloudflare-launch-kit
npm install
npm test          # 29 unit tests, no config or network needed
```

Node 20+ (CI runs 20, 22, and 24). You do **not** need a Cloudflare account, a site, or any
keys to work on the kit itself — the unit tests run standalone. `node scripts/preflight.js`
is expected to fail in this repo: there's no `index.html` or `site.config.yaml` here, because
the kit is copied *into* a site repo rather than run in place.

## Working on a change

1. Branch off `main` — `git checkout -b your-change`.
2. Make the change.
3. `npm test` must pass.
4. Open a PR. CI runs the tests on every push; a green tick is required before merge.

Keep PRs small and single-purpose. A PR that fixes one script is easy to review; a PR that
touches eight is not.

## Things that will get a PR sent back

- **A hardcoded client value.** No real GTM IDs, reCAPTCHA keys, phone numbers, domains, or
  email addresses — anywhere, including tests and docs. Everything is a placeholder
  (`example.co.za`) and `preflight.js` fails on any placeholder left unedited. That's the
  design; don't defeat it.
- **A secret.** No `.env`, no API keys, no tokens. The reCAPTCHA secret and SendGrid key live
  in Cloudflare (worker secret / Secrets Store), never in this repo.
- **A weakened worker.** `templates/worker.template.js` is security-critical. The tests in
  `test/worker-template.test.js` pin the invariants: HTML-escaping of form input, server-side
  reCAPTCHA score check, the honeypot, the security headers, the CSP, the canonical-host
  redirect. If your change makes one of those tests fail, the fix is your change — not the test.
- **A non-idempotent script.** Every script must be safe to re-run; launches get re-run all the
  time. If yours only works once, it's not done.

## Where things live

`cloudflare-site-launch.md` is the **source of truth** — the runbook Claude Code executes.
`README.md` is the script reference, and `OPERATOR-GUIDE.md` is the human walkthrough. If you
change pipeline behaviour, update the runbook in the same PR, and check whether the other two
now disagree with it. Where they conflict, the runbook wins.

Adding a script? It reads `site.config.yaml` through `scripts/_lib.js` like the others, gets an
npm alias in `package.json`, and gets a line in the README tree.

## Ideas and bugs

Open an issue. For a bug, the useful ones say what you ran, what you expected, and what you got
— redact client values first. Ideas are welcome as issues before you build them; it's cheaper to
agree on the approach than to rework a finished PR.
