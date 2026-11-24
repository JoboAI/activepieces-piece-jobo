import {
  createTrigger,
  isNil,
  Property,
  TriggerStrategy,
  type Store,
} from '@activepieces/pieces-framework'
import {
  FeedCursorRestartRequiredError,
  JoboApiError,
  type Job,
  type JobFeedParams,
  type JoboClient,
} from '@jobo-ai/connector-core'
import { joboAuth } from '../auth'
import { joboClient } from '../common/client'
import { joboConstants } from '../common/constants'
import { joboFilters } from '../common/filters'
import { joboOutput } from '../common/output'
import { joboProps } from '../common/props'

const NARROWING_TEXT = 'Locations, Sources, Companies, Industries, Job Categories, Job Subcategories or Occupations'
const DAY_MS = 86_400_000

const props = {
  cost_notice: Property.MarkDown({
    value: `**How this trigger is billed.** It reads the Jobo job feed. Each new matching job is billed once, however often the flow checks for jobs: a job you already received is delivered again at no charge for 30 days. Jobs come out of your plan's included jobs first, then your wallet, see the [pricing page](${joboConstants.PRICING_URL}). Loading sample data reads up to ${joboConstants.TRIGGER_SAMPLE_SIZE} jobs and bills them the same way. Your balance must cover a full batch of ${joboConstants.TRIGGER_BATCH_SIZE} jobs before each check.

**Set at least one of ${NARROWING_TEXT}.** Without one the trigger would match every job Jobo indexes. It needs a live API key.`,
  }),
  location: joboProps.triggerLocation,
  companies: joboProps.companies,
  sources: joboProps.sources,
  industries: joboProps.industries,
  job_categories: joboProps.jobCategories,
  job_subcategories: joboProps.jobSubcategories,
  occupation_ids: joboProps.occupationIds,
  work_model: joboProps.workModel,
  employment_type: joboProps.employmentType,
  experience_level: joboProps.experienceLevel,
  language: joboProps.language,
  exclude_companies: joboProps.excludeCompanies,
  exclude_industries: joboProps.excludeIndustries,
  exclude_job_categories: joboProps.excludeJobCategories,
  exclude_job_subcategories: joboProps.excludeJobSubcategories,
  exclude_occupation_ids: joboProps.excludeOccupationIds,
  company_categories: joboProps.companyCategories,
  exclude_company_categories: joboProps.excludeCompanyCategories,
  description_format: joboProps.descriptionFormat,
}

export const newJob = createTrigger({
  auth: joboAuth,
  name: 'new_job',
  classification: 'READ',
  displayName: 'New Job',
  description: 'Triggers when a new job matching your filters is posted on an employer career site.',
  aiMetadata: {
    description:
      'Fires once for each job that Jobo first indexes after the flow is turned on and that matches the chosen filters. One payload is one flat job record.',
  },
  type: TriggerStrategy.POLLING,
  props,
  sampleData: joboOutput.JOB_SAMPLE,
  async onEnable(context) {
    joboFilters.requireNarrowingFilter({ values: context.propsValue, labels: NARROWING_TEXT })
    const alreadyStarted = !isNil(await context.store.get<number>(joboConstants.TRIGGER_ENABLED_AT_KEY))
    if (context.isRepublish && alreadyStarted) return
    await context.store.put(joboConstants.TRIGGER_ENABLED_AT_KEY, Date.now())
    await context.store.put<SeenJob[]>(joboConstants.TRIGGER_SEEN_KEY, [])
    await context.store.delete(joboConstants.TRIGGER_SCAN_KEY)
  },
  async onDisable() {
    return
  },
  async run(context) {
    joboFilters.requireNarrowingFilter({ values: context.propsValue, labels: NARROWING_TEXT })
    const feedBody = joboFilters.toFeedBody(context.propsValue)
    return joboClient.withJobo({
      apiKey: context.auth.secret_text,
      run: (client) => readNewJobs({ client, feedBody, store: context.store }),
    })
  },
  async test(context) {
    joboFilters.requireNarrowingFilter({ values: context.propsValue, labels: NARROWING_TEXT })
    const feedBody = joboFilters.toFeedBody(context.propsValue)
    return joboClient.withJobo({
      apiKey: context.auth.secret_text,
      run: (client) => readSample({ client, feedBody }),
    })
  },
})

