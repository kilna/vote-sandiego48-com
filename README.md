# vote-sandiego48-com

Cloudflare Pages + Functions voting site for `vote.sandiego48.com`.

## Architecture

- Static frontend: Vite + TypeScript, deployed as Cloudflare Pages assets.
- Runtime data: Cloudflare D1 (screenings, configurable polls, options, one-use vote codes, votes).
- Images: Cloudflare R2. Each poll stores an `imageConfig` for aspect ratio and stills.
- Admin writes go through `/api/admin`. `GET /api` and `GET /api/openapi.json` describe the public and admin APIs, including the order of calls that creates a screening, its polls, images, and vote codes.
- `/admin` is the editing UI for those same routes.
- A single code is scoped to a screening and is consumed only after every poll validates successfully.

## Local development

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

The Pages project, D1 database, R2 bucket, domain/DNS, and initial migration are configured. GitHub Actions has Cloudflare token/account secrets and a verified successful push-driven deploy. The project uses Direct Upload via Actions, not native Pages Git integration.

The home page asks for a vote code. A valid code opens `/s/<screening-slug>` for the screening that code belongs to. Opening a screening link without first entering its code returns to the gate.

## API

`GET /api` is the public entry point. It links to `GET /api/openapi.json`, which is the contract for voting and for admin writes. An agent creating a screening should then call `GET /api/admin` and follow `workflows.createScreening`.

Admin requests send `Authorization: Bearer <ADMIN_TOKEN>`. Validation errors name the field. Slugs, polls, options, images, and vote codes are separate resources. There is no ZIP or YAML package.

`/admin` edits those resources in the browser: screenings, polls, options, banner and stills, and vote codes.

## Admin access

Cloudflare Access protects admin URLs. People use the existing email allow policy. An agent uses a service token named `vote-sandiego48-admin-agent`, sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`.

The email policy currently covers `/admin` on `vote.sandiego48.com`. It still needs `/api/admin`, `/api/admin/*`, and the same paths on `vote-sandiego48-com.pages.dev`. Public voting (`/`, `/s/*`, `/api/enter`, `/api/vote`, `/api/screenings/*`, `/api/assets/*`) stays outside Access.

`AGENTS.md` has the setup steps for creating that service token. Leave Pages secret `ADMIN_TOKEN` unset. The Functions still check it until they verify the Access JWT instead.

## Current scope

This is the first deployable foundation: public voting, multiple polls per screening, configurable selection rules, D1-backed one-use codes, R2 image serving, a documented admin API, a CRUD admin UI, and San Diego 48 visual styling. Next production hardening should add vote results, Access JWT verification in the admin Functions, and end-to-end tests against a local D1/R2 emulator.
