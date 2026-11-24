import { httpClient } from '@activepieces/pieces-common'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { listHiringSignals } from '../src/lib/actions/list-hiring-signals'
import { joboOutput } from '../src/lib/common/output'
import { joboSignalPoll, type SignalPollState } from '../src/lib/common/signal-poll'
import { joboSignals } from '../src/lib/common/signals'
import { newHiringSignal } from '../src/lib/triggers/new-hiring-signal'
import { actionContext, triggerContext } from './helpers/contexts'
import { FAKE_KEY, FAKE_SANDBOX_KEY, memoryStore, mockApi, type Recorded, type Reply } from './helpers/mock-api'

const T0 = Date.parse('2026-11-24T12:00:00Z')
const KEY = 'joboSignalPoll'
const EXACT = '2026-11-24T13:53:55.837281Z'
const filters = { domains: 'stripe.com', min_strength: 40 }

type Store = ReturnType<typeof memoryStore>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function signal(id: string, createdAt: string) {
  return {
    id,
    type: 'leadership_hire',
    detected_on: '2026-11-24',
    created_at: createdAt,
    strength: 70,
    company: { id: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'Stripe', domain: 'stripe.com' },
    details: { title: 'VP of Engineering' },
    focus: {},
    evidence_job_ids: [],
  }
}

function micro(n: number): string {
  return `2026-11-24T13:53:55.${String(837000 + n).padStart(6, '0')}Z`
}

function queryOf(request: Recorded): Record<string, string> {
  const values: Record<string, string> = {}
  request.query.forEach((value, key) => {
    values[key] = value
  })
  return values
}

function signalServer(initial: ReturnType<typeof signal>[]) {
  const store = { rows: [...initial] }
  const handler = (request: Recorded): Reply => {
    const query = queryOf(request)
    if (query['sort'] !== 'created_asc') return { status: 400, body: { errors: { sort: ['bad sort'] } } }
    const after = query['created_after']
    const limit = Number(query['limit'])
    let position: [string, string] | null = null
    if (query['cursor'] !== undefined) {
      try {
        position = JSON.parse(query['cursor']) as [string, string]
      }
      catch {
        return { status: 400, body: { title: 'One or more validation errors occurred.', errors: { cursor: ['cursor is not valid.'] } } }
      }
    }
    const ordered = store.rows
      .filter((row) => row.created_at > after)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    const remaining = position === null
      ? ordered
      : ordered.filter((row) => row.created_at > position[0] || (row.created_at === position[0] && row.id > position[1]))
    const page = remaining.slice(0, limit)
    const hasMore = remaining.length > limit
    const last = page[page.length - 1]
    return { body: { signals: page, has_more: hasMore, next_cursor: hasMore && last ? JSON.stringify([last.created_at, last.id]) : null } }
  }
  return { store, handler }
}

async function enabled(propsValue: Record<string, unknown> = filters): Promise<Store> {
  const store = memoryStore()
  await newHiringSignal.onEnable(triggerContext({ propsValue, store }) as never)
  return store
}

async function poll(store: Store, propsValue: Record<string, unknown> = filters): Promise<string[]> {
  const result = await newHiringSignal.run(triggerContext({ propsValue, store }) as never)
  return result.map((item) => String((item as { id: unknown }).id))
}

function stateOf(store: Store): SignalPollState | undefined {
  return store.data.get(KEY) as SignalPollState | undefined
}

