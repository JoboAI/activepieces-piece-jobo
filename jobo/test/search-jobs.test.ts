import { afterEach, describe, expect, test, vi } from 'vitest'
import { searchJobs } from '../src/lib/actions/search-jobs'
import { actionContext } from './helpers/contexts'
import { FAKE_KEY, job, mockApi } from './helpers/mock-api'

afterEach(() => vi.restoreAllMocks())

const run = async (props: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
  const result = await searchJobs.run(actionContext(props) as never)
  return Array.isArray(result) ? result : []
}

describe('Search Jobs', () => {
  test('refuses to run without any filter and makes no request', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(run({ limit: 10, sort: 'relevance', search_description: true })).rejects.toThrow(/at least one filter/)
    expect(requests).toHaveLength(0)
  })

  test('sends one POST /api/jobs/search with the mapped body and no facets', async () => {
    const { requests } = mockApi(() => ({ body: { jobs: [job()], total: 1, page: 2, page_size: 5, total_pages: 1, facets: {} } }))
    const result = await run({
      q: ' data engineer ',
      location: 'Berlin, Germany',
      companies: ['id-1,id-2', 'stripe.com'],
      exclude_companies: ['id-9'],
      sources: ['greenhouse'],
      skills: ['Python'],
      work_model: ['remote'],
      employment_type: ['full-time'],
      industries: ['Software Development, SaaS'],
      min_salary_usd: 90000,
      posted_after: '2026-11-01T00:00:00Z',
      sort: 'discovered_desc',
      search_description: false,
      limit: 5,
      page: 2,
    })

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://connect.jobo.world/api/jobs/search')
    expect(request.headers['X-Api-Key']).toBe(FAKE_KEY)
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.body).toEqual({
      queries: ['data engineer'],
      search_description: false,
      locations: ['Berlin, Germany'],
      sources: ['greenhouse'],
      skills: { include: ['Python'] },
      companies: { include: ['id-1', 'id-2', 'stripe.com'], exclude: ['id-9'] },
      industries: { include: ['Software Development, SaaS'] },
      work_models: ['remote'],
      employment_types: ['full-time'],
      salary_usd: { min: 90000 },
      posted_after: '2026-11-01T00:00:00Z',
      sort: 'discovered_desc',
      page: 2,
      page_size: 5,
      include_facets: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'job-1', title: 'Backend Engineer', company_name: 'Acme', city: 'Berlin', required_skills: 'Go' })
  })

  test('defaults to 10 jobs on page 1 and caps Maximum Jobs at 100', async () => {
    const { requests } = mockApi(() => ({ body: { jobs: [] } }))
    await run({ q: 'nurse' })
    await run({ q: 'nurse', limit: 5000 })
    await run({ q: 'nurse', limit: 0 })
    expect(requests.map((request) => (request.body as { page_size: number; page: number }).page_size)).toEqual([10, 100, 10])
    expect(requests.map((request) => (request.body as { page: number }).page)).toEqual([1, 1, 1])
  })

  test('returns an empty list for no results', async () => {
    mockApi(() => ({ body: { jobs: [], total: 0 } }))
    expect(await run({ q: 'nothing matches this' })).toEqual([])
  })

  test('maps 402 with the top-up link', async () => {
    mockApi(() => ({ status: 402, body: { error: 'Insufficient credits', detail: 'Need 75 credits.', top_up_url: 'https://enterprise.jobo.world/credits?topup=10' } }))
    await expect(run({ q: 'x' })).rejects.toThrow(/HTTP 402.*topup=10/)
  })

  test('maps 429 and 401', async () => {
    mockApi(() => ({ status: 429, body: { retry_after_seconds: 3 } }))
    await expect(run({ q: 'x' })).rejects.toThrow(/HTTP 429.*3 seconds/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    await expect(run({ q: 'x' })).rejects.toThrow(/HTTP 401/)
  })

  test('says in its description what is billed', () => {
    expect(searchJobs.description).toMatch(/billed/)
    expect(searchJobs.props['limit'].description).toMatch(/Every job returned is billed/)
  })
})
