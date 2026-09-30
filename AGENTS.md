# Agent / Cursor handoff

## Project

`vote-sandiego48-com` is the replacement voting application for `vote.sandiego48.com`. It is designed for phone-heavy use during San Diego 48 Hour Film Project screenings.

## Current architecture

- Vite + TypeScript frontend in `src/`; Cloudflare Pages serves the built `dist/` directory.
- Pages Functions in `functions/api/` provide the runtime API.
- D1 stores screenings, polls, options, vote-code hashes, and votes.
- R2 stores option images and screening banner images via the `MEDIA` binding.
- `migrations/0001_initial.sql` is the initial D1 schema.
- `wrangler.toml` declares the live Pages, D1, and R2 bindings; the D1 ID is already configured and the initial migration has been applied remotely.
- GitHub Actions deploys `dist/` using `cloudflare/wrangler-action@v3` with Wrangler 4. The GitHub Actions Cloudflare token/account secrets are installed and a push-driven deploy has succeeded.
- The Pages project is Direct Upload (`source: null`), not Git-connected. Pushes still deploy through the GitHub Actions workflow; do not claim native Pages Git integration.

## Implemented behavior

- One screening can have multiple polls.
- One screening-scoped vote code is submitted once for all polls.
- Codes are SHA-256 hashed before storage; successful votes consume a code.
- Each poll independently declares minimum and maximum selections.
- Poll YAML declares default start/stop times through screening fields; the schema is ready for admin overrides.
- Poll packages are ZIPs with `poll.yaml` and `images/` files. `/admin` has the first import/export UI.
- Each screening has a configurable `banner_image_key`; the public header renders it as a mobile-friendly hero.
- Film options can have multiple stills, which cycle every four seconds. Poster and film image constraints are represented in `image_config`.
- Visual direction follows the current San Diego 48 site: purple, navy, orange, pink, yellow, halftone texture, and League Spartan.

## Development commands

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

## Cloudflare status

- Pages project, D1 database, and R2 bucket named `vote-sandiego48-com` exist; the initial D1 migration is applied.
- `vote.sandiego48.com` is attached to Pages and its Cloudflare DNS record is a proxied CNAME to `vote-sandiego48-com.pages.dev`. Pages domain status and both verification/validation statuses were confirmed active; the hostname was also checked through a headless browser.
- GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured, and a push-driven Wrangler 4 deployment succeeded.
- **Not configured:** Pages secret `ADMIN_TOKEN`. The shared-token admin interface remains unusable until that secret is set and is not production hardened.
- The Pages project is Direct Upload, with deployment via GitHub Actions; it is **not** natively Git-connected.
- The root URL deliberately says “No screening selected”; there is no live screening package or generated vote code yet. This is a deployed scaffold, **not a voting-ready service**.

## Important follow-up work

- Add admin endpoints/UI for screening CRUD, admin-overridden start/stop times, code generation, and vote results/export.
- Add tests for concurrent use of the same code and make vote-code consumption atomic with vote insertion; the current read-then-batch path is **not safe against simultaneous submissions**.
- Add package validation: required fields, aspect-ratio/quantity enforcement, duplicate image names, maximum image sizes, and path traversal rejection.
- Ensure screening banner files are imported into R2 and exported from R2; the current import stores option image files and persists the banner key, but banner ingestion should be made explicit.
- Make import transactional or stage/validate before mutating D1/R2.
- Add rate limiting / abuse protection and a real admin authentication strategy instead of a shared bearer token.
- Add local D1/R2 integration tests or a Miniflare-compatible test harness.
- Add accessibility review on a real phone viewport, including keyboard focus, error announcements, and touch target sizing.
- Review the R2 asset route if keys may contain slashes; use a catch-all route or encode/decode a stable asset ID.
- Export currently emits stable package metadata and actual option image bytes; preserve deterministic filenames when improving package handling.

## Do not

- Do not commit API tokens, admin tokens, or `.env` files. D1 IDs are resource identifiers, not credentials; `wrangler.toml` already contains the database ID.
- Treat Pages project creation, GitHub repo creation, deployment, custom-domain attachment, and DNS cutover as the same operation; verify each separately.
- Remove or migrate `vote48hfp.com` until the replacement is deployed and tested against a real screening package.
