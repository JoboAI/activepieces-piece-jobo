import { DedupeStrategy, pollingHelper, type Polling } from '@activepieces/pieces-common'
import {
  createTrigger,
  isNil,
  Property,
  TriggerStrategy,
  type AppConnectionValueForAuthProperty,
  type Store,
  type StaticPropsValue,
} from '@activepieces/pieces-framework'
import type { Job, JobFeedParams, JoboClient } from '@jobo-ai/connector-core'
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

const polling: Polling<AppConnectionValueForAuthProperty<typeof joboAuth>, StaticPropsValue<typeof props>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, propsValue, lastFetchEpochMS }) => {
    joboFilters.requireNarrowingFilter({ values: propsValue, labels: NARROWING_TEXT })
    const feedBody = joboFilters.toFeedBody(propsValue)
    return joboClient.withJobo({
      apiKey: auth.secret_text,
      run: (client) =>
        lastFetchEpochMS === 0
          ? readSample({ client, feedBody })
          : readNewJobs({ client, feedBody, store, lastFetchEpochMS }),
    })
  },
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
    await pollingHelper.onEnable(polling, context)
    const alreadyStarted = !isNil(await context.store.get<number>(joboConstants.TRIGGER_ENABLED_AT_KEY))
    if (context.isRepublish && alreadyStarted) return
    await context.store.put(joboConstants.TRIGGER_ENABLED_AT_KEY, Date.now())
    await context.store.put<string[]>(joboConstants.TRIGGER_SEEN_KEY, [])
  },
  async onDisable(context) {
    await pollingHelper.onDisable(polling, context)
  },
  async run(context) {
    return pollingHelper.poll(polling, context)
  },
  async test(context) {
    return pollingHelper.test(polling, context)
  },
})

async function readSample({ client, feedBody }: { client: JoboClient, feedBody: JobFeedParams }): Promise<PollItem[]> {
  const since = Date.now() - joboConstants.TRIGGER_SAMPLE_LOOKBACK_DAYS * DAY_MS
  const { data } = await client.feed({
    ...feedBody,
    posted_after: new Date(since).toISOString(),
    batch_size: joboConstants.TRIGGER_SAMPLE_SIZE,
  })
  return [...(data.jobs ?? [])].reverse().map((job) => ({
    epochMilliSeconds: createdAtOf(job) ?? 0,
    data: joboOutput.flattenJob(job),
  }))
}

async function readNewJobs({ client, feedBody, store, lastFetchEpochMS }: ReadNewJobsParams): Promise<PollItem[]> {
  const enabledAt = await store.get<number>(joboConstants.TRIGGER_ENABLED_AT_KEY)
  const seenIds = (await store.get<string[]>(joboConstants.TRIGGER_SEEN_KEY)) ?? []
  const since = Math.max(lastFetchEpochMS - joboConstants.TRIGGER_LAP_MS, enabledAt ?? lastFetchEpochMS)

  const jobs = await readFeed({
    client,
    body: { ...feedBody, posted_after: new Date(since).toISOString(), batch_size: joboConstants.TRIGGER_BATCH_SIZE },
  })

  const seen = new Set(seenIds)
  const fresh = jobs.filter((job) => {
    const createdAt = createdAtOf(job)
    const isNew = !seen.has(job.id) && (createdAt === null || createdAt >= since)
    seen.add(job.id)
    return isNew
  })

  await store.put<string[]>(joboConstants.TRIGGER_SEEN_KEY, [...seenIds, ...fresh.map((job) => job.id)].slice(-joboConstants.TRIGGER_SEEN_LIMIT))

  return fresh.map((job) => ({
    epochMilliSeconds: Math.max(createdAtOf(job) ?? 0, lastFetchEpochMS + 1),
    data: joboOutput.flattenJob(job),
  }))
}

async function readFeed({ client, body }: { client: JoboClient, body: JobFeedParams }): Promise<Job[]> {
  const jobs: Job[] = []
  let cursor: string | null = null
  for (let page = 1; page <= joboConstants.TRIGGER_MAX_PAGES; page++) {
    const { data } = await client.feed(cursor === null ? body : { cursor })
    jobs.push(...(data.jobs ?? []))
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return jobs
}

function createdAtOf(job: Job): number | null {
  const parsed = Date.parse(job.created_at)
  return Number.isNaN(parsed) ? null : parsed
}

type PollItem = { epochMilliSeconds: number, data: unknown }

type ReadNewJobsParams = {
  client: JoboClient
  feedBody: JobFeedParams
  store: Store
  lastFetchEpochMS: number
}
