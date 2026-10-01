# vote-sandiego48-com

Cloudflare Pages + Functions voting site for `vote.sandiego48.com`.

## Architecture

- Static frontend: Vite + TypeScript, deployed as Cloudflare Pages assets.
- Runtime data: Cloudflare D1 (screenings, polls, options, one-use vote codes, votes).
- Images: Cloudflare R2. Each poll stores an `imageConfig` for aspect ratio, intended still counts, and a cycle flag.
- Admin writes go through `/api/admin`. `GET /api` links to `GET /api/openapi.json`. `GET /api/admin` lists `workflows.createScreening`.
- `/admin` edits those same resources in the browser.
- A vote code belongs to one screening and is unique across the site. One submission covers every poll in that screening.

## How voting works

The home page posts the ticket code to `POST /api/enter`. A recognized unused code is stored in `sessionStorage` and the browser opens `/s/<slug>`. Opening `/s/<slug>` without that session entry returns to the home page. `GET /api/screenings/<slug>` and `GET /api/assets/...` do not check the code.

`POST /api/vote` accepts a ballot only when the code is unused, the request time is within `startAt` and `stopAt`, and every poll's selection count is inside its minimum and maximum. It then writes the votes and marks the code used in one batch. Entering a code does not check the window. The ballot shows whether voting is open and still submits; a closed window returns 403.

The ballot frames stills with the poll's aspect ratio. An option with more than one still swaps images every four seconds. The stored `cycle` flag does not change that. Still-count minimums and maximums are stored and are not checked against uploaded files.

The screening `timezone` is a label. The admin form reads times in the browser's timezone and stores UTC instants. The ballot formats those instants in the viewer's timezone.

## Local development

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

`npm run dev` serves the Vite frontend only. Pages Functions, D1, and R2 run under Wrangler (`wrangler pages dev`). A gitignored `.dev.vars` file can set `ACCESS_DEV_BYPASS=1` so that local process accepts admin calls on localhost. `npm test` checks the admin contract and Access JWT rules. It does not cast votes against D1.

The Pages project, D1 database, R2 bucket, domain/DNS, and initial migration are configured. GitHub Actions has Cloudflare token/account secrets and a verified successful push-driven deploy. The project uses Direct Upload via Actions, not native Pages Git integration. Production has no live screening.

## API

`GET /api` is the public entry point. It links to `GET /api/openapi.json`. An agent creating a screening calls `GET /api/admin` and follows `workflows.createScreening`.

People administer the site through Cloudflare Access. Agents send `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Access adds `Cf-Access-Jwt-Assertion`, and the admin Functions verify that JWT. Allowed emails are any `@kilna.com` address and `sandiego@48hourfilm.com`. A service token has no email; its JWT is accepted when the signature, issuer, and audience match. Admin validation errors name the field. Public enter and vote errors are a single `error` string. Slugs, polls, options, images, and vote codes are separate resources. There is no ZIP or YAML import. Vote codes are hashed and can be counted, added, and removed; they cannot be listed.

Images are jpeg, png, webp, gif, or svg, up to 8 MiB. Uploading the same filename replaces the object. Asset responses are cached for one hour. Removing an image from an option, or deleting a poll or option, leaves the stored object. Deleting a screening deletes its stored images.

`/admin` edits screenings, polls, options, the banner, stills, and vote codes after Cloudflare Access signs the browser in.

## Admin access

Cloudflare Access protects admin URLs. People use the existing email allow policy. An agent uses a service token named `vote-sandiego48-admin-agent`, sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`.

Unauthenticated requests to `https://vote.sandiego48.com/api/admin` are challenged by Access. Public voting (`/`, `/s/*`, `/api/enter`, `/api/vote`, `/api/screenings/*`, `/api/assets/*`) stays outside Access.

`AGENTS.md` has the setup steps for creating that service token. Leave Pages secret `ADMIN_TOKEN` unset. The Wrangler token used here cannot read the Zero Trust organization, so the service token was not created from this session.

## Not implemented yet

- Vote results for a screening.
- The Access service token named in `AGENTS.md`, if it is not already on the Access application. The admin Functions already verify the Access JWT.
- Atomic vote-code consumption. Overlapping submissions of the same code can both record votes.
- A blank poll when `minSelections` is 0. That request fails, and the ballot uses a required radio whenever `maxSelections` is 1.
- The public ballot reading `imageConfig.cycle`, and checks that uploads match `imageConfig` min, max, and aspect ratio.
- Rate limiting on public vote submission.
- Tests against a local D1 and R2, including concurrent use of one code.
- An accessibility pass on a phone viewport: keyboard focus, error announcements, and touch target size.
