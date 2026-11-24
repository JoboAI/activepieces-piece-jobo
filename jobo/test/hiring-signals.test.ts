import { httpClient } from '@activepieces/pieces-common'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { listCompanyHiringSignals } from '../src/lib/actions/list-company-hiring-signals'
import { listHiringSignals } from '../src/lib/actions/list-hiring-signals'
import { joboOutput } from '../src/lib/common/output'
import { joboSignalSummary } from '../src/lib/common/signal-summary'
import { joboSignals } from '../src/lib/common/signals'
import { actionContext } from './helpers/contexts'
import { FAKE_KEY, FAKE_SANDBOX_KEY, FREE_PATHS, mockApi } from './helpers/mock-api'

afterEach(() => vi.restoreAllMocks())

const COMPANY_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: '5b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3',
    type: 'hiring_surge',
    detected_on: '2026-11-20',
    created_at: '2026-11-20T06:12:00.123456Z',
    window_start: '2026-11-14',
    window_end: '2026-11-20',
    strength: 82,
    company: {
      id: COMPANY_ID,
      name: 'Northwind Robotics',
      domain: 'northwind-robotics.example',
      country_code: 'DE',
      size: '201-500',
      industry: 'Software Development',
      industries: ['Software Development', 'Robotics'],
      categories: ['b2b', 'saas'],
      is_agency: false,
      funding_stage: 'Series B',
      founded_year: 2015,
    },
    details: { new_jobs: 17, baseline_weekly_avg: 3.1, ratio: 5.5, is_agency: false },
    focus: { functions: ['technology', 'sales'], topics: [], job_countries: ['DE'], job_regions: [], job_cities: [] },
    evidence_job_ids: ['7c9e6679-7425-40de-944b-e07fc1f90ae7', '9b2f1c55-3e4d-4a6b-8c7d-0e1f2a3b4c5d'],
    ...overrides,
  }
}

type Page = { signals: Record<string, unknown>[], has_more: boolean, next_cursor: string | null }

function queryOf(request: { query: URLSearchParams }): Record<string, string> {
  const values: Record<string, string> = {}
  request.query.forEach((value, key) => {
    values[key] = value
  })
  return values
}

const list = async (props: Record<string, unknown>, secret?: string): Promise<Page> =>
  (await listHiringSignals.run(actionContext(props, secret) as never)) as Page

const listCompany = async (props: Record<string, unknown>): Promise<Page> =>
  (await listCompanyHiringSignals.run(actionContext(props) as never)) as Page

