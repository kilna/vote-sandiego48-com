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
- A vote code is unique across the site. The home page asks for that code and opens the screening it belongs to. One code is submitted once for all polls in that screening.
- Codes are SHA-256 hashed before storage; successful votes consume a code.
- Each poll independently declares minimum and maximum selections.
- Screenings, polls, options, images, and vote codes are created through `/api/admin`. `GET /api` links to `GET /api/openapi.json`. `GET /api/admin` lists `workflows.createScreening` in the order an agent should call it.
- `/admin` is a CRUD editor for those same routes. It asks for the admin bearer token and keeps it in session storage.
- Each screening has a configurable banner image; the public header renders it as a mobile-friendly hero.
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
- Browser access to `/admin` is gated by a Cloudflare Access email allow policy. That policy does not yet cover `/api/admin` or `vote-sandiego48-com.pages.dev`. The service token for agents is not created yet. See [Admin access](#admin-access).
- Pages secret `ADMIN_TOKEN` is unset. Leave it unset. `functions/api/admin/` still returns `401` with JSON `{"error":"Unauthorized..."}` unless that bearer token is present. Access is the admin gate; a later code change will verify `Cf-Access-Jwt-Assertion` and remove the bearer check.
- The Pages project is Direct Upload, with deployment via GitHub Actions; it is **not** natively Git-connected.
- The home page is a vote-code gate. A valid code opens that code's screening. Production still has no live screening or generated vote code. This is a deployed scaffold, **not a voting-ready service**.

## Admin access

Cloudflare Access is the only admin credential. People sign in through the existing email allow policy. An agent sends a service token. `ADMIN_TOKEN` stays out of Pages, GitHub, prompts, and this repo.

Public voting stays open. These paths stay outside every Access application:

- `https://vote.sandiego48.com/`
- `https://vote.sandiego48.com/s/*`
- `https://vote.sandiego48.com/api/enter`
- `https://vote.sandiego48.com/api/vote`
- `https://vote.sandiego48.com/api/screenings/*`
- `https://vote.sandiego48.com/api/assets/*`

The same paths on `vote-sandiego48-com.pages.dev` stay open too.

### Hermes: create the service token

This is Cloudflare configuration only. Do not change application code, do not set Pages secret `ADMIN_TOKEN`, and do not commit credentials.

1. Find the existing Access application that already allows the admin emails on `vote.sandiego48.com/admin`. Add public hostnames to that application so the email Allow policy and the new Service Auth policy cover the same set. Create a new application only if the existing one cannot hold these hostnames.
2. Add these hostnames and paths. A wildcard path does not include the path itself, and a blank path would protect the whole site, including public voting. Enter each path separately:

   | Hostname | Path |
   | --- | --- |
   | `vote.sandiego48.com` | `/admin` |
   | `vote.sandiego48.com` | `/api/admin` |
   | `vote.sandiego48.com` | `/api/admin/*` |
   | `vote-sandiego48-com.pages.dev` | `/admin` |
   | `vote-sandiego48-com.pages.dev` | `/api/admin` |
   | `vote-sandiego48-com.pages.dev` | `/api/admin/*` |

3. If preview deployments (`*.vote-sandiego48-com.pages.dev`) are enabled, add the same three paths there. If they are disabled, record that.
4. Leave the existing email Allow policy as an Allow policy.
5. Create a service token named `vote-sandiego48-admin-agent`. Use a non-expiring duration when the dashboard offers one; otherwise use one year (`8760h`). Copy the Client Secret at creation. Cloudflare shows it once.
6. On the same application, add a second policy named `vote-sandiego48-admin-agent`. Action **Service Auth** (Access API value `non_identity`). Include rule: selector Service Token, value `vote-sandiego48-admin-agent`. Keep this policy separate from the email Allow policy.
7. Leave service-token header mode on the default pair `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Do not set `read_service_tokens_from_header` to `Authorization`.
8. Prove the split with curl. A `302` or `403`, or a `Location` on `cloudflareaccess.com`, means Access blocked the request. Status `401` with a JSON body whose `error` starts with `Unauthorized` means the request reached the Function. `--max-redirs 0` keeps curl from following the Access login redirect.

   ```sh
   # Access challenge. No service-token headers.
   curl -sS -D - -o /dev/null --max-redirs 0 "https://vote.sandiego48.com/api/admin"
   curl -sS -D - -o /dev/null --max-redirs 0 "https://vote-sandiego48-com.pages.dev/api/admin"

   # Reaches the Function and returns 401 JSON until the bearer check is removed.
   curl -sS -D - --max-redirs 0 \
     -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     "https://vote.sandiego48.com/api/admin"

   # Public voting stays off Access: 200 for /, and no cloudflareaccess.com redirect for the API.
   curl -sS -D - -o /dev/null --max-redirs 0 "https://vote.sandiego48.com/"
   curl -sS -D - -o /dev/null --max-redirs 0 "https://vote.sandiego48.com/api/screenings/probe"
   ```

9. Update the status block below. Write the Client Secret only in the Hermes reply to the user. Keep it out of this file, the README, git, GitHub secrets, and Pages environment variables.

### Status

- Access application:
- Team domain:
- Application AUD:
- Protected hostnames and paths:
- Preview deployments:
- Service token name: `vote-sandiego48-admin-agent`
- Service token id:
- Service token client id:
- Service token expires:

An agent calls the admin API with:

```http
CF-Access-Client-Id: <client id>
CF-Access-Client-Secret: <client secret>
```

Read those values from `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in the environment. After Access accepts the token, it injects `Cf-Access-Jwt-Assertion`. The Function will trust that JWT once the bearer check is removed.

## Important follow-up work

- Verify `Cf-Access-Jwt-Assertion` in `functions/api/admin/` against the Access team certs and this application's AUD, then remove the `ADMIN_TOKEN` bearer check.
- Add vote results for a screening. Admin CRUD covers screenings, polls, options, images, and vote codes.
- Add tests for concurrent use of the same code and make vote-code consumption atomic with vote insertion; the current read-then-batch path is **not safe against simultaneous submissions**.
- `imageConfig` min, max, and aspect ratio are stored for the ballot and are not checked against the uploaded files. Uploading the same filename replaces the stored object.
- Add rate limiting and abuse protection on public vote submission.
- Add local D1/R2 integration tests or a Miniflare-compatible test harness.
- Add accessibility review on a real phone viewport, including keyboard focus, error announcements, and touch target sizing.

## Do not

- Do not commit API tokens, admin tokens, Access service-token secrets, or `.env` files. D1 IDs are resource identifiers, not credentials; `wrangler.toml` already contains the database ID. The Access Client ID may be recorded in this file; the Client Secret may not.
- Do not set Pages secret `ADMIN_TOKEN`. Do not put the Access service token in the `Authorization` header.
- Treat Pages project creation, GitHub repo creation, deployment, custom-domain attachment, and DNS cutover as the same operation; verify each separately.
- Remove or migrate `vote48hfp.com` until the replacement is deployed and tested against a real screening package.
