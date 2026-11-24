const SIGNAL_TYPES = [
  'hiring_surge',
  'new_function',
  'new_country',
  'leadership_hire',
  'new_skill',
  'hiring_slowdown',
  'first_role',
  'new_technology',
  'function_surge',
  'new_city',
  'hard_to_fill',
  'leadership_role_closed',
  'hiring_freeze',
  'hiring_resumed',
] as const

const SIGNAL_SENIORITY = ['junior', 'mid', 'senior', 'director', 'vp', 'c_level', 'executive'] as const

const SIGNAL_COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'] as const

const SIGNAL_TYPE_LABELS: Readonly<Record<string, string>> = {
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
}

const SIGNAL_FILTERS: readonly SignalFilter[] = [
  {
    key: 'types',
    label: 'Signal Types',
    kind: 'enumList',
    description: 'Only these kinds of signal, such as Hiring surge, New country or Leadership hire. Leave empty for every kind.',
    options: SIGNAL_TYPES,
    company: true,
  },
  {
    key: 'domains',
    label: 'Company Domains',
    kind: 'stringList',
    description: 'Only signals at these companies, by website domain, such as stripe.com. At most 100.',
  },
  {
    key: 'company_ids',
    label: 'Company IDs',
    kind: 'stringList',
    description: 'Only signals at these companies, by Jobo company ID. At most 100.',
  },
  {
    key: 'exclude_domains',
    label: 'Exclude Company Domains',
    kind: 'stringList',
    description: 'Leave out these companies, by website domain, such as your existing customers. At most 100.',
  },
  {
    key: 'countries',
    label: 'Company Countries',
    kind: 'stringList',
    description: 'Countries the companies are headquartered in, as two-letter codes, such as US or DE.',
  },
  {
    key: 'company_sizes',
    label: 'Company Sizes',
    kind: 'enumList',
    description: 'Headcount bands of the companies.',
    options: SIGNAL_COMPANY_SIZES,
  },
  {
    key: 'industries',
    label: 'Industries',
    kind: 'stringList',
    description: 'Industries of the companies, matched against the primary industry and the industry list. A value cannot contain a comma.',
  },
  {
    key: 'categories',
    label: 'Company Categories',
    kind: 'stringList',
    description: 'Company categories, as returned in Company Categories, such as SaaS.',
  },
  {
    key: 'funding_stages',
    label: 'Funding Stages',
    kind: 'stringList',
    description: 'Latest funding round of the companies, as returned in Company Funding Stage, such as Seed or Series A.',
  },
  {
    key: 'founded_after',
    label: 'Founded In or After',
    kind: 'number',
    description: 'Only companies founded in this year or later.',
    min: 1800,
    max: 2100,
  },
  {
    key: 'exclude_agencies',
    label: 'Exclude Staffing Agencies',
    kind: 'boolean',
    description: "Leave out staffing agencies, whose postings are their clients' hiring.",
  },
  {
    key: 'functions',
    label: 'Functions',
    kind: 'stringList',
    description: 'Job categories the signal must be about, such as Technology or Sales. A focus filter.',
  },
  {
    key: 'roles',
    label: 'Roles',
    kind: 'stringList',
    description: 'Words or phrases to look for in the job title or occupation behind the signal, such as data engineer. At least 2 characters each. A focus filter.',
  },
  {
    key: 'seniority',
    label: 'Seniority',
    kind: 'enumList',
    description: 'Seniority of the role behind the signal. A focus filter.',
    options: SIGNAL_SENIORITY,
  },
  {
    key: 'technologies',
    label: 'Technologies',
    kind: 'stringList',
    description: 'Named tools the signal must be about, such as Snowflake. A focus filter, combined with skills and technology categories.',
  },
  {
    key: 'skills',
    label: 'Skills',
    kind: 'stringList',
    description: 'Named skills the signal must be about. A focus filter, combined with technologies.',
  },
  {
    key: 'technology_categories',
    label: 'Technology Categories',
    kind: 'stringList',
    description: "Every tool in a category, as returned in the technology_category of a signal's details, such as CRM. A focus filter.",
  },
  {
    key: 'job_countries',
    label: 'Job Countries',
    kind: 'stringList',
    description: "Countries the jobs are in (not the company's headquarters), as two-letter codes. A focus filter.",
  },
  {
    key: 'job_regions',
    label: 'Job Regions',
    kind: 'stringList',
    description: 'States, provinces or regions the jobs are in, such as Texas. A focus filter.',
  },
  {
    key: 'job_cities',
    label: 'Job Cities',
    kind: 'stringList',
    description: 'Cities the jobs are in, such as Austin. A focus filter; only New city and Hard to fill signals record a city.',
  },
  {
    key: 'min_strength',
    label: 'Minimum Strength',
    kind: 'number',
    description: 'Only signals at least this strong. Strength runs from 1 to 100 and compares signals of the same type.',
    min: 1,
    max: 100,
    company: true,
  },
  {
    key: 'min_new_jobs',
    label: 'Minimum New Jobs',
    kind: 'number',
    description: 'Only Hiring surge and Function surge signals of at least this many new jobs. Other types are not affected.',
    min: 1,
    max: 10000,
  },
  {
    key: 'min_days_open',
    label: 'Minimum Days Open',
    kind: 'number',
    description: 'Only Hard to fill signals for jobs open at least this many days. Other types are not affected.',
    min: 1,
    max: 365,
  },
  {
    key: 'reposted_only',
    label: 'Reposted Jobs Only',
    kind: 'boolean',
    description: 'Only Hard to fill signals for jobs posted again after closing. Other types are not affected.',
  },
  {
    key: 'detected_after',
    label: 'Detected On or After',
    kind: 'date',
    description: 'Earliest detection day, inclusive.',
    company: true,
  },
  {
    key: 'detected_before',
    label: 'Detected On or Before',
    kind: 'date',
    description: 'Latest detection day, inclusive.',
    company: true,
  },
  {
    key: 'created_after',
    label: 'Created After',
    kind: 'dateTime',
    description: 'Only signals first stored after this time, exclusive. To read what is new, map the newest Created At you already received.',
    company: true,
  },
]

