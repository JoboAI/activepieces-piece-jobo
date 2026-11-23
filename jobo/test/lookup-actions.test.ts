import { afterEach, describe, expect, test, vi } from 'vitest'
import { findCompany } from '../src/lib/actions/find-company'
import { geocodeLocation } from '../src/lib/actions/geocode-location'
import { getJob } from '../src/lib/actions/get-job'
import { actionContext } from './helpers/contexts'
import { FREE_PATHS, job, mockApi } from './helpers/mock-api'

afterEach(() => vi.restoreAllMocks())

describe('Get Job by ID', () => {
  const run = (props: Record<string, unknown>) => getJob.run(actionContext(props) as never)

  test('calls the free single-job endpoint with an encoded id and flattens the job', async () => {
    const { requests } = mockApi(() => ({ body: job({ id: 'a/b c' }) }))
    const result = await run({ job_id: ' a/b c ' })
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url).toBe('https://connect.jobo.world/api/jobs/a%2Fb%20c')
    expect(FREE_PATHS.some((pattern) => pattern.test(requests[0].path))).toBe(true)
    expect(result).toMatchObject({ id: 'a/b c', title: 'Backend Engineer', salary_currency: 'EUR' })
  })

  test('an unknown id is a clear error, not an empty result', async () => {
    mockApi(() => ({ status: 404, body: { title: 'Not Found', detail: 'job missing' } }))
    await expect(run({ job_id: 'gone' })).rejects.toThrow(/No job was found with the ID "gone"/)
  })

  test('a blank id makes no request', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(run({ job_id: '   ' })).rejects.toThrow(/Enter the ID/)
    expect(requests).toHaveLength(0)
  })

  test('maps 401 and 429', async () => {
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    await expect(run({ job_id: 'x' })).rejects.toThrow(/HTTP 401/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 429, body: { retry_after_seconds: 9 } }))
    await expect(run({ job_id: 'x' })).rejects.toThrow(/9 seconds/)
  })
})

describe('Find Company', () => {
  const run = (props: Record<string, unknown>) => findCompany.run(actionContext(props) as never)

  test('calls the free suggest endpoint with q and limit and flattens each company', async () => {
    const { requests } = mockApi(() => ({
      body: { suggestions: [{ id: 'c1', ids: ['c1', 'c2'], name: 'Acme', domain: 'acme.example', logo_url: null, country: 'DE', job_count: 12 }] },
    }))
    const result = await run({ query: ' acme ', limit: 3 })
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe('/api/connectors/companies/suggest')
    expect(FREE_PATHS.some((pattern) => pattern.test(requests[0].path))).toBe(true)
    expect(requests[0].query.get('q')).toBe('acme')
    expect(requests[0].query.get('limit')).toBe('3')
    expect(result).toEqual([{ id: 'c1', name: 'Acme', domain: 'acme.example', logo_url: null, country: 'DE', job_count: 12, company_ids: 'c1,c2' }])
  })

  test('uses 8 by default, caps at 20, and rejects a one-letter query without a request', async () => {
    const { requests } = mockApi(() => ({ body: { suggestions: [] } }))
    await run({ query: 'ac' })
    await run({ query: 'ac', limit: 500 })
    expect(requests.map((request) => request.query.get('limit'))).toEqual(['8', '20'])
    await expect(run({ query: 'a' })).rejects.toThrow(/at least 2 characters/)
    expect(requests).toHaveLength(2)
  })

  test('maps 401 and 429', async () => {
    mockApi(() => ({ status: 429, body: { retry_after_seconds: 1 } }))
    await expect(run({ query: 'acme' })).rejects.toThrow(/HTTP 429/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 401, body: {} }))
    await expect(run({ query: 'acme' })).rejects.toThrow(/HTTP 401/)
  })
})

describe('Geocode Location', () => {
  const run = (props: Record<string, unknown>) => geocodeLocation.run(actionContext(props) as never)

  test('calls the geocode endpoint once and flattens the places', async () => {
    const { requests } = mockApi(() => ({
      body: { input: 'SF', succeeded: true, locations: [{ city: 'San Francisco', region: 'California', country: 'United States', display_name: 'San Francisco, California, United States', country_code: 'US', latitude: 37.77, longitude: -122.42 }] },
    }))
    const result = await run({ location: ' San Francisco, CA ' })
    expect(requests).toHaveLength(1)
    expect(requests[0].path).toBe('/api/locations/geocode')
    expect(requests[0].query.get('location')).toBe('San Francisco, CA')
    expect(result).toEqual([
      expect.objectContaining({ id: 'San Francisco, California, United States', city: 'San Francisco', country_code: 'US', latitude: 37.77, input: 'San Francisco, CA' }),
    ])
  })

  test('a place that cannot be resolved is an empty list', async () => {
    mockApi(() => ({ body: { input: 'zzzz', succeeded: false, locations: [], error: 'no match' } }))
    expect(await run({ location: 'zzzz' })).toEqual([])
  })

  test('a blank location makes no request', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(run({ location: '' })).rejects.toThrow(/Enter a place/)
    expect(requests).toHaveLength(0)
  })

  test('maps 402 for the flat-rate endpoint, 401 and 429', async () => {
    mockApi(() => ({ status: 402, body: { error: 'Insufficient credits', detail: 'Need 1 credit.' } }))
    await expect(run({ location: 'Berlin' })).rejects.toThrow(/HTTP 402/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 401, body: {} }))
    await expect(run({ location: 'Berlin' })).rejects.toThrow(/HTTP 401/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 429, body: { retry_after_seconds: 2 } }))
    await expect(run({ location: 'Berlin' })).rejects.toThrow(/2 seconds/)
  })

  test('says it is billed, and the free lookups say they are free', () => {
    expect(geocodeLocation.description).toMatch(/billed/)
    expect(geocodeLocation.props['location'].description).toMatch(/billed/)
    expect(findCompany.description).toMatch(/free/)
    expect(getJob.description).toMatch(/free/)
  })
})
