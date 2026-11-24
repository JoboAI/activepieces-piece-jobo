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
        actions/                    search-jobs, get-job, find-company, geocode-location,
                                    list-hiring-signals, list-company-hiring-signals
        triggers/new-job.ts         New Job (polling)
        triggers/new-hiring-signal.ts  New Hiring Signal (polling)
        common/                     client, constants, filters, lookups, output, props,
                                    signals, signal-props, signal-page, signal-poll, signal-summary
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
| List Hiring Signals | `GET /api/signals` | Every signal returned, at ten times the price of a job, and again each time the same signal is read. Included signals first, then the wallet; no per-signal charge on Unlimited. An empty page is free (`docs/guides/hiring-signals.mdx`) |
| List Company Hiring Signals | `GET /api/companies/{id}/signals` | The same as List Hiring Signals |
| Custom API Call | any path under `https://connect.jobo.world` | Whatever the endpoint costs |
| New Job trigger | `POST /api/jobs/feed` | A job is billed once per 30 days; a job already received is re-delivered free (`billing.mdx`, "Unique jobs on Feed") |
| New Hiring Signal trigger | `GET /api/signals?sort=created_asc` | Every signal delivered, at ten times the price of a job. Each check asks only for signals stored after the last one delivered, so a signal is billed once in normal operation; a check that finds nothing is free. Turning the flow on and loading sample data make no request |
| Dropdowns (sources, industries, skills, companies, places, occupations) | `GET /api/connectors/*`, `GET /api/occupations` | Free (see "Not confirmed" below) |

No property text states a price: the descriptions say what is billed and link to `https://jobo.world/pricing`,
because a saved flow keeps the text it was built with.

### Search Jobs

Filters: query, location, companies (and exclude), sources, skills (and exclude), work model, employment type,
experience level, language, industries (and exclude), job categories / subcategories / occupations (and
excludes), company categories (and exclude), salary range, posted after / before, discovered after / before (the
time Jobo first indexed the job), search descriptions, sort, description format, Maximum Jobs (default 10, max 100)
and Page. It refuses to run with no filter, because an empty search returns and bills the first page of the whole
index. It returns an array of flat job records (`id`, `title`, `company_name`, `city`, `salary_min`, ... , one level
deep, so each key is a table column).

A company value is never split at a comma, so a mapped name such as `Acme, Inc.` is sent whole (the n8n node does the
same). Several values come as a mapped list, or one per line in a single text value. A company picked from the list
carries all of its board ids, joined by line breaks.

### List Hiring Signals and List Company Hiring Signals

A hiring signal is one event at one company, detected from its job postings: a hiring surge, a first job in a
country, a leadership search, a new technology, a slowdown. The six actions of the piece are Search Jobs, Get Job by
ID, Find Company, Geocode Location and these two (plus the Custom API Call).

- **Filters.** List Hiring Signals has every filter of the shared signals contract (`contracts/signals.json` in the
  Jobo monorepo): signal types, company domains, IDs, countries, sizes, industries, categories and funding stages,
  founded year, exclude staffing agencies and exclude domains, the focus filters (functions, roles, seniority,
  technologies, skills, technology categories, job countries, regions and cities), minimum strength, minimum new
  jobs, minimum days open, reposted only, detected on or after / before and created after. List Company Hiring
  Signals takes a company ID and only what that endpoint takes: types, minimum strength, the two detection days and
  created after. Signal types, company sizes and seniority are multi-selects; the other lists take one value per
  line or a mapped list, as Companies does in Search Jobs. A value that contains a comma is refused, because the
  API separates values with commas; so is a list of more than 100 values, a number out of range, a date that is not
  a date and a company ID that is not a GUID. All of it is checked before any request.
- **Cost.** Every signal returned is billed at ten times the price of a job, and billed again each time it is read.
  Maximum Signals defaults to 10 and is capped at 100 (the API takes 200). A run sends exactly one request and never
  reads a second page: it returns `has_more` and `next_cursor`, and the Cursor property takes `next_cursor` back to
  read the next page in a later step. To read only what is new, map the newest `created_at` you stored into Created
  After, which is exclusive; it is sent exactly as given, so a mapped `created_at` keeps its full precision.