async function readSample({ client, feedBody }: { client: JoboClient, feedBody: JobFeedParams }): Promise<unknown[]> {
  const since = Date.now() - joboConstants.TRIGGER_SAMPLE_LOOKBACK_DAYS * DAY_MS
  const { data } = await client.feed({
    ...feedBody,
    posted_after: new Date(since).toISOString(),
    batch_size: joboConstants.TRIGGER_SAMPLE_SIZE,
  })
  return (data.jobs ?? []).map(joboOutput.flattenJob)
}

async function readNewJobs({ client, feedBody, store }: { client: JoboClient, feedBody: JobFeedParams, store: Store }): Promise<unknown[]> {
  const enabledAt = await readEnabledAt({ store })
  const seenJobs = (await store.get<SeenJob[]>(joboConstants.TRIGGER_SEEN_KEY)) ?? []
  const filters = JSON.stringify(feedBody)
  const storedScan = await store.get<FeedScan>(joboConstants.TRIGGER_SCAN_KEY)
  let scan = storedScan ?? newScan({ since: enabledAt, filters })
  if (scan.filters !== filters) scan = newScan({ since: scan.since, filters })

  const seen = new Set(seenJobs.map((entry) => entry.id))
  const recorded = [...seenJobs]
  const fresh: Job[] = []

  for (let page = 1; page <= joboConstants.TRIGGER_MAX_PAGES; page++) {
    const cursor = scan.cursor
    const startedAt = cursor === null ? Date.now() : scan.startedAt ?? Date.now()
    const body: JobFeedParams =
      cursor === null
        ? { ...feedBody, posted_after: new Date(scan.since).toISOString(), batch_size: joboConstants.TRIGGER_BATCH_SIZE }
        : { cursor }

    const response = await readPage({ client, body, restartable: cursor !== null })
    if (response === null) {
      scan = newScan({ since: scan.since, filters })
      continue
    }

    for (const job of response.jobs ?? []) {
      const createdAt = createdAtOf(job)
      if (seen.has(job.id)) continue
      if (createdAt !== null && (createdAt < scan.since || createdAt < enabledAt)) continue
      seen.add(job.id)
      fresh.push(job)
      recorded.push({ id: job.id, createdAt: createdAt ?? startedAt })
    }

    if (response.has_more && response.next_cursor) {
      scan = { ...scan, startedAt, cursor: response.next_cursor }
      continue
    }
    const nextSince = Math.max(startedAt - joboConstants.TRIGGER_SCAN_OVERLAP_FOR_MIRROR_DELAY_MS, enabledAt)
    scan = newScan({ since: nextSince, filters })
    break
  }

  const stillNeeded = recorded.filter((entry) => entry.createdAt >= scan.since).slice(-joboConstants.TRIGGER_SEEN_LIMIT)
  await store.put<FeedScan>(joboConstants.TRIGGER_SCAN_KEY, scan)
  await store.put<SeenJob[]>(joboConstants.TRIGGER_SEEN_KEY, stillNeeded)

  return fresh.map(joboOutput.flattenJob)
}

async function readPage({ client, body, restartable }: { client: JoboClient, body: JobFeedParams, restartable: boolean }) {
  try {
    const { data } = await client.feed(body)
    return data
  }
  catch (error) {
    if (restartable && mustRestartScan(error)) return null
    throw error
  }
}

function mustRestartScan(error: unknown): boolean {
  if (error instanceof FeedCursorRestartRequiredError) return true
  return error instanceof JoboApiError && error.status === 400
}

async function readEnabledAt({ store }: { store: Store }): Promise<number> {
  const stored = await store.get<number>(joboConstants.TRIGGER_ENABLED_AT_KEY)
  if (!isNil(stored)) return stored
  const now = Date.now()
  await store.put(joboConstants.TRIGGER_ENABLED_AT_KEY, now)
  return now
}

function newScan({ since, filters }: { since: number, filters: string }): FeedScan {
  return { since, startedAt: null, cursor: null, filters }
}

function createdAtOf(job: Job): number | null {
  const parsed = Date.parse(job.created_at)
  return Number.isNaN(parsed) ? null : parsed
}

type FeedScan = {
  since: number
  startedAt: number | null
  cursor: string | null
  filters: string
}

type SeenJob = { id: string, createdAt: number }