const COMPANY_SIGNAL_FILTER_KEYS: readonly string[] = SIGNAL_FILTERS.filter((filter) => filter.company === true).map((filter) => filter.key)

const ALL_SIGNAL_FILTER_KEYS: readonly string[] = SIGNAL_FILTERS.map((filter) => filter.key)

const NARROWING_SIGNAL_FILTER_KEYS: readonly string[] = [
  'types', 'domains', 'company_ids', 'countries', 'company_sizes', 'industries', 'categories', 'funding_stages', 'functions',
  'roles', 'seniority', 'technologies', 'skills', 'technology_categories', 'job_countries', 'job_regions', 'job_cities',
]

const MAX_LIST_VALUES = 100
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 10
const LINE_SEPARATOR = '\n'
const COMPANY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_PATTERN = /^(\d{4}-\d{2}-\d{2})(T.*)?$/
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$/

function toSignalsQuery({ values, keys }: { values: Values, keys: readonly string[] }): Record<string, string> {
  const query: Record<string, string> = {}
  for (const filter of SIGNAL_FILTERS) {
    if (!keys.includes(filter.key)) continue
    const value = readFilter({ filter, value: values[filter.key] })
    if (value !== undefined) query[filter.key] = value
  }
  return query
}

function requireNarrowingSignalFilter(query: Record<string, string>): void {
  if (NARROWING_SIGNAL_FILTER_KEYS.some((key) => query[key] !== undefined)) return
  const labels = SIGNAL_FILTERS.filter((filter) => NARROWING_SIGNAL_FILTER_KEYS.includes(filter.key)).map((filter) => filter.label)
  const named = `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
  throw new Error(
    `Set at least one of ${named} before using this trigger. Without one it matches every hiring signal Jobo detects, ` +
      'and every signal is billed at ten times the price of a job.',
  )
}

function readFilter({ filter, value }: { filter: SignalFilter, value: unknown }): string | undefined {
  if (filter.kind === 'stringList' || filter.kind === 'enumList') return readList({ filter, value })
  if (filter.kind === 'boolean') return value === true ? 'true' : undefined
  if (filter.kind === 'number') return readBoundedNumber({ filter, value })
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return undefined
  return filter.kind === 'date' ? readDay({ filter, text }) : readInstant({ filter, text })
}

function readList({ filter, value }: { filter: SignalFilter, value: unknown }): string | undefined {
  const entries = splitLines(value)
  const options = filter.options
  const list = options === undefined ? entries : [...new Set(entries.map((entry) => entry.toLowerCase()))]
  if (list.length === 0) return undefined
  if (options !== undefined) {
    const unknown = list.filter((entry) => !options.includes(entry))
    if (unknown.length > 0) {
      throw new Error(`${filter.label} does not take ${unknown.map((entry) => `"${entry}"`).join(', ')}. Pick values from the list.`)
    }
  }
  const withComma = list.find((entry) => entry.includes(','))
  if (withComma !== undefined) {
    throw new Error(
      `"${withComma}" cannot be used in ${filter.label}: the signals API separates values with commas, so a value that contains one is read as two.`,
    )
  }
  if (list.length > MAX_LIST_VALUES) {
    throw new Error(`${filter.label} takes at most ${MAX_LIST_VALUES} values; ${list.length} were given.`)
  }
  return list.join(',')
}

function splitLines(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const lines = entries
    .filter((entry) => entry !== undefined && entry !== null)
    .flatMap((entry) => String(entry).split(LINE_SEPARATOR))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return [...new Set(lines)]
}

function readBoundedNumber({ filter, value }: { filter: SignalFilter, value: unknown }): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (Number.isFinite(parsed) && parsed <= 0) return undefined
  const min = filter.min ?? 1
  const max = filter.max ?? Number.MAX_SAFE_INTEGER
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${filter.label} must be a whole number from ${min} to ${max}.`)
  }
  return String(parsed)
}