- **Output.** `{ signals, has_more, next_cursor }`. Each signal is one flat record: the signal's own fields,
  `type_label`, `summary` (one sentence such as "17 new jobs this week vs 3.1 a week normally", the wording Jobo's
  dashboard uses), the company flattened as `company_id`, `company_name`, `company_domain`, `company_country_code`,
  `company_size`, `company_industry`, `company_industries`, `company_categories`, `company_is_agency`,
  `company_funding_stage`, `company_founded_year`, the focus as `focus_functions`, `focus_title`, `focus_occupation`,
  `focus_seniority`, `focus_topics`, `focus_topic_category`, `focus_job_countries`, `focus_job_regions`,
  `focus_job_cities` (lists joined with ", "), `evidence_job_ids` as a list (Get Job by ID reads each one free) and
  `details` as the object the API sent, which differs by type. A signal type added after this piece was written is
  passed through with its type in words as the label.
- **Transport.** `@jobo-ai/connector-core@0.5.0` from npm has no signals methods, and the piece keeps that version.
  The two GET requests go through the piece's own transport (`httpClient`, the same headers and timeout as every
  other call), with a local copy of the signals filter list, type labels and summary wording. `test/hiring-signals.test.ts`
  checks the local lists against the contract's values, written into the test so it runs without the contracts folder.
- **Errors.** Never retried: a 402 names the signal price and the top-up link; a 403 `account_key_required` asks for an
  account API key; a sandbox key is told signals need a live key; a 429 carries the wait. A 5xx, a timeout or a lost
  connection is reported as not retried, because the API settles the charge before it answers and a second read
  would pay again. Leave the step's retry-on-failure setting off for the same reason.
- **Trigger.** To be told about new signals, use the New Hiring Signal trigger below rather than List Hiring Signals
  on a schedule.

### New Hiring Signal trigger

It reads `GET /api/signals` in the order signals were stored, so it **needs the API's `sort=created_asc`**. An API
without it answers `400` naming `sort`, and the trigger reports that error.

- **Position.** The trigger keeps one value under one key (`joboSignalPoll`) in the trigger store, scoped to the flow:
  the `created_at` of the last signal it delivered, as the string the API sent. Each check sends it back as
  `created_after` (exclusive) with `sort=created_asc`, so the API returns the next signals stored after it and
  nothing it already delivered. The string is never parsed: `created_at` has microseconds and the signals of one
  write batch are a microsecond apart, so a value rounded to the millisecond would bill signals again or skip them.
  The poller is in `common/signal-poll.ts`, written in the piece because connector-core 0.5.0 on npm has none.
- **First run.** Turning the flow on records the current time as that value and makes no request. Only signals
  stored after that moment are delivered; nothing older is read or billed. A republish of a running flow keeps the
  position; turning the flow off and on again, or changing its filters, starts again from that moment.
- **Maximum Signals per Poll.** Default 10, 1 to 100, the same range as Maximum Signals on the action. It caps what
  one check reads and so what one check bills. When more signals are waiting, the trigger keeps the API's
  `next_cursor` with the `created_after` it was issued under, and the next check continues from that cursor with the
  same `created_after`. A backlog arrives over several checks, oldest first, none skipped and none twice. If the API
  refuses a held cursor (`400` naming `cursor`), the check drops it and reads once from the last `created_at`
  delivered instead, which is the same position for every signal stored since `sort=created_asc` was released.
- **When the position is saved.** After every page of the check has been read, just before the signals are handed
  back to Activepieces, which starts one flow run per item `run` returns. A check that finds nothing saves nothing
  and is free. If a check fails part-way (a 402 on the second page, a lost connection), it saves nothing and the
  next check reads the same signals again; any page read before the failure is billed again. That is the price of
  never losing a signal. Not verified in the Activepieces docs: what happens to the saved position if the engine
  fails to start the flow runs for the items a successful `run` returned; such signals would not be delivered again.
