import { createAction } from '@activepieces/pieces-framework'
import { toJobSearchBody } from '@jobo-ai/connector-core'
import { joboAuth } from '../auth'
import { joboClient } from '../common/client'
import { joboFilters } from '../common/filters'
import { joboOutput } from '../common/output'
import { joboProps } from '../common/props'

export const searchJobs = createAction({
  auth: joboAuth,
  name: 'search_jobs',
  classification: 'SEARCH',
  displayName: 'Search Jobs',
  description:
    'Finds open jobs by keyword, location, company, skills and more. Every job returned is billed, including a job an earlier search already returned.',
  audience: 'both',
  aiMetadata: {
    description:
      'Search open jobs from employer career sites by keyword, location, company, skills, salary and more, returning up to 100 flat job records. ' +
      'Requires at least one filter. Every returned job is billed, so keep Maximum Jobs small. To fetch one known job use Get Job by ID, which is free.',
    idempotent: true,
  },
  props: {
    q: joboProps.query,
    location: joboProps.searchLocation,
    companies: joboProps.companies,
    sources: joboProps.sources,
    skills: joboProps.skills,
    work_model: joboProps.workModel,
    employment_type: joboProps.employmentType,
    experience_level: joboProps.experienceLevel,
    language: joboProps.language,
    industries: joboProps.industries,
    job_categories: joboProps.jobCategories,
    job_subcategories: joboProps.jobSubcategories,
    occupation_ids: joboProps.occupationIds,
    exclude_companies: joboProps.excludeCompanies,
    exclude_skills: joboProps.excludeSkills,
    exclude_industries: joboProps.excludeIndustries,
    exclude_job_categories: joboProps.excludeJobCategories,
    exclude_job_subcategories: joboProps.excludeJobSubcategories,
    exclude_occupation_ids: joboProps.excludeOccupationIds,
    company_categories: joboProps.companyCategories,
    exclude_company_categories: joboProps.excludeCompanyCategories,
    min_salary_usd: joboProps.minSalary,
    max_salary_usd: joboProps.maxSalary,
    posted_after: joboProps.postedAfter,
    posted_before: joboProps.postedBefore,
    search_description: joboProps.searchDescription,
    sort: joboProps.sort,
    description_format: joboProps.descriptionFormat,
    limit: joboProps.limit,
    page: joboProps.page,
  },
  async run(context) {
    const values = context.propsValue
    joboFilters.requireAnyFilter({ values, keys: FILTER_KEYS })

    return joboClient.withJobo({
      apiKey: context.auth.secret_text,
      run: async (client) => {
        const { data } = await client.searchJobsAdvanced(
          toJobSearchBody(joboFilters.readSearchFilters(values), {
            page: joboFilters.readPage(values['page']),
            page_size: joboFilters.readPageSize(values['limit']),
            include_facets: [],
          }),
        )
        return (data.jobs ?? []).map(joboOutput.flattenJob)
      },
    })
  },
})

const FILTER_KEYS = [
  'q',
  'location',
  'companies',
  'sources',
  'skills',
  'work_model',
  'employment_type',
  'experience_level',
  'language',
  'industries',
  'job_categories',
  'job_subcategories',
  'occupation_ids',
  'exclude_companies',
  'exclude_skills',
  'exclude_industries',
  'exclude_job_categories',
  'exclude_job_subcategories',
  'exclude_occupation_ids',
  'company_categories',
  'exclude_company_categories',
  'min_salary_usd',
  'max_salary_usd',
  'posted_after',
  'posted_before',
]