describe('New Hiring Signal: turning on and the guard', () => {
  test('turning on records now as an ISO string and makes no request', async () => {
    const { requests } = mockApi(() => ({}))
    const store = await enabled()
    expect(requests).toHaveLength(0)
    expect(stateOf(store)).toEqual({ watermark: '2026-11-24T12:00:00.000Z' })
  })

  test('a first run with no state records now and makes no request', async () => {
    const { requests } = mockApi(() => ({}))
    const store = memoryStore()
    expect(await poll(store)).toEqual([])
    expect(requests).toHaveLength(0)
    expect(stateOf(store)).toEqual({ watermark: '2026-11-24T12:00:00.000Z' })
  })

  test('a republish keeps the position, including a held cursor; turning on again starts at now', async () => {
    const held: SignalPollState = { watermark: EXACT, cursor: { value: 'c1', since: '2026-11-24T10:00:00Z' } }
    const store = memoryStore({ [KEY]: held })
    await newHiringSignal.onEnable(triggerContext({ propsValue: filters, store, isRepublish: true }) as never)
    expect(stateOf(store)).toEqual(held)
    vi.setSystemTime(T0 + 3_600_000)
    await newHiringSignal.onEnable(triggerContext({ propsValue: filters, store }) as never)
    expect(stateOf(store)).toEqual({ watermark: '2026-11-24T13:00:00.000Z' })
  })

  test.each([
    {},
    { min_strength: 80, detected_after: '2026-11-01', exclude_agencies: true, reposted_only: true },
    { domains: '  \n ', types: [] },
    { exclude_domains: 'acme.example', min_new_jobs: 5 },
  ])('refuses %j without a narrowing filter, before any request, in onEnable, run and test', async (props) => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    await expect(newHiringSignal.onEnable(triggerContext({ propsValue: props, store: memoryStore() }) as never)).rejects.toThrow(
      /Set at least one of Signal Types, Company Domains, Company IDs, .* or Job Cities before using this trigger/,
    )
    await expect(poll(store, props)).rejects.toThrow(/every hiring signal Jobo detects/)
    await expect(newHiringSignal.test(triggerContext({ propsValue: props }) as never)).rejects.toThrow(/Set at least one of/)
    expect(requests).toHaveLength(0)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
  })

  test('each narrowing filter on its own is enough', () => {
    for (const key of joboSignals.NARROWING_SIGNAL_FILTER_KEYS) {
      const filter = joboSignals.SIGNAL_FILTERS.find((entry) => entry.key === key)
      const value = filter?.options ? [filter.options[0]] : 'x'
      const query = joboSignals.toSignalsQuery({ values: { [key]: value }, keys: joboSignals.ALL_SIGNAL_FILTER_KEYS })
      expect(() => joboSignals.requireNarrowingSignalFilter(query)).not.toThrow()
    }
  })

  test('the narrowing keys are the contract ones', () => {
    expect([...joboSignals.NARROWING_SIGNAL_FILTER_KEYS]).toEqual([
      'types', 'domains', 'company_ids', 'countries', 'company_sizes', 'industries', 'categories', 'funding_stages', 'functions',
      'roles', 'seniority', 'technologies', 'skills', 'technology_categories', 'job_countries', 'job_regions', 'job_cities',
    ])
  })
})

describe('New Hiring Signal: sample data', () => {
  test('is a static flat signal, makes no request and stores nothing', async () => {
    const { requests } = mockApi(() => ({}))
    const store = memoryStore()
    const result = await newHiringSignal.test(triggerContext({ propsValue: filters, store }) as never)
    expect(requests).toHaveLength(0)
    expect(store.data.size).toBe(0)
    expect(result).toEqual([joboOutput.SIGNAL_SAMPLE])
    expect(newHiringSignal.sampleData).toEqual(joboOutput.SIGNAL_SAMPLE)
    expect(JSON.stringify(joboOutput.SIGNAL_SAMPLE)).toMatch(/\.example/)
  })

  test('has exactly the keys a real signal has in List Hiring Signals', async () => {
    mockApi(() => ({ body: { signals: [signal('s1', EXACT)], has_more: false } }))
    const page = (await listHiringSignals.run(actionContext({ domains: 'stripe.com' }) as never)) as { signals: Record<string, unknown>[] }
    expect(Object.keys(joboOutput.SIGNAL_SAMPLE)).toEqual(Object.keys(page.signals[0]))
  })

  test('still checks the filters', async () => {
    await expect(newHiringSignal.test(triggerContext({ propsValue: { domains: 'stripe.com', types: ['surge'] } }) as never)).rejects.toThrow(
      /Signal Types does not take "surge"/,
    )
  })
})

