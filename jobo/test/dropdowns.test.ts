import type { PropertyContext } from '@activepieces/pieces-framework'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { joboProps } from '../src/lib/common/props'
import { authValue, FREE_PATHS, mockApi } from './helpers/mock-api'

afterEach(() => vi.restoreAllMocks())

type Options = (values: Record<string, unknown>, context: PropertyContext) => Promise<{
  disabled?: boolean
  placeholder?: string
  options: { label: string; value: unknown }[]
}>

const load = (property: unknown, values: Record<string, unknown> = {}, searchValue?: string) => {
  const options = (property as { options: Options }).options
  return options({ auth: authValue(), ...values }, { searchValue } as PropertyContext)
}

const taxonomy = {
  version: '1',
  categories: [
    {
      name: 'Healthcare',
      subcategories: [
        { name: 'Nursing', occupations: [{ id: 'esco:nurse', name: 'Registered nurse' }, { id: 'jobo:icu-nurse', name: 'ICU nurse' }] },
        { name: 'Dentistry', occupations: [{ id: 'esco:dentist', name: 'Dentist' }] },
      ],
    },
    { name: 'Technology', subcategories: [{ name: 'Software', occupations: [{ id: 'jobo:backend-developer', name: 'Backend developer' }] }] },
  ],
}

describe('dropdowns use only free lookup endpoints', () => {
  test('every loader hits a free path', async () => {
    const { requests } = mockApi((request) => {
      if (request.path === '/api/occupations') return { body: taxonomy }
      if (request.path.includes('suggest/') || request.path === '/api/connectors/companies/suggest') return { body: { suggestions: [] } }
      if (request.path === '/api/connectors/locations/suggest') return { body: { suggestions: [] } }
      if (request.path.startsWith('/api/connectors/filter-options')) return { body: { facet: 'x', options: [] } }
      return { body: { enums: {}, sources: [] } }
    })
    await load(joboProps.sources)
    await load(joboProps.industries)
    await load(joboProps.skills, {}, 'py')
    await load(joboProps.companies, {}, 'acme')
    await load(joboProps.searchLocation, {}, 'ber')
    await load(joboProps.triggerLocation, {}, 'ber')
    await load(joboProps.jobCategories)
    await load(joboProps.jobSubcategories)
    await load(joboProps.occupationIds)
    expect(requests.length).toBeGreaterThanOrEqual(9)
    for (const request of requests) {
      expect(request.method).toBe('GET')
      expect(FREE_PATHS.some((pattern) => pattern.test(request.path))).toBe(true)
    }
  })
})

describe('dropdown options', () => {
  test('are disabled without a connection', async () => {
    const options = (joboProps.sources as unknown as { options: Options }).options
    const state = await options({}, {} as PropertyContext)
    expect(state.disabled).toBe(true)
    expect(state.placeholder).toMatch(/Connect your Jobo account/)
  })

  test('sources come from the live filters endpoint, labelled by name', async () => {
    mockApi(() => ({ body: { enums: {}, sources: [{ key: 'lever_co', name: 'Lever', count: 5 }, { key: 'ashby', count: 3 }] } }))
    const state = await load(joboProps.sources)
    expect(state.options).toEqual([
      { label: 'ashby', value: 'ashby' },
      { label: 'Lever', value: 'lever_co' },
    ])
  })

  test('skills search passes q and the 250 limit', async () => {
    const { requests } = mockApi(() => ({ body: { facet: 'skills', options: [{ key: 'Python', count: 9 }] } }))
    const state = await load(joboProps.skills, {}, 'py')
    expect(requests[0].path).toBe('/api/connectors/filter-options/skills')
    expect(requests[0].query.get('q')).toBe('py')
    expect(requests[0].query.get('limit')).toBe('250')
    expect(state.options).toEqual([{ label: 'Python', value: 'Python' }])
  })

  test('company search needs 2 letters and gives the picked company every board id', async () => {
    const { requests } = mockApi(() => ({
      body: { suggestions: [{ id: 'c1', ids: ['c1', 'c2'], name: 'Acme', domain: 'acme.example', country: 'DE', logo_url: null, job_count: 1 }] },
    }))
    const short = await load(joboProps.companies, {}, 'a')
    expect(short.options).toEqual([])
    expect(short.placeholder).toMatch(/at least 2 letters/)
    expect(requests).toHaveLength(0)

    const state = await load(joboProps.companies, {}, 'ac')
    expect(requests[0].query.get('q')).toBe('ac')
    expect(state.options).toEqual([{ label: 'Acme (acme.example, DE)', value: 'c1\nc2' }])
  })

  test('search location gives place labels and trigger location gives structured places, skipping places without a country', async () => {
    mockApi(() => ({
      body: {
        suggestions: [
          { city: 'Berlin', region: 'Berlin', country: 'Germany', display_name: 'Berlin, Germany' },
          { city: null, region: null, country: null, display_name: 'Nowhere' },
        ],
      },
    }))
    const labels = await load(joboProps.searchLocation, {}, 'ber')
    expect(labels.options).toEqual([
      { label: 'Berlin, Germany', value: 'Berlin, Germany' },
      { label: 'Nowhere', value: 'Nowhere' },
    ])
    const places = await load(joboProps.triggerLocation, {}, 'ber')
    expect(places.options).toEqual([{ label: 'Berlin, Germany', value: { country: 'Germany', region: 'Berlin', city: 'Berlin' } }])
  })

  test('occupation taxonomy drives dependent category, subcategory and occupation lists', async () => {
    mockApi(() => ({ body: taxonomy }))
    expect((await load(joboProps.jobCategories)).options.map((option) => option.value)).toEqual(['Healthcare', 'Technology'])
    expect((await load(joboProps.jobSubcategories, { job_categories: ['Healthcare'] })).options.map((option) => option.value)).toEqual([
      'Dentistry',
      'Nursing',
    ])
    expect((await load(joboProps.occupationIds, { job_categories: ['Healthcare'], job_subcategories: ['Nursing'] })).options.map((option) => option.value)).toEqual([
      'jobo:icu-nurse',
      'esco:nurse',
    ])
    expect((await load(joboProps.occupationIds, {}, 'dent')).options.map((option) => option.value)).toEqual(['esco:dentist'])
  })

  test('an unpublished taxonomy (404) gives an empty list, not an error', async () => {
    mockApi(() => ({ status: 404, body: { title: 'Not Found' } }))
    const state = await load(joboProps.jobCategories)
    expect(state.disabled).toBe(false)
    expect(state.options).toEqual([])
  })

  test('a failing lookup disables the field with the reason and no key', async () => {
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    const state = await load(joboProps.sources)
    expect(state.disabled).toBe(true)
    expect(state.placeholder).toMatch(/HTTP 401/)
    expect(JSON.stringify(state)).not.toMatch(/jbe_live_/)
  })
})