function readDay({ filter, text }: { filter: SignalFilter, text: string }): string {
  const day = DAY_PATTERN.exec(text)?.[1]
  if (day === undefined) {
    throw new Error(`${filter.label} must be a date such as 2026-11-01.`)
  }
  return day
}

function readInstant({ filter, text }: { filter: SignalFilter, text: string }): string {
  if (INSTANT_PATTERN.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00Z`
  throw new Error(`${filter.label} must be a date and time such as 2026-11-12T09:30:00Z. Map a Created At value unchanged.`)
}

function readCompanyId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!COMPANY_ID_PATTERN.test(id)) {
    throw new Error(
      `"${id}" is not a Jobo company ID. Company IDs look like 0f8fad5b-d9cb-469f-a165-70867728950e: map Company ID from a hiring signal or a job.`,
    )
  }
  return id.toLowerCase()
}

function readLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(parsed), MAX_LIMIT)
}

function readCursor(value: unknown): string | undefined {
  const cursor = typeof value === 'string' ? value.trim() : ''
  return cursor === '' ? undefined : cursor
}

type Values = Record<string, unknown>

type SignalFilterKind = 'stringList' | 'enumList' | 'number' | 'boolean' | 'date' | 'dateTime'

type SignalFilter = {
  key: string
  label: string
  kind: SignalFilterKind
  description: string
  options?: readonly string[]
  company?: boolean
  min?: number
  max?: number
}

export const joboSignals = {
  SIGNAL_TYPES,
  SIGNAL_SENIORITY,
  SIGNAL_COMPANY_SIZES,
  SIGNAL_TYPE_LABELS,
  SIGNAL_FILTERS,
  COMPANY_SIGNAL_FILTER_KEYS,
  ALL_SIGNAL_FILTER_KEYS,
  NARROWING_SIGNAL_FILTER_KEYS,
  MAX_LIST_VALUES,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  toSignalsQuery,
  requireNarrowingSignalFilter,
  readCompanyId,
  readLimit,
  readCursor,
}

export type { SignalFilter, SignalFilterKind }