describe('New Hiring Signal: polling', () => {
  test('sends sort=created_asc, the filters, the limit and the stored created_at back unchanged', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    await poll(store, { ...filters, types: ['leadership_hire'], max_signals: 7 })
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].path).toBe('/api/signals')
    expect(requests[0].headers['X-Api-Key']).toBe(FAKE_KEY)
    expect(queryOf(requests[0])).toEqual({
      types: 'leadership_hire',
      domains: 'stripe.com',
      min_strength: '40',
      sort: 'created_asc',
      created_after: EXACT,
      limit: '7',
    })
    expect(requests[0].url).toContain('created_after=2026-11-24T13%3A53%3A55.837281Z')
  })

  test('keeps the created_at of the last signal verbatim, and the next poll sends exactly that string', async () => {
    const odd = '2026-11-24T13:53:55.8372Z'
    const { requests } = mockApi(() => ({ body: { signals: [signal('a', '2026-11-24T12:30:00Z'), signal('b', odd)], has_more: false } }))
    const store = await enabled()
    expect(await poll(store)).toEqual(['a', 'b'])
    expect(stateOf(store)).toEqual({ watermark: odd })
    await poll(store)
    expect(requests[1].query.get('created_after')).toBe(odd)
    expect(requests[0].query.get('created_after')).toBe('2026-11-24T12:00:00.000Z')
  })

  test('returns signals flattened like the action', async () => {
    mockApi(() => ({ body: { signals: [signal('a', EXACT)], has_more: false } }))
    const store = memoryStore({ [KEY]: { watermark: '2026-11-24T00:00:00Z' } })
    const result = await newHiringSignal.run(triggerContext({ propsValue: filters, store }) as never)
    expect(result).toEqual([joboOutput.flattenSignal(signal('a', EXACT))])
  })

  test('more than the maximum leaves a cursor, and the next poll continues with it and the same since', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => signal(`s${String(index).padStart(2, '0')}`, micro(index)))
    const { handler } = signalServer(rows)
    const { requests } = mockApi(handler)
    const start = '2026-11-24T13:00:00Z'
    const store = memoryStore({ [KEY]: { watermark: start } })
    const props = { ...filters, max_signals: 10 }

    expect(await poll(store, props)).toEqual(rows.slice(0, 10).map((row) => row.id))
    expect(stateOf(store)).toEqual({ watermark: micro(9), cursor: { value: JSON.stringify([micro(9), 's09']), since: start } })

    expect(await poll(store, props)).toEqual(rows.slice(10, 20).map((row) => row.id))
    expect(queryOf(requests[1])).toMatchObject({ created_after: start, cursor: JSON.stringify([micro(9), 's09']), limit: '10' })
    expect(stateOf(store)?.cursor?.since).toBe(start)

    expect(await poll(store, props)).toEqual(rows.slice(20).map((row) => row.id))
    expect(stateOf(store)).toEqual({ watermark: micro(24) })
    expect(await poll(store, props)).toEqual([])
    expect(requests).toHaveLength(4)
    expect(requests[3].query.get('created_after')).toBe(micro(24))
    expect(requests[3].query.get('cursor')).toBeNull()
  })

  test('an old batch sharing one created_at is delivered once, across polls, with nothing skipped', async () => {
    const batch = Array.from({ length: 30 }, (_, index) => signal(`b${String(index).padStart(2, '0')}`, '2026-11-24T13:00:00Z'))
    const { handler } = signalServer(batch)
    mockApi(handler)
    const store = memoryStore({ [KEY]: { watermark: '2026-11-24T12:00:00Z' } })
    const delivered: string[] = []
    for (let index = 0; index < 4; index++) delivered.push(...(await poll(store, { ...filters, max_signals: 8 })))
    expect(delivered).toEqual(batch.map((row) => row.id))
  })

  test('reads several pages in one poll when the API pages below the maximum', async () => {
    const pages: Record<string, Reply> = {
      none: { body: { signals: [signal('a', micro(1)), signal('b', micro(2))], has_more: true, next_cursor: 'c1' } },
      c1: { body: { signals: [signal('c', micro(3))], has_more: false, next_cursor: null } },
    }
    const { requests } = mockApi((request) => pages[request.query.get('cursor') ?? 'none'])
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    expect(await poll(store, { ...filters, max_signals: 5 })).toEqual(['a', 'b', 'c'])
    expect(requests.map((request) => request.query.get('limit'))).toEqual(['5', '3'])
    expect(requests[1].query.get('created_after')).toBe(EXACT)
    expect(stateOf(store)).toEqual({ watermark: micro(3) })
  })

  test('defaults to 10 per poll and caps the maximum at 100', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    await poll(store)
    await poll(store, { ...filters, max_signals: 5000 })
    expect(requests.map((request) => request.query.get('limit'))).toEqual(['10', '100'])
  })

  test('an empty poll changes nothing, with or without a held cursor', async () => {
    mockApi(() => ({ body: { signals: [], has_more: false } }))
    for (const state of [{ watermark: EXACT }, { watermark: EXACT, cursor: { value: 'c9', since: '2026-11-24T10:00:00Z' } }]) {
      const store = memoryStore({ [KEY]: state })
      const put = vi.spyOn(store, 'put')
      expect(await poll(store)).toEqual([])
      expect(stateOf(store)).toEqual(state)
      expect(put).not.toHaveBeenCalled()
    }
  })

  test('a refused cursor falls back to the watermark once', async () => {
    const { handler } = signalServer([signal('x', micro(1)), signal('y', micro(2))])
    const { requests } = mockApi(handler)
    const store = memoryStore({ [KEY]: { watermark: micro(0), cursor: { value: 'not-json', since: '2026-11-24T10:00:00Z' } } })
    expect(await poll(store)).toEqual(['x', 'y'])
    expect(requests).toHaveLength(2)
    expect(queryOf(requests[0])).toMatchObject({ cursor: 'not-json', created_after: '2026-11-24T10:00:00Z' })
    expect(queryOf(requests[1])['cursor']).toBeUndefined()
    expect(requests[1].query.get('created_after')).toBe(micro(0))
    expect(stateOf(store)).toEqual({ watermark: micro(2) })
  })

  test('a refused cursor with nothing new after the watermark drops the cursor', async () => {
    const { handler } = signalServer([])
    const { requests } = mockApi(handler)
    const store = memoryStore({ [KEY]: { watermark: EXACT, cursor: { value: 'not-json', since: '2026-11-24T10:00:00Z' } } })
    expect(await poll(store)).toEqual([])
    expect(requests).toHaveLength(2)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
  })

  test('a cursor refused again after the fallback, or a 400 for anything else, is an error', async () => {
    const { requests } = mockApi(() => ({ status: 400, body: { errors: { cursor: ['nope'] } } }))
    const held = { watermark: EXACT, cursor: { value: 'c1', since: '2026-11-24T10:00:00Z' } }
    const store = memoryStore({ [KEY]: held })
    await expect(poll(store)).rejects.toThrow(/HTTP 400/)
    expect(requests).toHaveLength(2)
    expect(stateOf(store)).toEqual(held)
    vi.restoreAllMocks()
    const sort = mockApi(() => ({ status: 400, body: { title: 'Bad sort', errors: { sort: ['unknown'] } } }))
    await expect(poll(memoryStore({ [KEY]: held }))).rejects.toThrow(/HTTP 400/)
    expect(sort.requests).toHaveLength(1)
  })

  test('a read that fails part-way saves nothing, and the next poll repeats it', async () => {
    const pages: Record<string, Reply> = {
      none: { body: { signals: [signal('a', micro(1))], has_more: true, next_cursor: 'c1' } },
      c1: { status: 402, body: { code: 'insufficient_credits', detail: 'Need 30 credits.' } },
    }
    const { requests } = mockApi((request) => pages[request.query.get('cursor') ?? 'none'])
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    await expect(poll(store, { ...filters, max_signals: 5 })).rejects.toThrow(/HTTP 402/)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
    pages['c1'] = { body: { signals: [signal('b', micro(2))], has_more: false } }
    expect(await poll(store, { ...filters, max_signals: 5 })).toEqual(['a', 'b'])
    expect(requests[2].query.get('created_after')).toBe(EXACT)
    expect(requests[2].query.get('cursor')).toBeNull()
  })

  test('a signal without created_at fails the poll and saves nothing', async () => {
    mockApi(() => ({ body: { signals: [{ id: 'a' }], has_more: false } }))
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    await expect(poll(store)).rejects.toThrow(/without Created At/)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
  })

  test('a page with has_more but no signals ends the poll instead of looping', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: true, next_cursor: 'c1' } }))
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    expect(await poll(store)).toEqual([])
    expect(requests).toHaveLength(1)
  })
})