describe('List Hiring Signals', () => {
  test('sends one GET /api/signals with the filters as comma-separated query values', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [signal()], has_more: true, next_cursor: 'cur_2' } }))
    await list({
      types: ['hiring_surge', 'new_country'],
      domains: 'stripe.com\nnorthwind-robotics.example\n',
      company_ids: [COMPANY_ID],
      exclude_domains: ['acme.example'],
      countries: 'DE\nUS',
      company_sizes: ['51-200', '10001+'],
      industries: 'Software Development',
      funding_stages: ['Seed', 'Series A'],
      founded_after: 2010,
      exclude_agencies: true,
      functions: 'Technology',
      roles: 'data engineer',
      seniority: ['senior', 'vp'],
      technologies: 'Snowflake',
      skills: 'Rust',
      technology_categories: 'CRM',
      job_countries: 'GB',
      job_regions: 'Texas',
      job_cities: 'Austin',
      min_strength: 40,
      min_new_jobs: 5,
      min_days_open: 30,
      reposted_only: true,
      detected_after: '2026-11-01T00:00:00.000Z',
      detected_before: '2026-11-20',
      created_after: '2026-11-12T09:30:00.1234567Z',
      limit: 5,
      cursor: ' cur_1 ',
    })

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.method).toBe('GET')
    expect(request.path).toBe('/api/signals')
    expect(FREE_PATHS.some((pattern) => pattern.test(request.path))).toBe(false)
    expect(request.headers['X-Api-Key']).toBe(FAKE_KEY)
    expect(request.headers['X-Jobo-Client']).toBe('activepieces')
    expect(request.body).toBeUndefined()
    expect(queryOf(request)).toEqual({
      types: 'hiring_surge,new_country',
      domains: 'stripe.com,northwind-robotics.example',
      company_ids: COMPANY_ID,
      exclude_domains: 'acme.example',
      countries: 'DE,US',
      company_sizes: '51-200,10001+',
      industries: 'Software Development',
      funding_stages: 'Seed,Series A',
      founded_after: '2010',
      exclude_agencies: 'true',
      functions: 'Technology',
      roles: 'data engineer',
      seniority: 'senior,vp',
      technologies: 'Snowflake',
      skills: 'Rust',
      technology_categories: 'CRM',
      job_countries: 'GB',
      job_regions: 'Texas',
      job_cities: 'Austin',
      min_strength: '40',
      min_new_jobs: '5',
      min_days_open: '30',
      reposted_only: 'true',
      detected_after: '2026-11-01',
      detected_before: '2026-11-20',
      created_after: '2026-11-12T09:30:00.1234567Z',
      limit: '5',
      cursor: 'cur_1',
    })
  })

  test('sends nothing for an untouched field', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    await list({ types: [], domains: '', exclude_agencies: false, reposted_only: false, min_strength: undefined, cursor: '' })
    expect(queryOf(requests[0])).toEqual({ limit: '10' })
  })

  test('defaults to 10 signals, caps Maximum Signals at 100 and reads one page only', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [signal()], has_more: true, next_cursor: 'more' } }))
    await list({ domains: 'stripe.com' })
    await list({ domains: 'stripe.com', limit: 5000 })
    await list({ domains: 'stripe.com', limit: 0 })
    expect(requests.map((request) => request.query.get('limit'))).toEqual(['10', '100', '10'])
    expect(requests).toHaveLength(3)
  })

  test('returns flat signals with a summary, the type label, has_more and next_cursor', async () => {
    mockApi(() => ({ body: { signals: [signal()], has_more: true, next_cursor: 'cur_2' } }))
    const page = await list({ domains: 'northwind-robotics.example' })
    expect(page.has_more).toBe(true)
    expect(page.next_cursor).toBe('cur_2')
    expect(page.signals).toEqual([
      {
        id: '5b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3',
        type: 'hiring_surge',
        type_label: 'Hiring surge',
        summary: '17 new jobs this week vs 3.1 a week normally',
        detected_on: '2026-11-20',
        created_at: '2026-11-20T06:12:00.123456Z',
        window_start: '2026-11-14',
        window_end: '2026-11-20',
        strength: 82,
        company_id: COMPANY_ID,
        company_name: 'Northwind Robotics',
        company_domain: 'northwind-robotics.example',
        company_country_code: 'DE',
        company_size: '201-500',
        company_industry: 'Software Development',
        company_industries: 'Software Development, Robotics',
        company_categories: 'b2b, saas',
        company_is_agency: false,
        company_funding_stage: 'Series B',
        company_founded_year: 2015,
        focus_functions: 'technology, sales',
        focus_title: null,
        focus_occupation: null,
        focus_seniority: null,
        focus_topics: null,
        focus_topic_category: null,
        focus_job_countries: 'DE',
        focus_job_regions: null,
        focus_job_cities: null,
        evidence_job_ids: ['7c9e6679-7425-40de-944b-e07fc1f90ae7', '9b2f1c55-3e4d-4a6b-8c7d-0e1f2a3b4c5d'],
        details: { new_jobs: 17, baseline_weekly_avg: 3.1, ratio: 5.5, is_agency: false },
      },
    ])
  })

  test('the last page has no cursor, and an empty page is an empty list', async () => {
    mockApi(() => ({ body: { signals: [], has_more: false } }))
    expect(await list({ domains: 'stripe.com' })).toEqual({ signals: [], has_more: false, next_cursor: null })
  })

  test('a signal type added later is named, not refused', async () => {
    mockApi(() => ({ body: { signals: [signal({ type: 'remote_shift', details: { share: 0.4 } })], has_more: false } }))
    const page = await list({ domains: 'stripe.com' })
    expect(page.signals[0]).toMatchObject({ type: 'remote_shift', type_label: 'Remote shift', summary: 'Remote shift' })
  })

  test.each([
    [{ industries: 'Software, Internet' }, /"Software, Internet" cannot be used in Industries/],
    [{ funding_stages: ['Series A, B'] }, /cannot be used in Funding Stages/],
    [{ types: ['surge'] }, /Signal Types does not take "surge"/],
    [{ seniority: ['intern'] }, /Seniority does not take "intern"/],
    [{ min_strength: 150 }, /Minimum Strength must be a whole number from 1 to 100/],
    [{ founded_after: 1700 }, /Founded In or After must be a whole number from 1800 to 2100/],
    [{ detected_after: 'last week' }, /Detected On or After must be a date/],
    [{ created_after: '12/11/2026' }, /Created After must be a date and time/],
    [{ domains: Array.from({ length: 101 }, (_, index) => `d${index}.example`) }, /Company Domains takes at most 100 values/],
  ])('refuses %j before any request', async (props, message) => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    await expect(list(props)).rejects.toThrow(message)
    expect(requests).toHaveLength(0)
  })

  test('a date-only Created After is sent as midnight UTC', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    await list({ created_after: '2026-11-12' })
    expect(requests[0].query.get('created_after')).toBe('2026-11-12T00:00:00Z')
  })

  test('402 names the signal price and the top-up link, and is not retried', async () => {
    const { requests } = mockApi(() => ({
      status: 402,
      body: { code: 'insufficient_credits', detail: 'This request needs 300 credits.', top_up_url: 'https://enterprise.jobo.world/credits?topup=10' },
    }))
    await expect(list({ domains: 'stripe.com' })).rejects.toThrow(/HTTP 402.*300 credits.*ten times the price of a job.*topup=10/)
    expect(requests).toHaveLength(1)
  })

  test('403 account_key_required asks for an account key', async () => {
    mockApi(() => ({ status: 403, body: { code: 'account_key_required', title: 'Account API key required' } }))
    await expect(list({ domains: 'stripe.com' })).rejects.toThrow(/account API key \(HTTP 403\).*api-keys/)
  })

  test('a sandbox key is told signals need a live key', async () => {
    mockApi(() => ({ status: 404, body: { code: 'not_available_in_sandbox', detail: 'x' } }))
    await expect(list({ domains: 'stripe.com' }, FAKE_SANDBOX_KEY)).rejects.toThrow(/Hiring signals need a live Jobo API key/)
  })

  test('429 reports the wait and is not retried', async () => {
    const { requests } = mockApi(() => ({ status: 429, body: { retry_after_seconds: 12 } }))
    await expect(list({ domains: 'stripe.com' })).rejects.toThrow(/HTTP 429.*12 seconds/)
    expect(requests).toHaveLength(1)
  })

  test('a 500, a 503 and a lost connection are not retried, because the signals may have been billed', async () => {
    const { requests } = mockApi(() => ({ status: 500, body: { detail: 'boom' } }))
    await expect(list({ domains: 'stripe.com' })).rejects.toThrow(/HTTP 500.*not retried/)
    expect(requests).toHaveLength(1)
    vi.restoreAllMocks()
    const busy = mockApi(() => ({ status: 503, body: { detail: 'busy' }, headers: { 'Retry-After': '5' } }))
    await expect(list({ domains: 'stripe.com' })).rejects.toThrow(/HTTP 503.*not retried/)
    expect(busy.requests).toHaveLength(1)
    vi.restoreAllMocks()
    const spy = vi.spyOn(httpClient, 'sendRequest').mockRejectedValue(new Error('socket hang up'))
    await expect(list({ domains: 'stripe.com' })).rejects.toThrow(/Could not reach the Jobo API: socket hang up.*not retried/)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('refuses a malformed key before any request', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(list({ domains: 'stripe.com' }, 'nope')).rejects.toThrow(/does not look like a Jobo API key/)
    expect(requests).toHaveLength(0)
  })

  test('says in its description and limit what is billed', () => {
    expect(listHiringSignals.description).toMatch(/billed at ten times the price of a job/)
    expect(listHiringSignals.props['limit'].description).toMatch(/Every signal returned is billed at ten times the price of a job/)
    expect(listCompanyHiringSignals.description).toMatch(/billed at ten times the price of a job/)
  })
})

