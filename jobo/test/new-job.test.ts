import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { newJob } from '../src/lib/triggers/new-job'
import { triggerContext } from './helpers/contexts'
import { job, memoryStore, mockApi, type Recorded, type Reply } from './helpers/mock-api'

const T0 = Date.parse('2026-11-23T12:00:00Z')
const MINUTE = 60_000
const minutes = (count: number) => new Date(T0 + count * MINUTE).toISOString()
const filters = { location: [{ country: 'Germany', city: 'Berlin' }], companies: ['c1\nc2'] }

type FeedBody = Record<string, unknown>
type Row = ReturnType<typeof job>
type Scan = { since: number, startedAt: number | null, cursor: string | null }

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

async function poll(propsValue: Record<string, unknown>, store: ReturnType<typeof memoryStore>) {
  const result = await newJob.run(triggerContext({ propsValue, store }) as never)
  return ids(result)
}

function ids(items: unknown) {
  return Array.isArray(items) ? items.map((item) => (item as { id: string }).id) : []
}

function scanOf(store: ReturnType<typeof memoryStore>) {
  return store.data.get('joboFeedScan') as Scan | undefined
}

function rows({ prefix, count, createdAt, postedAt }: { prefix: string, count: number, createdAt: string, postedAt?: string }): Row[] {
  return Array.from({ length: count }, (_, index) =>
    job({ id: `${prefix}${String(index).padStart(4, '0')}`, created_at: createdAt, date_posted: postedAt ?? createdAt }),
  )
}

function feedServer(initial: Row[]) {
  const feed = { rows: [...initial] }
  const handler = (request: Recorded): Reply => {
    const body = request.body as FeedBody
    const cursor = typeof body['cursor'] === 'string' ? (JSON.parse(body['cursor']) as { p: string, a: [number, string], s: number }) : null
    const postedAfter = cursor ? cursor.p : String(body['posted_after'])
    const size = cursor ? cursor.s : Number(body['batch_size'])
    const floor = Date.parse(postedAfter)
    const ordered = feed.rows
      .filter((row) => Date.parse(row.date_posted) >= floor || Date.parse(row.created_at) >= floor)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))
    const after = cursor ? cursor.a : null
    const remaining = after
      ? ordered.filter((row) => Date.parse(row.created_at) > after[0] || (Date.parse(row.created_at) === after[0] && row.id > after[1]))
      : ordered
    const page = remaining.slice(0, size)
    const hasMore = remaining.length > size
    const last = page[page.length - 1]
    const next = hasMore && last ? JSON.stringify({ p: postedAfter, a: [Date.parse(last.created_at), last.id], s: size }) : null
    return { body: { jobs: page, has_more: hasMore, next_cursor: next } }
  }
  return { feed, handler }
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
    const store = memoryStore({ joboEnabledAt: T0 })
    await expect(poll({ language: ['en'] }, store)).rejects.toThrow(/at least one of/)
    await expect(newJob.test(triggerContext({ propsValue: {} }) as never)).rejects.toThrow(/at least one of/)
    expect(requests).toHaveLength(0)
  })

  test('turning on reads no jobs and starts the window now', async () => {
    const { requests } = mockApi(() => ({}))
    const store = await enabled()
    expect(requests).toHaveLength(0)
    expect(store.data.get('joboEnabledAt')).toBe(T0)
    expect(store.data.get('joboSeenJobs')).toEqual([])
    expect(scanOf(store)).toBeUndefined()
  })

  test('a republish keeps the stored state, including a scan in progress', async () => {
    const { handler } = feedServer(rows({ prefix: 'a', count: 510, createdAt: minutes(1) }))
    mockApi(handler)
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * MINUTE)
    await poll(filters, store)
    const held = scanOf(store)
    expect(held?.cursor).toEqual(expect.any(String))
    vi.setSystemTime(T0 + 60 * MINUTE)
    await newJob.onEnable(triggerContext({ propsValue: filters, store, isRepublish: true }) as never)
    expect(store.data.get('joboEnabledAt')).toBe(T0)
    expect(scanOf(store)).toEqual(held)
  })

  test('turning off and on again starts fresh', async () => {
    const store = await enabled()
    await store.put('joboSeenJobs', [{ id: 'old', createdAt: T0 }])
    await store.put('joboFeedScan', { since: T0, startedAt: T0, cursor: 'c', filters: '{}' })
    vi.setSystemTime(T0 + 3_600_000)
    await newJob.onEnable(triggerContext({ propsValue: filters, store }) as never)
    expect(store.data.get('joboEnabledAt')).toBe(T0 + 3_600_000)
    expect(store.data.get('joboSeenJobs')).toEqual([])
    expect(scanOf(store)).toBeUndefined()
  })
})