describe('New Hiring Signal: errors', () => {
  test('402 names the signal price and the top-up link, is not retried and saves nothing', async () => {
    const { requests } = mockApi(() => ({
      status: 402,
      body: { code: 'insufficient_credits', detail: 'This request needs 300 credits.', top_up_url: 'https://enterprise.jobo.world/credits?topup=10' },
    }))
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    await expect(poll(store)).rejects.toThrow(/HTTP 402.*ten times the price of a job.*topup=10/)
    expect(requests).toHaveLength(1)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
  })

  test('403 account_key_required, the sandbox 404 and 429 use the actions\' messages', async () => {
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    mockApi(() => ({ status: 403, body: { code: 'account_key_required', title: 'Account API key required' } }))
    await expect(poll(store)).rejects.toThrow(/account API key \(HTTP 403\)/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 404, body: { code: 'not_available_in_sandbox', detail: 'x' } }))
    await expect(
      newHiringSignal.run({ ...triggerContext({ propsValue: filters, store }), auth: { type: 'SECRET_TEXT', secret_text: FAKE_SANDBOX_KEY } } as never),
    ).rejects.toThrow(/Hiring signals need a live Jobo API key/)
    vi.restoreAllMocks()
    const limited = mockApi(() => ({ status: 429, body: { retry_after_seconds: 12 } }))
    await expect(poll(store)).rejects.toThrow(/HTTP 429.*12 seconds/)
    expect(limited.requests).toHaveLength(1)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
  })

  test('a 5xx or a lost connection is not retried', async () => {
    const store = memoryStore({ [KEY]: { watermark: EXACT } })
    const { requests } = mockApi(() => ({ status: 500, body: { detail: 'boom' } }))
    await expect(poll(store)).rejects.toThrow(/HTTP 500.*not retried/)
    expect(requests).toHaveLength(1)
    vi.restoreAllMocks()
    const spy = vi.spyOn(httpClient, 'sendRequest').mockRejectedValue(new Error('socket hang up'))
    await expect(poll(store)).rejects.toThrow(/socket hang up.*not retried/)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(stateOf(store)).toEqual({ watermark: EXACT })
  })
})

