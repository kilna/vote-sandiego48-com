# Agent / Cursor handoff

## Project

`vote-sandiego48-com` is the replacement voting application for `vote.sandiego48.com`. It is designed for phone-heavy use during San Diego 48 Hour Film Project screenings.

## Current architecture

- Vite + TypeScript frontend in `src/`; Cloudflare Pages serves the built `dist/` directory.
- Pages Functions in `functions/api/` provide the runtime API.
- D1 stores screenings, polls, options, vote-code hashes, and votes.
- R2 stores option images and screening banner images.
- `migrations/0001_initial.sql` is the initial D1 schema.
- `wrangler.toml` declares the Pages, D1, and R2 bindings. Replace the D1 placeholder before deployment.
- GitHub Actions deploys `dist/` using `cloudflare/wrangler-action@v3`.

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

## Cloudflare setup still required

1. Create a Pages project named `vote-sandiego48-com`.
2. Create a D1 database named `vote-sandiego48-com`; put its ID in `wrangler.toml`.
3. Create an R2 bucket named `vote-sandiego48-com`.
4. Apply the migration with Wrangler.
5. Set the Pages secret `ADMIN_TOKEN`.
6. Add GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
7. Attach `vote.sandiego48.com` to the Pages project and verify DNS/HTTPS separately.

## Important follow-up work

- Add admin endpoints/UI for screening CRUD, admin-overridden start/stop times, code generation, and vote results/export.
- Add package validation: required fields, aspect-ratio/quantity enforcement, duplicate image names, maximum image sizes, and path traversal rejection.
- Ensure screening banner files are imported into R2 and exported from R2; the current import stores option image files and persists the banner key, but banner ingestion should be made explicit.
- Make import transactional or stage/validate before mutating D1/R2.
- Add rate limiting / abuse protection and a real admin authentication strategy instead of a shared bearer token.
- Add local D1/R2 integration tests or a Miniflare-compatible test harness.
- Add accessibility review on a real phone viewport, including keyboard focus, error announcements, and touch target sizing.
- Review the R2 asset route if keys may contain slashes; use a catch-all route or encode/decode a stable asset ID.
- Export currently emits stable package metadata and actual option image bytes; preserve deterministic filenames when improving package handling.

## Do not

- Commit D1 IDs, API tokens, admin tokens, or `.env` files.
- Treat Pages project creation, GitHub repo creation, deployment, custom-domain attachment, and DNS cutover as the same operation; verify each separately.
- Remove or migrate `vote48hfp.com` until the replacement is deployed and tested against a real screening package.
