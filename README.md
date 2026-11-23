# Jobo piece for Activepieces

An [Activepieces](https://github.com/activepieces/activepieces) piece (connector) for the Jobo jobs API
(`https://connect.jobo.world`). It is written in upstream's layout for
`packages/pieces/community/jobo`, so it can be copied into a checkout of `activepieces/activepieces` as it is.

Nothing here has been sent upstream: no fork, no pull request, no npm publish. Read
[Before you open a pull request](#before-you-open-a-pull-request) first: upstream currently auto-closes pull
requests from outside contributors.

```
Jobo.Connectors/activepieces/
  README.md                         this file
  jobo/                             the piece, copy this folder
    package.json  tsconfig.json  tsconfig.lib.json  .eslintrc.json  vitest.config.ts  README.md
    src/
      index.ts                      createPiece + Custom API Call
      lib/
        auth.ts                     API key, validated against a free endpoint
        actions/                    search-jobs, get-job, find-company, geocode-location
        triggers/new-job.ts         New Job (polling)
        common/                     client, constants, filters, lookups, output, props
    test/                           vitest, HTTP mocked
```

## What the piece does

Auth is one secret text field, the Jobo API key (`jbe_live_...`). Every call goes through
`@activepieces/pieces-common`'s `httpClient`, with `@jobo-ai/connector-core@0.5.0` (the shared client behind the
n8n, Zapier, Make and WordPress connectors) supplying the filter contract, the request bodies and the error
classes. Billing text below is from `docs/billing.mdx` and `docs/connectors/overview.mdx` in this repo.

| Step | Endpoint | Billed |
| --- | --- | --- |
| Connect (auth validate) | `GET /api/connectors/filters` | Free (see "Not confirmed" below) |
| Search Jobs | `POST /api/jobs/search` | Every job returned, including one an earlier search returned. Included jobs first, then the wallet. |
| Get Job by ID | `GET /api/jobs/{id}` | Free (`billing.mdx`, "Always free") |
| Find Company | `GET /api/connectors/companies/suggest` | Free (see "Not confirmed" below) |
| Geocode Location | `GET /api/locations/geocode` | $0.001 per lookup, found or not; not covered by included jobs or Unlimited (`billing.mdx`, "Metered endpoints") |
| Custom API Call | any path under `https://connect.jobo.world` | Whatever the endpoint costs |
| New Job trigger | `POST /api/jobs/feed` | A job is billed once per 30 days; a job already received is re-delivered free (`billing.mdx`, "Unique jobs on Feed") |
| Dropdowns (sources, industries, skills, companies, places, occupations) | `GET /api/connectors/*`, `GET /api/occupations` | Free (see "Not confirmed" below) |

No property text states a price: the descriptions say what is billed and link to `https://jobo.world/pricing`,
because a saved flow keeps the text it was built with.

### Search Jobs

Filters: query, location, companies (and exclude), sources, skills (and exclude), work model, employment type,
experience level, language, industries (and exclude), job categories / subcategories / occupations (and
excludes), company categories (and exclude), salary range, posted after / before, search descriptions, sort,
description format, Maximum Jobs (default 10, max 100) and Page. It refuses to run with no filter, because an
empty search returns and bills the first page of the whole index. It returns an array of flat job records
(`id`, `title`, `company_name`, `city`, `salary_min`, ... , one level deep, so each key is a table column).

### New Job trigger

It reads the job feed, not search. Search bills every job a response returns, so any re-read of a window is
paid for again; the feed bills a job once per 30 days and re-delivers it free, so the small overlap this
trigger reads on purpose costs nothing.

- **Guard.** At least one of Locations, Sources, Companies, Industries, Job Categories, Job Subcategories or
  Occupations is required. It is enforced when the flow is turned on (`onEnable` fails the publish), when sample
  data is loaded and on every poll. It uses `assertHasNarrowingFilter` from connector-core.
- **Watermark.** `DedupeStrategy.TIMEBASED` through `pollingHelper`, with the whole `context` passed as upstream's
  lint rule requires. The window starts when the flow is turned on, so existing jobs are never delivered. The feed is
  oldest first by `created_at` (first-indexed time), so the stored watermark is the newest job read.
- **Overlap.** Each poll starts 60 seconds before the watermark, never before the moment the flow was turned on,
  and keeps the ids it emitted (last 2,000) in the trigger store. A job the index published late (created inside the
  overlap, not seen yet) is delivered once; a job created before the flow was turned on is not.
- **Caps.** 25 jobs per feed request and at most 20 requests per poll (500 jobs). A bigger backlog is drained over the
  next polls from the watermark. 25 keeps the wallet check at a quarter of the 100-job page; the check prices a full
  page even when the page is empty (`billing.mdx`, "Request flow").
- **Sample data.** Up to 5 jobs from the last 7 days, one request, newest first, nothing stored.
- **Output.** One flat job record per run, the same shape as Search Jobs.

### Dropdowns

Companies, locations, skills and occupations are searchable (`refreshOnSearch`): type at least 2 letters. Sources,
industries, job categories and subcategories load a list. Subcategories follow the picked categories; occupations
follow both. Picking a company sends every board id Jobo has for it. Static lists (work model, employment type,
experience level, language, company category, sort, description format) come from connector-core's constants.
Every value can also be mapped from an earlier step.

## How it was verified

See [Verification](#verification) at the bottom. It lists what was run and what was not.

## Before you open a pull request

Upstream's own files, read from a clone of `activepieces/activepieces` at commit `1d55703` (2026-11-22):

1. **Unsolicited pull requests from outside the core team are paused.** `CONTRIBUTING.md`, "Pull requests":
   "We've temporarily paused unsolicited pull requests from outside the core team. PRs from contributors who
   aren't organization members or collaborators are automatically closed with a friendly note. You can still
   build and publish your own piece ... as your own package outside this repo, rather than a PR here." The
   `.github/workflows/close-external-prs.yml` workflow closes a pull request on open unless the author is OWNER,
   MEMBER, COLLABORATOR or CONTRIBUTOR (an earlier merged PR), the author is a bot, or the PR has the `keep-open`
   label. `CONTRIBUTING.md` adds: "If you're an existing customer and we've already discussed this change with
   you over Slack, ping us there and we'll add the `keep-open` label and reopen your PR". So a PR from a new
   account will be closed unless a maintainer agrees first. Ask upstream (their Slack, or an issue using
   `.github/ISSUE_TEMPLATE/piece-request.md`) before spending review time.
2. **The documented alternative is your own package.** `docs/build-pieces/sharing-pieces/community.mdx`:
   rename the package in `package.json` to your own scope (for example `@jobo-ai/piece-jobo`), then
   `npm run publish-piece jobo`; users install it from "Settings -> My Pieces -> Install Piece".
   `docs/build-pieces/sharing-pieces/contribute.mdx` is the contribute path, and it is only two steps:
   "Build and test your piece. Open a pull request from your repository to the main fork. A maintainer will review
   your work closely."

If a maintainer agrees to a pull request, upstream currently requires:

| Requirement | Where | What it says |
| --- | --- | --- |
| Title | `.github/workflows/validate-pr-title.yml` | Semantic pull request title (`amannn/action-semantic-pull-request`, default types), for example `feat: add Jobo piece`. |
| Description | `.github/pull_request_template.md` | Sections: Description, "How was this tested?", "Linear ticket", "Breaking change?" (tick exactly one box, "CI fails if this is left unedited"), "Security impact?" (same rule). |
| Linear ticket | `tools/scripts/linear-ticket-check.ts` | "Community contributor? You need no Linear account and nothing to do. A maintainer adds a GIT or PIE ticket to your PR description, and the check runs again." |
| Labels | `AGENTS.md`, "Pull Requests" | One of `feature`/`bug`/`skip-changelog` (for a new piece the feature label), plus the pieces label for third-party pieces, `area/third-party-pieces`. |
| Breaking change | `AGENTS.md` | Tick "no": a new piece changes no API, field or env var. |
| Security impact | `.github/pull_request_template.md` | "Security-sensitive" is anything touching "authentication, secrets, ... outbound HTTP". This piece stores an API key and makes outbound calls, so tick "yes" and say in the description that the key only goes to `connect.jobo.world` in the `X-Api-Key` header. |
| CI | `CONTRIBUTING.md` | "Green CI first. Lint, build, tests, and migration checks must pass before a human reviews." `ci.yml` also runs `turbo run typecheck build test`; `validate-publishable-packages.yml` runs on any change under `packages/pieces/`. |
| Size | `CONTRIBUTING.md`, `tools/scripts/pr-size-check.ts` | "Aim for under ~400 changed lines", but `packages/pieces` is exempt from the budget. |
| Review | `CONTRIBUTING.md`, `.github/CODEOWNERS` | An AI reviewer (Greptile) posts a first pass; address it before asking a human. `@activepieces/pieces` owns `/packages/pieces/`. |
| CLA | searched `CONTRIBUTING.md`, `.github/`, `docs/build-pieces/` | No CLA or DCO requirement found. |

Upstream's code conventions that apply to this piece (`AGENTS.md`, "Coding Conventions"; the piece follows them):
no comments, no `any`, no type casts, a single destructured object parameter for functions with more than one
parameter, plain util functions grouped into one exported const, dependency versions pinned exactly, and no import
of `@activepieces/shared` or `@activepieces/core-*` from piece code (enforced by the piece's `.eslintrc.json`).

### Steps, in a fork

```bash
# 1. fork activepieces/activepieces on GitHub, then clone your fork
git clone --depth=1 https://github.com/<your-account>/activepieces.git
cd activepieces
git checkout -b feat/add-jobo-piece

# 2. copy the piece in (adjust the path to this repository)
cp -R <this-repo>/Jobo.Connectors/activepieces/jobo packages/pieces/community/jobo

# 3. fill in authors in packages/pieces/community/jobo/src/index.ts (GitHub username of the contributor)

# 4. register the package path in tsconfig.base.json, alphabetically between the neighbouring entries:
#      "@activepieces/piece-jobo": ["packages/pieces/community/jobo/src/index.ts"],

# 5. install (updates bun.lock, which must be committed) and check
bun install
npx turbo run build lint test --filter=@activepieces/piece-jobo

# 6. try it in the builder
AP_DEV_PIECES=jobo npm start       # then open http://localhost:4200
```

Also needed from upstream's side, not from the code: the logo. `logoUrl` is
`https://cdn.activepieces.com/pieces/jobo.png`, the convention every piece uses; the docs do not say how the file
gets onto that CDN, so ask the maintainer. Translation files are generated nightly by
`.github/workflows/generate-translations.yml`, so none are included.

Commit with a conventional message, push, open the pull request with the template filled in, and apply the labels.

## Verification

Run on 2026-11-23 against upstream commit `1d55703` (2026-11-22), with Node 22.22.1, TypeScript 5.5.4, vitest
5.0.5, eslint 8.57.0 and @typescript-eslint 7.18.0, the versions upstream's `package.json` pins.

**Why not the published packages.** The versions upstream pins are not on npm. In the repo,
`@activepieces/pieces-framework` is 0.44.0 and `pieces-common` 0.15.2, both consumed as `workspace:*`, and they
depend on `@activepieces/core-utils` and `@activepieces/core-piece-types`, which `npm view` reports as 404. The latest
on npm is pieces-framework 0.32.0 and pieces-common 0.12.5 (both 2026-08-20), older than the repo's API. So the piece
was checked against upstream's own sources, which is also what its build uses.

**Harness.** `packages/core/{utils,piece-types}` and `packages/pieces/{framework,common}` were copied from the
upstream clone with `tsconfig.base.json`, `.eslintrc.json` and `.eslintrc.base.json`, next to a copy of `jobo/`
at `packages/pieces/community/jobo`. Third-party dependencies were installed with npm at upstream's pinned
versions (`--legacy-peer-deps`; `bun install` over the same workspace did not finish on this network), and
`node_modules/@activepieces/*` was symlinked the way a bun workspace links them.

| Check | Command | Result |
| --- | --- | --- |
| Type-check (strict, upstream flags `noPropertyAccessFromIndexSignature`, `noImplicitReturns`) | `tsc -p tsconfig.verify.json` (paths to upstream sources) | exit 0, 13 piece files |
| Type-check including tests | `tsc -p tsconfig.verify-tests.json` | exit 0 |
| Upstream libs, upstream command | `tsc -p tsconfig.lib.json` in `core/utils`, `core/piece-types`, `pieces/framework`, `pieces/common` | exit 0 each |
| Piece build, upstream command | `tsc -p tsconfig.lib.json && cp package.json dist/` in the piece | exit 0; `dist/src/index.js` loads and `jobo.metadata()` lists `search_jobs get_job find_company geocode_location custom_api_call` and trigger `new_job` |
| Metadata schema | `PieceMetadata.safeParse(JSON.parse(JSON.stringify(jobo.metadata())))` from the framework | valid |
| Lint, upstream config | `eslint 'src/**/*.ts' --max-warnings 0` in the piece | 13 files, 0 errors, 0 warnings (a probe file with an unused import and an `any` was flagged, so the rules are live) |
| Unit tests, piece's own config | `vitest run` in the piece | 7 files, 66 tests passed |
| Unit tests, harness config | `vitest run --config vitest.verify.config.ts` | 7 files, 66 tests passed |

The 66 tests mock `httpClient.sendRequest` (no network). Per file: auth validation (6), error mapping (8), Search
Jobs (7), Get Job / Find Company / Geocode (12), dropdowns (9), trigger (15), piece definition, output and filters
(9). They cover, for every action and the trigger: the request method, URL, `X-Api-Key` and `X-Jobo-Client`
headers and body; no request at all when input is refused; and 401, 402, 429 (plus 503, a sandbox refusal and a
network failure) turning into readable errors, with the 402 top-up link taken from the response body and no retry.
For the trigger: the narrowing guard in `onEnable`, `test` and `run`; the window starting at the moment the flow
was turned on; dedupe across polls; the watermark advancing; a late-indexed job delivered once; a pre-existing job
never delivered; cursor continuation; the 20-page cap; republish keeping state and a fresh enable resetting it.
Dropdown tests assert every lookup hits a free path. Three mutations of the trigger and guard code (drop the seen-id
check, drop the pre-enable check, drop the narrowing guard) each made tests fail, then the original passed again.

No request was made to the Jobo API, billed or free, and no API key was used: tests use a made-up key of the right
shape.

**Not run.**
- Upstream's own `turbo run build lint test --filter=@activepieces/piece-jobo` and `bun install` in the full
  monorepo: the workspace install did not finish on this network, so the equivalent `tsc`, `eslint` and `vitest`
  commands above were run by hand. `bun.lock` is therefore not updated; `bun install` in the fork will add
  `@jobo-ai/connector-core@0.5.0` to it.
- `bundle` (`packages/cli` `pieces bundle`): not run, so inlining `@jobo-ai/connector-core` into the single piece
  bundle is untested. Its package exposes a CommonJS `require` entry and has no runtime dependencies, which is what
  the bundler needs.
- Loading the piece in the Activepieces builder (`AP_DEV_PIECES=jobo npm start`), so none of the dropdown, search or
  trigger behaviour in the UI has been seen, and no flow has been run end to end.

## Not confirmed

Upstream conventions I could not confirm:
- Whether `refreshOnSearch` keeps already-picked values visible in a multi-select when the search text changes. The
  framework and docs support the option; the UI behaviour was not seen.
- How the logo reaches `cdn.activepieces.com/pieces/jobo.png`.
- The exact `minimumSupportedRelease`: `0.36.1` is what the scaffold writes, and the framework raises it to 0.82.0.
- Whether a new third-party runtime dependency (`@jobo-ai/connector-core`) passes review. The docs allow
  libraries ("Make sure you are using well-maintained libraries"). If not, the piece needs about 150 lines ported
  from connector-core (search body mapping, narrowing check, error classes).
- Whether `authors: []` is acceptable; the scaffold writes it empty and expects a GitHub username.

Jobo API details the references do not settle:
- `/api/connectors/*` (filters, filter-options, companies/suggest, locations/suggest) are not in `docs/openapi.yaml`
  or `docs/billing.mdx`. That they never deduct credits comes from connector-core's code comments and the Zapier
  connector's use of them. `billing.mdx` lists `GET /api/jobs/{id}`, `/api/jobs/expired` and `/api/occupations`
  as always free. If a documented endpoint is preferred for the connection check, `GET /api/jobs/expired` is.
- `X-Jobo-Client: activepieces` is sent, but the API counts a name as `other` until it is on the server's
  allowlist (`packages/connector-core/src/client.ts`). That needs a server-side entry.
- Whether a job indexed late can appear in the feed with a `created_at` older than the previous poll. The trigger
  assumes it can (a 60-second overlap with a seen-id set); connector-core's own poller uses the same 60 seconds.
- `posted_after` on the feed matches "employer posting time or first-indexed time" (`openapi.yaml`). The trigger
  treats a job as new by `created_at` (first-indexed), so a job whose employer posting time is new but which was
  indexed before the flow was turned on is not delivered.
- `GET /api/jobs/expired` documents `batch_size` where connector-core sends `limit`; the piece does not call it.
- Geocode's price and "charged even when not found" are from `billing.mdx` and `openapi.yaml`; connector-core's
  `geocode` call is the one the piece makes.
- AP polls every 5 minutes per its docs; the piece sets no schedule of its own.
- Get Job by ID throws on an unknown ID (so a flow can use "continue on failure"); Find Company and Geocode return an
  empty list instead. That split is a design choice, not something the references prescribe.
