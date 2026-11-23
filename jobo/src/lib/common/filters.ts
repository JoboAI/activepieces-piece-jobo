import {
  assertHasNarrowingFilter,
  toList,
  type IncludeExclude,
  type JobFeedParams,
  type JobSearchFilters,
} from '@jobo-ai/connector-core'
import { joboConstants } from './constants'

function readSearchFilters(values: Values): JobSearchFilters {
  return {
    q: readText({ values, key: 'q' }),
    search_description: readBoolean({ values, key: 'search_description' }),
    location: readText({ values, key: 'location' }),
    sources: toList(values['sources']),
    companies: readIds({ values, key: 'companies' }),
    exclude_companies: readIds({ values, key: 'exclude_companies' }),
    work_model: toList(values['work_model']),
    employment_type: toList(values['employment_type']),
    experience_level: toList(values['experience_level']),
    language: toList(values['language']),
    skills: toList(values['skills']),
    exclude_skills: toList(values['exclude_skills']),
    industries: toList(values['industries']),
    exclude_industries: toList(values['exclude_industries']),
    company_categories: toList(values['company_categories']),
    exclude_company_categories: toList(values['exclude_company_categories']),
    job_categories: toList(values['job_categories']),
    exclude_job_categories: toList(values['exclude_job_categories']),
    job_subcategories: toList(values['job_subcategories']),
    exclude_job_subcategories: toList(values['exclude_job_subcategories']),
    occupation_ids: toList(values['occupation_ids']),
    exclude_occupation_ids: toList(values['exclude_occupation_ids']),
    min_salary_usd: readNumber({ values, key: 'min_salary_usd' }),
    max_salary_usd: readNumber({ values, key: 'max_salary_usd' }),
    posted_after: readText({ values, key: 'posted_after' }),
    posted_before: readText({ values, key: 'posted_before' }),
    sort: readSort(values['sort']),
    description_format: readDescriptionFormat(values['description_format']),
  }
}

function toFeedBody(values: Values): JobFeedParams {
  const body: JobFeedParams = {}

  const places = readPlaces(values['location'])
  if (places.length > 0) body.locations = places

  const sources = toList(values['sources'])
  if (sources) body.sources = sources
  const workModels = toList(values['work_model'])
  if (workModels) body.work_models = workModels
  const employmentTypes = toList(values['employment_type'])
  if (employmentTypes) body.employment_types = employmentTypes
  const experienceLevels = toList(values['experience_level'])
  if (experienceLevels) body.experience_levels = experienceLevels
  const languages = toList(values['language'])
  if (languages) body.languages = languages

  const companies = pair({ include: readIds({ values, key: 'companies' }), exclude: readIds({ values, key: 'exclude_companies' }) })
  if (companies) body.companies = companies
  const industries = pair({ include: toList(values['industries']), exclude: toList(values['exclude_industries']) })
  if (industries) body.industries = industries
  const companyCategories = pair({
    include: toList(values['company_categories']),
    exclude: toList(values['exclude_company_categories']),
  })
  if (companyCategories) body.company_categories = companyCategories
  const jobCategories = pair({ include: toList(values['job_categories']), exclude: toList(values['exclude_job_categories']) })
  if (jobCategories) body.job_categories = jobCategories
  const jobSubcategories = pair({
    include: toList(values['job_subcategories']),
    exclude: toList(values['exclude_job_subcategories']),
  })
  if (jobSubcategories) body.job_subcategories = jobSubcategories
  const occupationIds = pair({ include: toList(values['occupation_ids']), exclude: toList(values['exclude_occupation_ids']) })
  if (occupationIds) body.occupation_ids = occupationIds

  const format = readDescriptionFormat(values['description_format'])
  if (format && format !== 'markdown') body.description_format = format

  return body
}

function readPlaces(value: unknown): Place[] {
  const entries = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]
  return entries.map(parsePlace)
}

function parsePlace(value: unknown): Place {
  const object = typeof value === 'string' ? parseJsonObject(value) : isRecord(value) ? value : {}
  const country = trimmed(object['country'])
  if (!country) {
    throw new Error(
      `${JSON.stringify(value)} is not a place the New Job trigger can filter on. Pick it from the Locations list, ` +
        'or map an object such as {"city":"Berlin","country":"Germany"}. The country is required.',
    )
  }
  const region = trimmed(object['region'])
  const city = trimmed(object['city'])
  return { country, ...(region ? { region } : {}), ...(city ? { city } : {}) }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  }
  catch {
    return {}
  }
}

function requireNarrowingFilter({ values, labels }: { values: Values, labels: string }): void {
  try {
    assertHasNarrowingFilter(values)
  }
  catch {
    throw new Error(
      `Set at least one of ${labels} before using this trigger. Without one it matches every job Jobo indexes, ` +
        'and every new job is billed.',
    )
  }
}

function requireAnyFilter({ values, keys }: { values: Values, keys: string[] }): void {
  const narrowed = keys.some((key) => hasValue(values[key]))
  if (!narrowed) {
    throw new Error(
      'Set at least one filter, such as Search Query, Location or Companies, before searching. ' +
        'An unfiltered search returns, and bills, the first page of every job in the index.',
    )
  }
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

function readPageSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed) || parsed < 1) return joboConstants.SEARCH_DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(parsed), joboConstants.SEARCH_MAX_PAGE_SIZE)
}

function readPage(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1
}

function readText({ values, key }: { values: Values, key: string }): string | undefined {
  return trimmed(values[key])
}

function readNumber({ values, key }: { values: Values, key: string }): number | undefined {
  const value = values[key]
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return value !== undefined && value !== null && value !== '' && Number.isFinite(parsed) ? parsed : undefined
}

function readBoolean({ values, key }: { values: Values, key: string }): boolean | undefined {
  const value = values[key]
  return typeof value === 'boolean' ? value : undefined
}

function readIds({ values, key }: { values: Values, key: string }): string[] | undefined {
  const value = values[key]
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const ids = entries
    .flatMap((entry) => String(entry).split(/[\n,]/))
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const unique = [...new Set(ids)]
  return unique.length > 0 ? unique : undefined
}

function readSort(value: unknown): JobSearchFilters['sort'] {
  return value === 'discovered_asc' || value === 'discovered_desc' || value === 'relevance' ? value : undefined
}

function readDescriptionFormat(value: unknown): JobSearchFilters['description_format'] {
  return value === 'markdown' || value === 'html' || value === 'enhanced' || value === 'enhanced_html' ? value : undefined
}

function pair({ include, exclude }: { include: string[] | undefined, exclude: string[] | undefined }): IncludeExclude | undefined {
  if (!include && !exclude) return undefined
  return { ...(include ? { include } : {}), ...(exclude ? { exclude } : {}) }
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result === '' ? undefined : result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type Values = Record<string, unknown>

type Place = { country: string, region?: string, city?: string }

export const joboFilters = {
  readSearchFilters,
  toFeedBody,
  requireNarrowingFilter,
  requireAnyFilter,
  readPageSize,
  readPage,
}

export type { Place }
