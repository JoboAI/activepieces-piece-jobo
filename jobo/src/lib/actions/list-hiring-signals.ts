import { createAction } from '@activepieces/pieces-framework'
import { joboAuth } from '../auth'
import { joboSignalPage } from '../common/signal-page'
import { joboSignalProps } from '../common/signal-props'
import { joboSignals } from '../common/signals'

export const listHiringSignals = createAction({
  auth: joboAuth,
  name: 'list_hiring_signals',
  classification: 'SEARCH',
  displayName: 'List Hiring Signals',
  description:
    'Lists hiring signals, newest first: events at companies detected from their job postings, such as a hiring surge, a first job in a country or a leadership search. ' +
    'Every signal returned is billed at ten times the price of a job, and again each time the same signal is read.',
  audience: 'both',
  aiMetadata: {
    description:
      'List hiring signals (a hiring surge, a new function, country or city, a leadership search, a new skill or technology, a hard-to-fill job, a slowdown, a freeze) ' +
      'at companies, filtered by type, company domain, country, size, industry, function, role, seniority, technology and dates, newest detection day first. ' +
      'Each signal returned is billed at ten times the price of a job and billed again when read again, so keep Maximum Signals small and do not repeat a read. ' +
      'Returns one page: signals as flat records with a one-sentence summary, has_more and next_cursor.',
    idempotent: false,
  },
  props: {
    types: joboSignalProps.types,
    domains: joboSignalProps.domains,
    company_ids: joboSignalProps.companyIds,
    exclude_domains: joboSignalProps.excludeDomains,
    countries: joboSignalProps.countries,
    company_sizes: joboSignalProps.companySizes,
    industries: joboSignalProps.industries,
    categories: joboSignalProps.categories,
    funding_stages: joboSignalProps.fundingStages,
    founded_after: joboSignalProps.foundedAfter,
    exclude_agencies: joboSignalProps.excludeAgencies,
    functions: joboSignalProps.functions,
    roles: joboSignalProps.roles,
    seniority: joboSignalProps.seniority,
    technologies: joboSignalProps.technologies,
    skills: joboSignalProps.skills,
    technology_categories: joboSignalProps.technologyCategories,
    job_countries: joboSignalProps.jobCountries,
    job_regions: joboSignalProps.jobRegions,
    job_cities: joboSignalProps.jobCities,
    min_strength: joboSignalProps.minStrength,
    min_new_jobs: joboSignalProps.minNewJobs,
    min_days_open: joboSignalProps.minDaysOpen,
    reposted_only: joboSignalProps.repostedOnly,
    detected_after: joboSignalProps.detectedAfter,
    detected_before: joboSignalProps.detectedBefore,
    created_after: joboSignalProps.createdAfter,
    limit: joboSignalProps.limit,
    cursor: joboSignalProps.cursor,
  },
  async run(context) {
    return joboSignalPage.readSignals({
      apiKey: context.auth.secret_text,
      path: '/api/signals',
      keys: joboSignals.ALL_SIGNAL_FILTER_KEYS,
      values: { ...context.propsValue },
    })
  },
})
