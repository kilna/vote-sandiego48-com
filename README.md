# vote-sandiego48-com

Cloudflare Pages + Functions voting site for `vote.sandiego48.com`.

## Architecture

- Static frontend: Vite + TypeScript, deployed as Cloudflare Pages assets.
- Runtime data: Cloudflare D1 (screenings, configurable polls, options, one-use vote codes, votes).
- Images: Cloudflare R2, with per-poll image constraints stored in YAML.
Poll packages are ZIP files containing `poll.yaml` plus an `images/` directory. The first admin UI is at `/admin`; it uses the Pages secret `ADMIN_TOKEN` as a bearer token. The package schema supports multiple polls, configurable selection counts, screening banner images, and per-poll image constraints.
- A single code is scoped to a screening and is consumed only after every poll validates successfully.

## Local development

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

The Pages project, D1 database, R2 bucket, domain/DNS, and initial migration are configured. GitHub Actions has Cloudflare token/account secrets and a verified successful push-driven deploy. The project uses Direct Upload via Actions, not native Pages Git integration. The `ADMIN_TOKEN` Pages secret is still unset, so the admin UI cannot authenticate yet.

The public route is `/s/<screening-slug>`. The root intentionally shows “No screening selected” until a real screening package is imported; no demo ballot is served. `/admin` provides the initial package import/export UI, but it is not yet production hardened.

## YAML package shape

```yaml
screening:
  slug: spring-screening
  title: Spring Screening
  timezone: America/Los_Angeles
  start_at: "2026-05-01T18:00:00-07:00"
  stop_at: "2026-05-01T23:00:00-07:00"
polls:
  - slug: poster
    title: Best Poster
    min_selections: 1
    max_selections: 1
    image_config: { aspectRatio: "2:3", min: 1, max: 1 }
    options:
      - title: Team Example
        images: [{ name: poster.jpg, path: images/poster.jpg, content_type: image/jpeg }]
```

## Current scope

This is the first deployable foundation: public voting, multiple polls per screening, configurable selection rules, D1-backed one-use codes, R2 image serving, YAML/ZIP admin plumbing, and San Diego 48 visual styling. Next production hardening should add a complete code-generation/results UI, richer package validation, durable image export, admin authentication/role management, and end-to-end tests against a local D1/R2 emulator.