describe('List Company Hiring Signals', () => {
  test('sends one GET /api/companies/{id}/signals with only the filters that endpoint takes', async () => {
    const { requests } = mockApi(() => ({ body: { signals: [signal()], has_more: false } }))
    const page = await listCompany({
      company_id: ` ${COMPANY_ID.toUpperCase()} `,
      types: ['leadership_hire'],
      min_strength: 50,
      detected_after: '2026-11-01',
      detected_before: '2026-11-20',
      created_after: '2026-11-12T09:30:00Z',
      limit: 3,
      cursor: 'cur_1',
      domains: 'ignored.example',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].path).toBe(`/api/companies/${COMPANY_ID}/signals`)
    expect(queryOf(requests[0])).toEqual({
      types: 'leadership_hire',
      min_strength: '50',
      detected_after: '2026-11-01',
      detected_before: '2026-11-20',
      created_after: '2026-11-12T09:30:00Z',
      limit: '3',
      cursor: 'cur_1',
    })
    expect(page.signals[0]).toMatchObject({ company_id: COMPANY_ID, summary: '17 new jobs this week vs 3.1 a week normally' })
  })

  test.each(['', 'acme', '../../api/keys', `${COMPANY_ID}x`])('refuses the company ID %j before any request', async (id) => {
    const { requests } = mockApi(() => ({ body: { signals: [], has_more: false } }))
    await expect(listCompany({ company_id: id })).rejects.toThrow(/is not a Jobo company ID/)
    expect(requests).toHaveLength(0)
  })

  test('offers only the filters the per-company endpoint takes', () => {
    expect(Object.keys(listCompanyHiringSignals.props)).toEqual([
      'company_id', 'types', 'min_strength', 'detected_after', 'detected_before', 'created_after', 'limit', 'cursor',
    ])
  })
})