- **Guard.** At least one of Signal Types, Company Domains, Company IDs, Company Countries, Company Sizes,
  Industries, Company Categories, Funding Stages, Functions, Roles, Seniority, Technologies, Skills, Technology
  Categories, Job Countries, Job Regions or Job Cities (the contract's narrowing filters) is required, checked
  before any request when the flow is turned on, when sample data is loaded and on every check. Minimum strength,
  the other minimums and the dates alone do not count.
- **Filters.** The filters of List Hiring Signals, minus Created After and Cursor, which the trigger owns.
- **Sample data.** A fixed, fictional signal; loading it makes no request and is not billed. Activepieces runs `test`
  each time sample data is loaded, and a real read would bill a signal each time. The sample goes through the same
  flattening as real signals, so a flow mapped on it maps the same fields. The filters are still checked.
- **Output.** One flat signal record per signal, the same shape as an item of `signals` from List Hiring Signals.
- **Errors.** Not retried, with the actions' messages: 402, 403 `account_key_required`, the sandbox 404, 429, 5xx
  and lost connections. A failed check leaves the stored position untouched.

### New Job trigger

It reads the job feed, not search. Search bills every job a response returns, so any re-read of a window is
paid for again; the feed bills a job once per 30 days and re-delivers it free, so the small overlap this
trigger reads on purpose costs nothing.

- **Guard.** At least one of Locations, Sources, Companies, Industries, Job Categories, Job Subcategories or
  Occupations is required. It is enforced when the flow is turned on (`onEnable` fails the publish), when sample
  data is loaded and on every poll. It uses `assertHasNarrowingFilter` from connector-core.
- **Scans, not a watermark.** The trigger keeps its own state in the trigger store instead of `pollingHelper`'s
  time watermark. A watermark only moves when a poll returns a new job, so a window that starts with more
  already-delivered or re-posted jobs than one poll can read (one employer's 800 jobs indexed in the same second, or
  jobs the employer re-posted, which keep their old first-indexed time and sort first) would be read again on every
  poll and the trigger would stop delivering for good. Instead a scan starts with `posted_after` set to the scan's
  start of window, records when it started, and each poll continues the stored feed cursor where the last one stopped.
  A cursor keeps the scan's filters and batch size, and the feed lets a scan be continued later. The window of the
  first scan starts when the flow is turned on, so existing jobs are never delivered.
- **Which jobs are delivered.** A job is delivered when it is not in the trigger's list of delivered ids and was first
  indexed (`created_at`) at or after both the scan's start of window and the moment the flow was turned on. The feed's
  `posted_after` also matches a job whose employer posting time is new; such a re-posted job was first indexed earlier,
  so it is read (and billed, unless your account received it in the last 30 days) but not delivered. The feed has no
  filter on first-indexed time alone that would leave it out.
- **Overlap.** When a scan has read everything (`has_more` false), the next scan's window starts 15 minutes before the
  finished scan started (`TRIGGER_SCAN_OVERLAP_FOR_MIRROR_DELAY_MS`). Production serves the feed from a mirror that can
  make a job readable some minutes after its `created_at`; the overlap reads those jobs again, and the delivered-id
  list keeps each one to a single delivery. Re-reading a job you already received is free for 30 days.
- **Delivered ids.** The list keeps the id and first-indexed time of each delivered job that a later scan can still
  read, and drops the rest; it holds at most 5,000 ids. More than 5,000 matching jobs first indexed inside one window
  could deliver the oldest of them twice.
- **Restarts and failures.** A 409 `feed_cursor_restart_required`, or a 400 for a held cursor, drops the cursor and
  starts the same scan again from its start of window; the delivered-id list stops repeats. A 400 on the first page
  of a scan is an error. If a page fails, the poll fails and stores nothing, so the next poll reads the same pages
  again (free for 30 days). Changing the filters on a republish starts the scan again with the new filters from the
  same start of window; a republish with the same filters keeps the scan running.
- **Caps.** 25 jobs per feed request and at most 20 requests per poll (500 jobs). A bigger backlog is drained over the
  next polls by continuing the cursor. 25 keeps the wallet check at a quarter of the 100-job page; the check prices a
  full page even when the page is empty (`billing.mdx`, "Request flow").
- **Sample data.** One request for up to 5 jobs from the last 7 days, in feed order: the feed reads oldest first by
  first-indexed time and cannot sort newest first, so these are the oldest matching jobs of that week, not the
  newest. A job the employer re-posted that week can be among them. Nothing is stored.
- **Output.** One flat job record per job, the same shape as Search Jobs.

### Errors and retries

Each request is tried at most twice. A retry happens only for an HTTP 408 or 5xx response or a network failure,
after 5 seconds, which is the `Retry-After: 5` the feed sends with its 503. A 401, 402, 409 or 429 is not retried:
the 429 message carries the wait the API asked for, and a 402 links to the top-up page. connector-core 0.5.0 reads a
`Retry-After` header only on a 429; for a 503 it asks for a random delay under 1 second, so the piece waits at least
5 seconds itself. A request that times out (120 seconds) is also retried once, so one step can take about 4 minutes
before it fails. The two hiring signals actions and the New Hiring Signal trigger are the exception: each request is
tried once and never retried, because a signal is billed when the response is sent.

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

## Changelog

The version is `version` in `jobo/package.json`. Nothing has been published.

- **0.1.0** (not published): the New Hiring Signal polling trigger, reading `GET /api/signals` with
  `sort=created_asc` and `created_after`, with a local poller in `common/signal-poll.ts`.
- **0.0.1** (not published): Search Jobs, Get Job by ID, Find Company, Geocode Location, List Hiring Signals, List
  Company Hiring Signals, Custom API Call and the New Job trigger.

## Verification

### After the New Hiring Signal trigger (2026-11-24)

Same scratch harness as below. `test/new-hiring-signal.test.ts` (32 tests) mocks the HTTP client with a small
server that pages in `created_asc` order on `(created_at, id)`.

- Tests: `vitest run`, 9 files, 170 of 172 tests passed. The two failures are the same two as before (`classification`,
  which the npm framework drops); `test/new-hiring-signal.test.ts` passed in full.
- Covered: turning on and a first run make no request and record now; `sort=created_asc` and the exact `created_at`
  (`2026-11-24T13:53:55.837281Z`, and a 4-digit fraction) are sent back unchanged; more than the maximum leaves a
  cursor and the next checks continue with it and the same `created_after` until the end; an old batch of 30 signals
  sharing one `created_at` arrives once across 4 checks; an empty check changes nothing; a refused cursor falls back to
  the watermark once; a failure on the second page saves nothing and the next check repeats the read; 402, 403, the
  sandbox 404, 429, 500 and a lost connection, none retried; no narrowing filter is refused in `onEnable`, `run` and
  `test` before any request; the sample is free and has the keys of a real signal.
- Mutations: keeping `created_after` at the watermark while a cursor is held failed 3 tests; removing the refused-cursor
  fallback failed 3 tests.
- Type-check: `tsc --noEmit` reports only fields the npm framework does not have (`classification`, `isRepublish`,
  `advanced`, `display`) and the test helper's `HttpError` constructor.
- Not run: lint, the build, the bundle and the builder, and no request to the real API (the API's `sort=created_asc`
  is not deployed yet).

### After the hiring signals actions (2026-11-24)

Checked the same way as the review fixes below, in the same scratch harness outside this repository (npm
`@activepieces/pieces-framework` 0.32.0, `pieces-common` 0.12.5, `@jobo-ai/connector-core` 0.5.0, vitest 5.0.5, and the
two shims):

- Tests: `vitest run`, 8 files, 138 of 140 tests passed. The two failures are the same two as before (`classification`
  and `aiMetadata`, which the npm framework drops); `test/hiring-signals.test.ts` passed in full.
- Type-check: `tsc --noEmit` reports only the kinds of error it reported before: fields the npm framework does not
  have (`classification`, `advanced`, `display`). None is in the request, filter, output or summary code.
- Not run: lint, the build, the bundle and the builder. Run them before a pull request.

### After the review fixes (2026-11-23)

The New Job trigger's scan, the company value rule, the discovered dates, the retry and the minimum release were
changed after the run described further down. They were checked without an upstream checkout:

- Tests: `vitest run` (vitest 5.0.5) over the piece's own tests, with `@activepieces/pieces-framework` 0.32.0 and
  `pieces-common` 0.12.5 from npm in a scratch folder outside this repository, plus two small shims there: the
  framework's `createMockActionContext` and `PieceCategory`, and `HttpError` with the constructor upstream's test
  helper uses. 79 of 81 tests passed. The two failures assert `classification` and `aiMetadata` on the action and
  trigger definitions, fields the npm 0.32.0 framework drops; the upstream sources keep them.
- Mutations of the trigger (no held cursor, no scan-window check, no cursor restart, no delivered-id check) each
  made trigger tests fail.
- Type-check: `tsc --noEmit` against the same npm packages. Every error it reports is a field the npm framework does
  not have yet (`classification`, `advanced`, `display`, `isRepublish`, the `HttpError` constructor); none is in the
  changed logic, and the calls into `@jobo-ai/connector-core` 0.5.0 type-check.
- Not run: the upstream-source harness below, lint, the build and the bundle. Run them again before a pull request.

### First run

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
- Whether a new third-party runtime dependency (`@jobo-ai/connector-core`) passes review. The docs allow
  libraries ("Make sure you are using well-maintained libraries"). If not, the piece needs about 150 lines ported
  from connector-core (search body mapping, narrowing check, error classes).
- Whether `authors: []` is acceptable; the scaffold writes it empty and expects a GitHub username. It stays empty
  until a contributor's GitHub username is known (step 3 above).

`minimumSupportedRelease` is `0.82.0`: the framework raises any lower value to its
`MINIMUM_SUPPORTED_RELEASE_AFTER_LATEST_CONTEXT_VERSION`, which is `0.82.0` (seen in the first run against
upstream's sources, and read again in the npm 0.32.0 package), so the code now says what the published metadata
will say.

Jobo API details the references do not settle:
- `/api/connectors/*` (filters, filter-options, companies/suggest, locations/suggest) are not in `docs/openapi.yaml`
  or `docs/billing.mdx`. That they never deduct credits comes from connector-core's code comments and the Zapier
  connector's use of them. `billing.mdx` lists `GET /api/jobs/{id}`, `/api/jobs/expired` and `/api/occupations`
  as always free. If a documented endpoint is preferred for the connection check, `GET /api/jobs/expired` is.
- `X-Jobo-Client: activepieces` is sent, but the server's allowlist (`KnownClients` in
  `Jobo.Enterprise/Web/Jobo.Enterprise.External.Api/Middleware/ExternalApiUsageMetricsMiddleware.cs`) does not list
  `activepieces`, so this piece's requests are counted as `other`. That needs a server-side entry.
- How late the production feed mirror can serve a job after its `created_at`. The trigger re-reads 15 minutes before
  each finished scan started; a job the mirror serves later than that, behind a scan that has already passed it, is
  missed.
- `posted_after` on the feed matches "employer posting time or first-indexed time" (`openapi.yaml`). The trigger
  treats a job as new by `created_at` (first-indexed), so a job whose employer posting time is new but which was
  indexed before the flow was turned on is not delivered.
- `GET /api/jobs/expired` documents `batch_size` where connector-core sends `limit`; the piece does not call it.
- Geocode's price and "charged even when not found" are from `billing.mdx` and `openapi.yaml`; connector-core's
  `geocode` call is the one the piece makes.
- AP polls every 5 minutes per its docs; the piece sets no schedule of its own.
- New Hiring Signal relies on these Activepieces docs: "By default, the storage operates at the flow level" and "The
  storage is persistent, meaning that the stored values are retained even after the execution of the piece"
  (`build-pieces/piece-reference/persistent-storage`); "each item in the array will trigger the flow to run" and the
  republish table (`build-pieces/piece-reference/triggers/overview`). The docs do not say what the engine does when
  `run` returns but the flow runs cannot be started, whether a failed `run` is retried, or whether a store write is
  committed before the items are queued.
- The trigger code has three short comments (the poller, the save point, the sample choice). Upstream's `AGENTS.md`
  asks for no comments; remove them before an upstream pull request if a reviewer asks.
- Get Job by ID throws on an unknown ID (so a flow can use "continue on failure"); Find Company and Geocode return an
  empty list instead. That split is a design choice, not something the references prescribe.