describe('New Hiring Signal: poller and definition', () => {
  test('the poller with no state makes no request', async () => {
    const { requests } = mockApi(() => ({}))
    const result = await joboSignalPoll.pollSignals({ apiKey: FAKE_KEY, query: { domains: 'x' }, state: null, maxSignals: 10, now: () => new Date(EXACT) })
    expect(result).toEqual({ signals: [], state: { watermark: '2026-11-24T13:53:55.837Z' }, changed: true })
    expect(requests).toHaveLength(0)
  })

  test('offers the list action\'s filters minus Created After and Cursor, plus Maximum Signals per Poll', () => {
    const actionKeys = Object.keys(listHiringSignals.props).filter((key) => !['created_after', 'cursor', 'limit'].includes(key))
    expect(Object.keys(newHiringSignal.props)).toEqual(['cost_notice', ...actionKeys, 'max_signals'])
    const max = newHiringSignal.props['max_signals']
    expect(max).toMatchObject({ displayName: 'Maximum Signals per Poll', defaultValue: 10 })
    expect(max.description).toMatch(/billed at ten times the price of a job/)
    expect(max.description).toMatch(/next check continues where this one stopped/)
  })

  test('is a polling trigger whose notice says what is billed, that sample data is free and what is required', () => {
    expect(newHiringSignal.type).toBe('POLLING')
    const notice = String(newHiringSignal.props['cost_notice'].description)
    expect(notice).toMatch(/ten times the price of a job/)
    expect(notice).toMatch(/Loading sample data makes no request and is free/)
    expect(notice).toMatch(/A check that finds nothing is free/)
    expect(notice).toMatch(/Set at least one of Signal Types/)
  })
})
