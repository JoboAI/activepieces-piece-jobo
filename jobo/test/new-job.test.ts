import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { newJob } from '../src/lib/triggers/new-job'
import { triggerContext } from './helpers/contexts'
import { job, memoryStore, mockApi } from './helpers/mock-api'

const T0 = Date.parse('2026-11-23T12:00:00Z')
const minutes = (count: number) => new Date(T0 + count * 60_000).toISOString()
const filters = { location: [{ country: 'Germany', city: 'Berlin' }], companies: ['c1,c2'] }

type FeedBody = Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function enabled(propsValue: Record<string, unknown> = filters) {
  const store = memoryStore()
  await newJob.onEnable(triggerContext({ propsValue, store }) as never)
  return store
}

function poll(propsValue: Record<string, unknown>, store: ReturnType<typeof memoryStore>) {
  return newJob.run(triggerContext({ propsValue, store }) as never)
}

describe('New Job trigger: guard', () => {
  test('refuses to turn on without a narrowing filter', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(newJob.onEnable(triggerContext({ propsValue: { work_model: ['remote'] } }) as never)).rejects.toThrow(
      /Set at least one of Locations, Sources, Companies/,
    )
    expect(requests).toHaveLength(0)
  })

  test('run and test refuse as well, with no request', async () => {
    const { requests } = mockApi(() => ({}))
    const store = memoryStore({ lastPoll: T0 })
    await expect(poll({ language: ['en'] }, store)).rejects.toThrow(/at least one of/)
    await expect(newJob.test(triggerContext({ propsValue: {} }) as never)).rejects.toThrow(/at least one of/)
    expect(requests).toHaveLength(0)
  })

  test('turning on reads no jobs and starts the watermark now', async () => {
    const { requests } = mockApi(() => ({}))
    const store = await enabled()
    expect(requests).toHaveLength(0)
    expect(store.data.get('lastPoll')).toBe(T0)
    expect(store.data.get('joboEnabledAt')).toBe(T0)
    expect(store.data.get('joboSeenJobIds')).toEqual([])
  })

  test('a republish keeps the stored state', async () => {
    const store = await enabled()
    vi.setSystemTime(T0 + 3_600_000)
    await newJob.onEnable(triggerContext({ propsValue: filters, store, isRepublish: true }) as never)
    expect(store.data.get('lastPoll')).toBe(T0)
    expect(store.data.get('joboEnabledAt')).toBe(T0)
  })

  test('turning off and on again starts fresh', async () => {
    const store = await enabled()
    await store.put('joboSeenJobIds', ['old'])
    vi.setSystemTime(T0 + 3_600_000)
    await newJob.onEnable(triggerContext({ propsValue: filters, store }) as never)
    expect(store.data.get('joboEnabledAt')).toBe(T0 + 3_600_000)
    expect(store.data.get('joboSeenJobIds')).toEqual([])
  })
})

describe('New Job trigger: sample data', () => {
  test('reads at most 5 jobs from the last 7 days in one request, newest first, and stores nothing', async () => {
    const jobs = [1, 2, 3].map((n) => job({ id: `j${n}`, created_at: minutes(-n * 1000) }))
    const { requests } = mockApi(() => ({ body: { jobs: [...jobs].reverse(), has_more: false, next_cursor: null } }))
    const store = memoryStore()
    const result = await newJob.test(triggerContext({ propsValue: filters, store }) as never)
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('https://connect.jobo.world/api/jobs/feed')
    const body = requests[0].body as FeedBody
    expect(body['batch_size']).toBe(5)
    expect(body['posted_after']).toBe(new Date(T0 - 7 * 86_400_000).toISOString())
    expect(result.map((item) => (item as { id: string }).id)).toEqual(['j1', 'j2', 'j3'])
    expect(store.data.size).toBe(0)
  })
})

