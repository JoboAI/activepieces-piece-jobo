import { Property } from '@activepieces/pieces-framework'
import { joboConstants } from './constants'
import { joboSignals, type SignalFilter } from './signals'

const FILTER_NOTE = 'Leave empty to not filter on this.'
const LINES_NOTE = 'Put one value per line, or map a list.'

function filter(key: string): SignalFilter {
  const found = joboSignals.SIGNAL_FILTERS.find((entry) => entry.key === key)
  if (found === undefined) {
    throw new Error(`Unknown hiring signals filter ${key}`)
  }
  return found
}

function lines({ key, advanced }: { key: string, advanced: boolean }) {
  const { label, description } = filter(key)
  return Property.LongText({
    displayName: label,
    description: `${description} ${LINES_NOTE} ${FILTER_NOTE}`,
    required: false,
    ...(advanced ? { advanced } : {}),
  })
}

function choices({ key, advanced, label }: { key: string, advanced: boolean, label: (value: string) => string }) {
  const descriptor = filter(key)
  return Property.StaticMultiSelectDropdown<string, false>({
    displayName: descriptor.label,
    description: `${descriptor.description} ${FILTER_NOTE}`,
    required: false,
    options: { options: (descriptor.options ?? []).map((value) => ({ label: label(value), value })) },
    ...(advanced ? { advanced } : {}),
  })
}

function count({ key, advanced }: { key: string, advanced: boolean }) {
  const { label, description, min, max } = filter(key)
  return Property.Number({
    displayName: label,
    description: `${description} From ${min} to ${max}. ${FILTER_NOTE}`,
    required: false,
    ...(advanced ? { advanced } : {}),
  })
}

function checkbox(key: string) {
  const { label, description } = filter(key)
  return Property.Checkbox({
    displayName: label,
    description,
    required: false,
    defaultValue: false,
    advanced: true,
  })
}

function moment({ key, advanced }: { key: string, advanced: boolean }) {
  const { label, description } = filter(key)
  return Property.DateTime({
    displayName: label,
    description: `${description} ${FILTER_NOTE}`,
    required: false,
    ...(advanced ? { advanced } : {}),
  })
}

const types = choices({ key: 'types', advanced: false, label: (value) => joboSignals.SIGNAL_TYPE_LABELS[value] ?? value })
const domains = lines({ key: 'domains', advanced: false })
const companyIds = lines({ key: 'company_ids', advanced: true })
const excludeDomains = lines({ key: 'exclude_domains', advanced: true })
const countries = lines({ key: 'countries', advanced: false })
const companySizes = choices({ key: 'company_sizes', advanced: true, label: (value) => value })
const industries = lines({ key: 'industries', advanced: true })
const categories = lines({ key: 'categories', advanced: true })
const fundingStages = lines({ key: 'funding_stages', advanced: true })
const foundedAfter = count({ key: 'founded_after', advanced: true })
const excludeAgencies = checkbox('exclude_agencies')
const functions = lines({ key: 'functions', advanced: false })
const roles = lines({ key: 'roles', advanced: true })
const seniority = choices({ key: 'seniority', advanced: true, label: (value) => (value === 'c_level' ? 'C-level' : value === 'vp' ? 'VP' : value.charAt(0).toUpperCase() + value.slice(1)) })
const technologies = lines({ key: 'technologies', advanced: true })
const skills = lines({ key: 'skills', advanced: true })
const technologyCategories = lines({ key: 'technology_categories', advanced: true })
const jobCountries = lines({ key: 'job_countries', advanced: true })
const jobRegions = lines({ key: 'job_regions', advanced: true })
const jobCities = lines({ key: 'job_cities', advanced: true })
const minStrength = count({ key: 'min_strength', advanced: false })
const minNewJobs = count({ key: 'min_new_jobs', advanced: true })
const minDaysOpen = count({ key: 'min_days_open', advanced: true })
const repostedOnly = checkbox('reposted_only')
const detectedAfter = moment({ key: 'detected_after', advanced: true })
const detectedBefore = moment({ key: 'detected_before', advanced: true })
const createdAfter = moment({ key: 'created_after', advanced: true })

const companyId = Property.ShortText({
  displayName: 'Company ID',
  description:
    'The Jobo company ID, for example 0f8fad5b-d9cb-469f-a165-70867728950e. Map **Company ID** from a hiring signal or a job.',
  required: true,
})

const limit = Property.Number({
  displayName: 'Maximum Signals',
  description:
    `How many signals to return, 1 to ${joboSignals.MAX_LIMIT}. Every signal returned is billed at ten times the price of a job, and again each time it is read; ` +
    `see the [pricing page](${joboConstants.PRICING_URL}). This step reads one page and never more.`,
  required: false,
  defaultValue: joboSignals.DEFAULT_LIMIT,
  display: 'stepper',
  min: 1,
  max: joboSignals.MAX_LIMIT,
  step: 1,
})

const maxSignalsPerPoll = Property.Number({
  displayName: 'Maximum Signals per Poll',
  description:
    `The most signals one check reads, 1 to ${joboSignals.MAX_LIMIT}, and so the most one check is billed for. Every signal returned is billed at ten times ` +
    `the price of a job; see the [pricing page](${joboConstants.PRICING_URL}). When more new signals are waiting, the next check continues where this one ` +
    'stopped, so none is skipped and none is read twice; they arrive over several checks.',
  required: false,
  defaultValue: joboSignals.DEFAULT_LIMIT,
  display: 'stepper',
  min: 1,
  max: joboSignals.MAX_LIMIT,
  step: 1,
})

const cursor = Property.ShortText({
  displayName: 'Cursor',
  description: 'To read the next page, map **Next Cursor** from an earlier run with the same filters. The next page is billed per signal too.',
  required: false,
  advanced: true,
})

export const joboSignalProps = {
  types,
  domains,
  companyIds,
  excludeDomains,
  countries,
  companySizes,
  industries,
  categories,
  fundingStages,
  foundedAfter,
  excludeAgencies,
  functions,
  roles,
  seniority,
  technologies,
  skills,
  technologyCategories,
  jobCountries,
  jobRegions,
  jobCities,
  minStrength,
  minNewJobs,
  minDaysOpen,
  repostedOnly,
  detectedAfter,
  detectedBefore,
  createdAfter,
  companyId,
  limit,
  maxSignalsPerPoll,
  cursor,
}