describe('signals contract', () => {
  const CONTRACT = {
    signal_types: [
      'hiring_surge', 'new_function', 'new_country', 'leadership_hire', 'new_skill', 'hiring_slowdown', 'first_role',
      'new_technology', 'function_surge', 'new_city', 'hard_to_fill', 'leadership_role_closed', 'hiring_freeze', 'hiring_resumed',
    ],
    seniority: ['junior', 'mid', 'senior', 'director', 'vp', 'c_level', 'executive'],
    company_sizes: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'],
    type_labels: {
      hiring_surge: 'Hiring surge',
      new_function: 'New function',
      new_country: 'New country',
      leadership_hire: 'Leadership hire',
      new_skill: 'New skill',
      hiring_slowdown: 'Hiring slowdown',
      first_role: 'First role',
      new_technology: 'New technology',
      function_surge: 'Function surge',
      new_city: 'New city',
      hard_to_fill: 'Hard to fill',
      leadership_role_closed: 'Leadership role closed',
      hiring_freeze: 'Hiring freeze',
      hiring_resumed: 'Hiring resumed',
    },
    filters: [
      ['types', 'enumList'], ['domains', 'stringList'], ['company_ids', 'stringList'], ['exclude_domains', 'stringList'],
      ['countries', 'stringList'], ['company_sizes', 'enumList'], ['industries', 'stringList'], ['categories', 'stringList'],
      ['funding_stages', 'stringList'], ['founded_after', 'number'], ['exclude_agencies', 'boolean'], ['functions', 'stringList'],
      ['roles', 'stringList'], ['seniority', 'enumList'], ['technologies', 'stringList'], ['skills', 'stringList'],
      ['technology_categories', 'stringList'], ['job_countries', 'stringList'], ['job_regions', 'stringList'],
      ['job_cities', 'stringList'], ['min_strength', 'number'], ['min_new_jobs', 'number'], ['min_days_open', 'number'],
      ['reposted_only', 'boolean'], ['detected_after', 'date'], ['detected_before', 'date'], ['created_after', 'dateTime'],
    ],
    bounds: { founded_after: [1800, 2100], min_strength: [1, 100], min_new_jobs: [1, 10000], min_days_open: [1, 365] },
    company_filter_keys: ['types', 'min_strength', 'detected_after', 'detected_before', 'created_after'],
    max_limit: 200,
    max_list_values: 100,
  }

  test('the local type, seniority and size lists and the type labels are the contract values', () => {
    expect([...joboSignals.SIGNAL_TYPES]).toEqual(CONTRACT.signal_types)
    expect([...joboSignals.SIGNAL_SENIORITY]).toEqual(CONTRACT.seniority)
    expect([...joboSignals.SIGNAL_COMPANY_SIZES]).toEqual(CONTRACT.company_sizes)
    expect(Object.entries(joboSignals.SIGNAL_TYPE_LABELS)).toEqual(Object.entries(CONTRACT.type_labels))
  })

  test('the local filter list has the contract keys, kinds, options and bounds', () => {
    expect(joboSignals.SIGNAL_FILTERS.map((filter) => [filter.key, filter.kind])).toEqual(CONTRACT.filters)
    const byKey = Object.fromEntries(joboSignals.SIGNAL_FILTERS.map((filter) => [filter.key, filter]))
    expect(byKey['types']?.options).toEqual(CONTRACT.signal_types)
    expect(byKey['seniority']?.options).toEqual(CONTRACT.seniority)
    expect(byKey['company_sizes']?.options).toEqual(CONTRACT.company_sizes)
    for (const [key, [min, max]] of Object.entries(CONTRACT.bounds)) {
      expect([byKey[key]?.min, byKey[key]?.max]).toEqual([min, max])
    }
    expect([...joboSignals.COMPANY_SIGNAL_FILTER_KEYS]).toEqual(CONTRACT.company_filter_keys)
    expect(joboSignals.MAX_LIMIT).toBeLessThanOrEqual(CONTRACT.max_limit)
    expect(joboSignals.MAX_LIST_VALUES).toBe(CONTRACT.max_list_values)
  })

  test('List Hiring Signals offers every contract filter, and the closed lists offer the contract values', () => {
    const props = listHiringSignals.props
    expect(Object.keys(props)).toEqual([...CONTRACT.filters.map(([key]) => key), 'limit', 'cursor'])
    expect(props['types'].type).toBe('STATIC_MULTI_SELECT_DROPDOWN')
    expect(props['seniority'].type).toBe('STATIC_MULTI_SELECT_DROPDOWN')
    expect(props['company_sizes'].type).toBe('STATIC_MULTI_SELECT_DROPDOWN')
    expect(props['created_after'].type).toBe('DATE_TIME')
  })

  test('every filter of the contract reaches the query', () => {
    const sample: Record<string, unknown> = {
      enumList: undefined,
      stringList: 'sample',
      number: undefined,
      boolean: true,
      date: '2026-11-01',
      dateTime: '2026-11-01T00:00:00Z',
    }
    for (const filter of joboSignals.SIGNAL_FILTERS) {
      const value = filter.kind === 'enumList' ? [filter.options?.[0]] : filter.kind === 'number' ? filter.min : sample[filter.kind]
      const query = joboSignals.toSignalsQuery({ values: { [filter.key]: value }, keys: joboSignals.ALL_SIGNAL_FILTER_KEYS })
      expect(Object.keys(query)).toEqual([filter.key])
    }
  })
})

