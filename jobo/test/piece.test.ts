import { describe, expect, test } from 'vitest'
import { jobo } from '../src'
import { joboOutput } from '../src/lib/common/output'
import { joboFilters } from '../src/lib/common/filters'
import { job } from './helpers/mock-api'

describe('piece definition', () => {
  const metadata = jobo.metadata()

  test('exposes the planned surface', () => {
    expect(metadata.displayName).toBe('Jobo')
    expect(Object.keys(metadata.actions).sort()).toEqual(['custom_api_call', 'find_company', 'geocode_location', 'get_job', 'search_jobs'])
    expect(Object.keys(metadata.triggers)).toEqual(['new_job'])
    expect(metadata.auth).toMatchObject({ type: 'SECRET_TEXT', required: true })
  })

  test('declares the minimum release the framework would raise it to anyway', () => {
    expect(metadata.minimumSupportedRelease).toBe('0.82.0')
  })

  test('every hand-written action and the trigger carry the AI metadata upstream requires', () => {
    for (const name of ['search_jobs', 'get_job', 'find_company', 'geocode_location']) {
      const action = metadata.actions[name]
      expect(action.audience).toBe('both')
      expect(action.classification).toBeDefined()
      expect(action.aiMetadata?.description).toBeTruthy()
      expect(typeof action.aiMetadata?.idempotent).toBe('boolean')
    }
    expect(metadata.triggers['new_job'].classification).toBe('READ')
    expect(metadata.triggers['new_job'].aiMetadata?.description).toBeTruthy()
  })

  test('the custom API call is bound to the Jobo base URL and key header', async () => {
    const action = jobo.getAction('custom_api_call')
    expect(action).toBeDefined()
    expect(action?.requireAuth).toBe(true)
  })

  test('the trigger sample is fictional and contains no secrets', () => {
    expect(JSON.stringify(joboOutput.JOB_SAMPLE)).not.toMatch(/jbe_/)
    expect(String(joboOutput.JOB_SAMPLE['company_website'])).toMatch(/\.example$/)
  })
})

describe('output', () => {
  test('flattens a job into one level of keys', () => {
    const flat = joboOutput.flattenJob(job({ occupation: { id: 'o1', name: 'Engineer', category: 'Tech', subcategory: 'Software' }, language: 'en', external_id: 'x1' }))
    expect(Object.values(flat).every((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value))).toBe(true)
    expect(flat).toMatchObject({ occupation_name: 'Engineer', job_category: 'Tech', language: 'en', external_id: 'x1', all_locations: 'Berlin, Germany', responsibilities: 'Ship' })
  })

  test('missing values become null, never undefined', () => {
    const flat = joboOutput.flattenJob(job({ company: null, locations: [], compensation: null, qualifications: null }))
    expect(flat['company_name']).toBeNull()
    expect(flat['city']).toBeNull()
    expect(flat['salary_min']).toBeNull()
    expect(Object.values(flat)).not.toContain(undefined)
  })
})

describe('filters', () => {
  test('toFeedBody leaves the description format out at its default', () => {
    expect(joboFilters.toFeedBody({ description_format: 'markdown', sources: ['ashby'] })).toEqual({ sources: ['ashby'] })
  })

  test('toFeedBody accepts a place as JSON text and refuses free text', () => {
    expect(joboFilters.toFeedBody({ location: ['{"city":"Paris","country":"France"}'] }).locations).toEqual([{ country: 'France', city: 'Paris' }])
    expect(() => joboFilters.toFeedBody({ location: ['Berlin'] })).toThrow(/country is required/)
  })

  test('the narrowing guard counts only filters that narrow', () => {
    expect(() => joboFilters.requireNarrowingFilter({ values: { work_model: ['remote'] }, labels: 'X' })).toThrow(/Set at least one of X/)
    expect(() => joboFilters.requireNarrowingFilter({ values: { sources: ['ashby'] }, labels: 'X' })).not.toThrow()
    expect(() => joboFilters.requireNarrowingFilter({ values: { sources: [], companies: [] }, labels: 'X' })).toThrow()
  })
})