describe('New Job trigger: sample data', () => {
  test('reads at most 5 jobs from the last 7 days in one request, in feed order (oldest first), and stores nothing', async () => {
    const jobs = [3, 2, 1].map((n) => job({ id: `j${n}`, created_at: minutes(-n * 1000) }))
    const { requests } = mockApi(() => ({ body: { jobs, has_more: true, next_cursor: 'more' } }))
    const store = memoryStore()
    const result = await newJob.test(triggerContext({ propsValue: filters, store }) as never)
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].url).toBe('https://connect.jobo.world/api/jobs/feed')
    const body = requests[0].body as FeedBody
    expect(body['batch_size']).toBe(5)
    expect(body['posted_after']).toBe(new Date(T0 - 7 * 86_400_000).toISOString())
    expect(ids(result)).toEqual(['j3', 'j2', 'j1'])
    expect(store.data.size).toBe(0)
  })
})

describe('New Job trigger: polling', () => {
  test('maps every filter onto the feed body and starts the first scan at the moment it was turned on', async () => {
    const { requests } = mockApi(() => ({ body: { jobs: [], has_more: false, next_cursor: null } }))
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * MINUTE)
    const props = {
      location: [{ country: 'Germany', city: 'Berlin' }, '{"country":"France"}'],
      companies: ['c1\nc2', 'Acme, Inc.'],
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
      companies: { include: ['c1', 'c2', 'Acme, Inc.'], exclude: ['c9'] },
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
    const store = memoryStore({ joboEnabledAt: T0 })
    await expect(poll({ location: [{ city: 'Berlin' }] }, store)).rejects.toThrow(/country is required/)
    expect(requests).toHaveLength(0)
  })

  test('emits new jobs once, catches a job the mirror served late, and starts each scan 15 minutes before the last one started', async () => {
    const { feed, handler } = feedServer([
      job({ id: 'j0', created_at: minutes(-2), date_posted: minutes(1) }),
      job({ id: 'j1', created_at: minutes(1) }),
      job({ id: 'j2', created_at: minutes(3) }),
    ])
    const { requests } = mockApi(handler)
    const store = await enabled()

    vi.setSystemTime(T0 + 5 * MINUTE)
    expect(await poll(filters, store)).toEqual(['j1', 'j2'])
    expect(scanOf(store)).toMatchObject({ since: T0, cursor: null })

    feed.rows.push(job({ id: 'late', created_at: minutes(2.5) }), job({ id: 'j3', created_at: minutes(8) }))
    vi.setSystemTime(T0 + 10 * MINUTE)
    expect(await poll(filters, store)).toEqual(['late', 'j3'])
    expect((requests[1].body as FeedBody)['posted_after']).toBe(minutes(0))

    vi.setSystemTime(T0 + 30 * MINUTE)
    expect(await poll(filters, store)).toEqual([])
    vi.setSystemTime(T0 + 35 * MINUTE)
    expect(await poll(filters, store)).toEqual([])
    expect((requests[3].body as FeedBody)['posted_after']).toBe(minutes(15))
    expect(requests.every((request) => request.path === '/api/jobs/feed')).toBe(true)
  })

  test('a job created before the trigger was turned on is never emitted, even when the feed returns it', async () => {
    mockApi(() => ({ body: { jobs: [job({ id: 'old', created_at: minutes(-30), date_posted: minutes(1) })], has_more: false, next_cursor: null } }))
    const store = await enabled()
    vi.setSystemTime(T0 + 10 * MINUTE)
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
    vi.setSystemTime(T0 + 5 * MINUTE)
    expect(await poll(filters, store)).toEqual(['a', 'b'])
    expect(requests).toHaveLength(2)
    expect(requests[1].body).toEqual({ cursor: 'cursor-1' })
  })

  test('reads at most 20 pages of 25 per poll and keeps the cursor for the next poll', async () => {
    let served = 0
    const { requests } = mockApi(() => {
      served += 1
      return { body: { jobs: [job({ id: `p${served}`, created_at: minutes(served) })], has_more: true, next_cursor: `c${served}` } }
    })
    const store = await enabled()
    vi.setSystemTime(T0 + 60 * MINUTE)
    expect(await poll(filters, store)).toHaveLength(20)
    expect(requests).toHaveLength(20)
    expect((requests[0].body as FeedBody)['batch_size']).toBe(25)
    expect(scanOf(store)).toMatchObject({ since: T0, startedAt: T0 + 60 * MINUTE, cursor: 'c20' })

    vi.setSystemTime(T0 + 65 * MINUTE)
    await poll(filters, store)
    expect(requests[20].body).toEqual({ cursor: 'c20' })
  })

  test('a window whose first pages are all jobs already delivered still reaches the new jobs behind them', async () => {
    const delivered = rows({ prefix: 'seen', count: 500, createdAt: minutes(1) })
    const fresh = rows({ prefix: 'new', count: 30, createdAt: minutes(2) })
    const { handler } = feedServer([...delivered, ...fresh])
    const { requests } = mockApi(handler)
    const store = await enabled()
    await store.put('joboSeenJobs', delivered.map((row) => ({ id: row.id, createdAt: T0 + MINUTE })))

    vi.setSystemTime(T0 + 5 * MINUTE)
    expect(await poll(filters, store)).toEqual([])
    expect(requests).toHaveLength(20)
    expect(scanOf(store)?.cursor).not.toBeNull()

    vi.setSystemTime(T0 + 10 * MINUTE)
    expect(await poll(filters, store)).toEqual(fresh.map((row) => row.id))
    expect(Object.keys(requests[20].body as FeedBody)).toEqual(['cursor'])
  })

  test('more new jobs on one timestamp than one poll can read are all delivered once over the next polls', async () => {
    const batch = rows({ prefix: 'acme', count: 800, createdAt: minutes(1) })
    const { handler } = feedServer(batch)
    mockApi(handler)
    const store = await enabled()
    const delivered: string[] = []

    for (const at of [5, 10, 15, 20, 25, 30]) {
      vi.setSystemTime(T0 + at * MINUTE)
      delivered.push(...(await poll(filters, store)))
    }
    expect(delivered).toHaveLength(800)
    expect(new Set(delivered).size).toBe(800)
    expect(delivered).toEqual(batch.map((row) => row.id))
  })

  test('jobs the employer re-posted sort first and are skipped without stalling the trigger', async () => {
    const reposted = rows({ prefix: 'old', count: 600, createdAt: minutes(-60 * 24 * 40), postedAt: minutes(1) })
    const fresh = rows({ prefix: 'new', count: 2, createdAt: minutes(2) })
    const { handler } = feedServer([...reposted, ...fresh])
    mockApi(handler)
    const store = await enabled()

    vi.setSystemTime(T0 + 5 * MINUTE)
    expect(await poll(filters, store)).toEqual([])
    vi.setSystemTime(T0 + 10 * MINUTE)
    expect(await poll(filters, store)).toEqual(['new0000', 'new0001'])
    vi.setSystemTime(T0 + 15 * MINUTE)
    expect(await poll(filters, store)).toEqual([])
  })

  test('a job delivered earlier and re-posted by the employer later is not delivered again', async () => {
    const delivered = job({ id: 'a', created_at: minutes(1), date_posted: minutes(1) })
    const { feed, handler } = feedServer([delivered])
    mockApi(handler)
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * MINUTE)
    expect(await poll(filters, store)).toEqual(['a'])
    for (const at of [30, 40]) {
      vi.setSystemTime(T0 + at * MINUTE)
      expect(await poll(filters, store)).toEqual([])
    }
    expect(store.data.get('joboSeenJobs')).toEqual([])
    feed.rows[0] = { ...delivered, date_posted: minutes(50) }
    vi.setSystemTime(T0 + 55 * MINUTE)
    expect(await poll(filters, store)).toEqual([])
  })

  test('a 409 restart mid-scan drops the cursor and reads the same window again, with no job delivered twice', async () => {
    const { handler } = feedServer(rows({ prefix: 'a', count: 30, createdAt: minutes(1) }))
    let refused = false
    const { requests } = mockApi((request) => {
      if ((request.body as FeedBody)['cursor'] && !refused) {
        refused = true
        return { status: 409, body: { code: 'feed_cursor_restart_required', detail: 'Restart the scan.' } }
      }
      return handler(request)
    })
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * MINUTE)
    const delivered = await poll(filters, store)
    expect(new Set(delivered).size).toBe(30)
    expect(delivered).toHaveLength(30)
    expect(requests.map((request) => Object.keys(request.body as FeedBody).includes('cursor'))).toEqual([false, true, false, true])
    expect((requests[2].body as FeedBody)['posted_after']).toBe(minutes(0))
  })

  test('a 400 for a held cursor restarts the scan from the same window on a later poll', async () => {
    const { handler } = feedServer(rows({ prefix: 'a', count: 30, createdAt: minutes(1) }))
    const store = await enabled()
    await store.put('joboFeedScan', { since: T0, startedAt: T0 + MINUTE, cursor: 'expired', filters: JSON.stringify({ locations: [{ country: 'Germany', city: 'Berlin' }], companies: { include: ['c1', 'c2'] } }) })
    const { requests } = mockApi((request) => {
      if ((request.body as FeedBody)['cursor'] === 'expired') return { status: 400, body: { title: 'Invalid cursor', detail: 'The provided cursor is malformed.' } }
      return handler(request)
    })
    vi.setSystemTime(T0 + 5 * MINUTE)
    expect(await poll(filters, store)).toHaveLength(30)
    expect(requests[0].body).toEqual({ cursor: 'expired' })
    expect((requests[1].body as FeedBody)['posted_after']).toBe(minutes(0))
  })

  test('a 400 on the first page of a scan is an error, not a restart loop', async () => {
    const { requests } = mockApi(() => ({ status: 400, body: { detail: 'bad filter' } }))
    const store = await enabled()
    await expect(poll(filters, store)).rejects.toThrow(/HTTP 400.*bad filter/)
    expect(requests).toHaveLength(1)
  })

  test('changed filters drop the held cursor and start the scan again from the same window', async () => {
    const { handler } = feedServer(rows({ prefix: 'a', count: 30, createdAt: minutes(1) }))
    const { requests } = mockApi(handler)
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * MINUTE)
    await newJob.run(triggerContext({ propsValue: filters, store }) as never)
    expect(scanOf(store)?.cursor).toBeNull()
    await store.put('joboFeedScan', { ...scanOf(store), since: T0, cursor: 'held' })
    vi.setSystemTime(T0 + 10 * MINUTE)
    const before = requests.length
    await poll({ ...filters, sources: ['ashby'] }, store)
    const first = requests[before].body as FeedBody
    expect(first['cursor']).toBeUndefined()
    expect(first['sources']).toEqual(['ashby'])
    expect(first['posted_after']).toBe(minutes(0))
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

  test('a 503 is retried once after 5 seconds, and a poll that still fails stores nothing', async () => {
    const store = await enabled()
    const { requests } = mockApi(() => ({ status: 503, body: { detail: 'busy' }, headers: { 'Retry-After': '5' } }))
    const failing = expect(poll(filters, store)).rejects.toThrow(/HTTP 503/)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await failing
    expect(requests).toHaveLength(2)
    expect(scanOf(store)).toBeUndefined()
    expect(store.data.get('joboSeenJobs')).toEqual([])
  })

  test('a failure on a later page keeps the earlier pages for the next poll, so nothing is lost', async () => {
    const { handler } = feedServer(rows({ prefix: 'a', count: 30, createdAt: minutes(1) }))
    let failNext = true
    mockApi((request) => {
      if ((request.body as FeedBody)['cursor'] && failNext) return { status: 402, body: { error: 'Insufficient credits' } }
      return handler(request)
    })
    const store = await enabled()
    vi.setSystemTime(T0 + 5 * MINUTE)
    await expect(poll(filters, store)).rejects.toThrow(/HTTP 402/)
    expect(scanOf(store)).toBeUndefined()
    failNext = false
    expect(await poll(filters, store)).toHaveLength(30)
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