describe('signal summary', () => {
  test.each([
    ['hiring_surge', { new_jobs: 17, baseline_weekly_avg: 3.1 }, '17 new jobs this week vs 3.1 a week normally'],
    ['hiring_surge', { new_jobs: 1, baseline_weekly_avg: 0.04 }, '1 new job this week vs 0 a week normally'],
    ['hiring_surge', { new_jobs: 1200, baseline_weekly_avg: 1050.25 }, '1,200 new jobs this week vs 1,050.3 a week normally'],
    [
      'hiring_slowdown',
      { open_roles: 40, open_roles_before: 90, change_pct: -55.6, compared_to: '2026-09-21' },
      'Open roles down 55.6% since 2026-09-21: 40 now, 90 then',
    ],
    ['new_function', { category: 'Sales', new_jobs: 4, lookback_days: 180 }, '4 new jobs in Sales, a first in six months'],
    ['new_function', { category: 'Sales', lookback_days: 90 }, 'First Sales job in 3 months'],
    ['new_country', { country: 'Germany', new_jobs: 1 }, 'First job in Germany in six months'],
    ['new_country', { country: 'Germany', new_jobs: 3, lookback_days: 45 }, '3 new jobs in Germany, a first in 45 days'],
    ['new_skill', { skill: 'Rust', new_jobs: 5 }, '5 new jobs ask for Rust, a first in six months'],
    ['new_skill', { skill: 'Rust', named: true }, 'First job asking for Rust in six months'],
    ['leadership_hire', { title: 'VP of Engineering' }, 'Hiring a leader: VP of Engineering'],
    ['first_role', { occupation: 'Data Engineer' }, 'First Data Engineer role'],
    ['new_technology', { technology: 'Snowflake', title: 'Data Engineer' }, 'First mention of Snowflake, in a Data Engineer role'],
    ['new_technology', { technology: 'Snowflake' }, 'First mention of Snowflake'],
    ['function_surge', { category: 'Technology', new_jobs: 12, baseline_avg: 2.5, window_days: 14 }, '12 new Technology jobs in 14 days vs 2.5 normally'],
    ['function_surge', { category: 'Technology', new_jobs: 1, baseline_avg: 0.2 }, '1 new Technology job in two weeks vs 0.2 normally'],
    ['new_city', { city: 'Austin', region: 'Texas', new_jobs: 6 }, '6 new jobs in Austin, Texas, a first there'],
    ['new_city', { city: 'Austin' }, 'First job in Austin'],
    ['hard_to_fill', { title: 'Staff Nurse', days_open: 92, city: 'Leeds' }, 'Staff Nurse (Leeds) open 92 days'],
    ['hard_to_fill', { title: 'Staff Nurse', days_open: 30, reason: 'reposted', closed_days: 1 }, 'Staff Nurse re-posted after 1 day closed'],
    ['hard_to_fill', { title: 'Staff Nurse', days_open: 30, reason: 'reposted' }, 'Staff Nurse re-posted'],
    ['leadership_role_closed', { title: 'Chief Financial Officer', days_open: 61 }, 'Chief Financial Officer search closed after 61 days'],
    ['hiring_freeze', { closed_jobs: 45, open_roles_before: 52, closed_to: '2026-11-15' }, '45 of 52 open roles removed in the week to 2026-11-15'],
    ['hiring_resumed', { gap_days: 74 }, 'First new job in 74 days'],
  ])('%s %j', (type, details, sentence) => {
    expect(joboSignalSummary.describeSignal({ type, details })).toBe(sentence)
  })

  test('falls back to the label when the facts are missing, and names an unknown type', () => {
    expect(joboSignalSummary.describeSignal({ type: 'hiring_surge', details: { new_jobs: 17 } })).toBe('Hiring surge')
    expect(joboSignalSummary.describeSignal({ type: 'new_city', details: null })).toBe('New city')
    expect(joboSignalSummary.describeSignal({ type: 'remote_shift', details: { share: 0.4 } })).toBe('Remote shift')
    expect(joboSignalSummary.signalTypeLabel('')).toBe('Signal')
  })

  test('missing signal fields become null, never undefined', () => {
    const flat = joboOutput.flattenSignal({ id: 's1', type: 'leadership_hire' })
    expect(Object.values(flat)).not.toContain(undefined)
    expect(flat).toMatchObject({ id: 's1', company_name: null, evidence_job_ids: [], details: {}, summary: 'Leadership hire' })
  })
})