describe('New Job trigger: polling', () => {
  test('maps every filter onto the feed body and starts the window at the moment it was turned on', async () => {
    const { requests } = mockApi(() => ({ body: { jobs: [], has_more: false, next_cursor: null } }))
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * 60_000)
    const props = {
      location: [{ country: 'Germany', city: 'Berlin' }, '{"country":"France"}'],
      companies: ['c1,c2'],
      exclude_companies: ['c9'],
      sources: ['greenhouse'],
      work_model: ['remote'],
      employment_type: ['full-time'],
      experience_level: ['senior'],
      language: ['en'],
      industries: ['Software Development'],
      job_categories: ['Technology'],
      exclude_job_subcategories: ['Sales'],
      occupation_ids: ['jobo:backend-developer'],
      company_categories: ['saas'],
      description_format: 'html',
    }
    await poll(props, store)
    expect(requests).toHaveLength(1)
    expect(requests[0].body).toEqual({
      locations: [{ country: 'Germany', city: 'Berlin' }, { country: 'France' }],
      sources: ['greenhouse'],
      work_models: ['remote'],
      employment_types: ['full-time'],
      experience_levels: ['senior'],
      languages: ['en'],
      companies: { include: ['c1', 'c2'], exclude: ['c9'] },
      industries: { include: ['Software Development'] },
      company_categories: { include: ['saas'] },
      job_categories: { include: ['Technology'] },
      job_subcategories: { exclude: ['Sales'] },
      occupation_ids: { include: ['jobo:backend-developer'] },
      description_format: 'html',
      posted_after: minutes(0),
      batch_size: 25,
    })
  })

  test('a place without a country is rejected before any request', async () => {
    const { requests } = mockApi(() => ({}))
    const store = memoryStore({ lastPoll: T0, joboEnabledAt: T0 })
    await expect(poll({ location: [{ city: 'Berlin' }] }, store)).rejects.toThrow(/country is required/)
    expect(requests).toHaveLength(0)
  })

  test('emits new jobs once, dedupes repeats, advances the watermark and catches a late-indexed job', async () => {
    const j0 = job({ id: 'j0', created_at: minutes(-2), date_posted: minutes(1) })
    const j1 = job({ id: 'j1', created_at: minutes(1) })
    const j2 = job({ id: 'j2', created_at: minutes(3) })
    let feed = [j0, j1, j2]
    const { requests } = mockApi(() => ({ body: { jobs: feed, has_more: false, next_cursor: null } }))
    const store = await enabled()

    vi.setSystemTime(T0 + 5 * 60_000)
    const first = await poll(filters, store)
    expect(first.map((item) => (item as { id: string }).id)).toEqual(['j1', 'j2'])
    expect(store.data.get('lastPoll')).toBe(T0 + 3 * 60_000)

    const j3 = job({ id: 'j3', created_at: minutes(8) })
    const late = job({ id: 'late', created_at: minutes(2.5) })
    feed = [j1, late, j2, j3]
    vi.setSystemTime(T0 + 10 * 60_000)
    const second = await poll(filters, store)
    expect(second.map((item) => (item as { id: string }).id)).toEqual(['late', 'j3'])
    expect(store.data.get('lastPoll')).toBe(T0 + 8 * 60_000)
    const secondBody = requests[1].body as FeedBody
    expect(secondBody['posted_after']).toBe(minutes(2))

    feed = [j3]
    vi.setSystemTime(T0 + 15 * 60_000)
    expect(await poll(filters, store)).toEqual([])
    expect(requests.every((request) => request.path === '/api/jobs/feed')).toBe(true)
  })

  test('a job created before the trigger was turned on is never emitted, even when the feed returns it', async () => {
    mockApi(() => ({ body: { jobs: [job({ id: 'old', created_at: minutes(-30) })], has_more: false, next_cursor: null } }))
    const store = await enabled()
    vi.setSystemTime(T0 + 10 * 60_000)
    expect(await poll(filters, store)).toEqual([])
    expect(await poll(filters, store)).toEqual([])
  })

  test('follows the cursor with only the cursor in the continuation body', async () => {
    const pages: Record<string, unknown> = {
      first: { jobs: [job({ id: 'a', created_at: minutes(1) })], has_more: true, next_cursor: 'cursor-1' },
      'cursor-1': { jobs: [job({ id: 'b', created_at: minutes(2) })], has_more: false, next_cursor: null },
    }
    const { requests } = mockApi((request) => ({ body: pages[(request.body as { cursor?: string }).cursor ?? 'first'] }))
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * 60_000)
    const result = await poll(filters, store)
    expect(requests).toHaveLength(2)
    expect(requests[1].body).toEqual({ cursor: 'cursor-1' })
    expect(result.map((item) => (item as { id: string }).id)).toEqual(['a', 'b'])
  })

  test('reads at most 20 pages of 25 per poll, and the next poll resumes from the watermark', async () => {
    let served = 0
    const { requests } = mockApi(() => {
      served += 1
      return { body: { jobs: [job({ id: `p${served}`, created_at: minutes(served) })], has_more: true, next_cursor: `c${served}` } }
    })
    const store = await enabled()
    vi.setSystemTime(T0 + 60 * 60_000)
    const result = await poll(filters, store)
    expect(requests).toHaveLength(20)
    expect(result).toHaveLength(20)
    expect((requests[0].body as FeedBody)['batch_size']).toBe(25)
    expect(store.data.get('lastPoll')).toBe(T0 + 20 * 60_000)
  })

  test('maps 402, 401 and 429 from the feed', async () => {
    const store = await enabled()
    mockApi(() => ({ status: 402, body: { error: 'Insufficient credits', detail: 'Need 75 credits.', top_up_url: 'https://enterprise.jobo.world/credits?topup=5' } }))
    await expect(poll(filters, store)).rejects.toThrow(/HTTP 402.*topup=5/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    await expect(poll(filters, store)).rejects.toThrow(/HTTP 401/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 429, body: { retry_after_seconds: 30 } }))
    await expect(poll(filters, store)).rejects.toThrow(/HTTP 429.*30 seconds/)
  })

  test('a failed poll does not move the watermark', async () => {
    const store = await enabled()
    mockApi(() => ({ status: 503, body: { detail: 'busy' } }))
    await expect(poll(filters, store)).rejects.toThrow(/HTTP 503/)
    expect(store.data.get('lastPoll')).toBe(T0)
  })
})

describe('New Job trigger: definition', () => {
  test('is a read-only polling trigger that explains billing', () => {
    expect(newJob.classification).toBe('READ')
    expect(newJob.type).toBe('POLLING')
    expect(newJob.props['cost_notice'].description).toMatch(/billed once/)
    expect(newJob.props['cost_notice'].description).toMatch(/at least one of/)
  })
})
