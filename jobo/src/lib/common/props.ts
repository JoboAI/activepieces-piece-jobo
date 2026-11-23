import {
  Property,
  type AppConnectionValueForAuthProperty,
  type DropdownOption,
  type DropdownState,
} from '@activepieces/pieces-framework'
import {
  COMPANY_CATEGORIES,
  DESCRIPTION_FORMATS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  LANGUAGES,
  WORK_MODELS,
} from '@jobo-ai/connector-core'
import { joboAuth } from '../auth'
import { joboConstants } from './constants'
import { joboLookups } from './lookups'
import type { Place } from './filters'

const NOT_CONNECTED = 'Connect your Jobo account first'
const TYPE_TO_SEARCH = 'Type at least 2 letters to search'
const NO_TAXONOMY = 'The occupation list is not available yet'
const FILTER_NOTE = 'Leave empty to not filter on this.'

async function dropdownState<T>({ auth, load, emptyPlaceholder }: DropdownStateParams<T>): Promise<DropdownState<T>> {
  if (!auth) {
    return { disabled: true, options: [], placeholder: NOT_CONNECTED }
  }
  try {
    const options = await load(auth.secret_text)
    return { disabled: false, options, ...(options.length === 0 ? { placeholder: emptyPlaceholder } : {}) }
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    return { disabled: true, options: [], placeholder: `Could not load the list: ${reason}` }
  }
}

function staticOptions({ values, label }: { values: readonly string[], label: (value: string) => string }): DropdownState<string> {
  return { options: values.map((value) => ({ label: label(value), value })) }
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function sourceList({ displayName, description }: { displayName: string, description: string }) {
  return Property.MultiSelectDropdown<string, false, typeof joboAuth>({
    displayName,
    description,
    auth: joboAuth,
    required: false,
    refreshers: [],
    options: async ({ auth }) => dropdownState({ auth, load: (apiKey) => joboLookups.loadSources({ apiKey }) }),
  })
}

function facetList({ displayName, description, facet, searchable }: { displayName: string, description: string, facet: 'industries' | 'skills', searchable: boolean }) {
  return Property.MultiSelectDropdown<string, false, typeof joboAuth>({
    displayName,
    description,
    auth: joboAuth,
    required: false,
    refreshers: [],
    refreshOnSearch: searchable,
    options: async ({ auth }, { searchValue }) =>
      dropdownState({
        auth,
        load: (apiKey) => joboLookups.loadFacet({ apiKey, facet, query: searchValue?.trim() || undefined }),
      }),
  })
}

function companyList({ displayName, description }: { displayName: string, description: string }) {
  return Property.MultiSelectDropdown<string, false, typeof joboAuth>({
    displayName,
    description,
    auth: joboAuth,
    required: false,
    refreshers: [],
    refreshOnSearch: true,
    options: async ({ auth }, { searchValue }) =>
      dropdownState({
        auth,
        load: (apiKey) => joboLookups.loadCompanies({ apiKey, query: searchValue }),
        emptyPlaceholder: TYPE_TO_SEARCH,
      }),
  })
}

function enumList({ displayName, description, options, advanced }: { displayName: string, description: string, options: DropdownState<string>, advanced?: boolean }) {
  return Property.StaticMultiSelectDropdown<string, false>({
    displayName,
    description: `${description} ${FILTER_NOTE}`,
    required: false,
    options,
    ...(advanced ? { advanced } : {}),
  })
}

function taxonomyList({ displayName, description, kind }: { displayName: string, description: string, kind: 'categories' | 'subcategories' | 'occupations' }) {
  return Property.MultiSelectDropdown<string, false, typeof joboAuth>({
    displayName,
    description,
    auth: joboAuth,
    required: false,
    refreshers: kind === 'categories' ? [] : kind === 'subcategories' ? ['job_categories'] : ['job_categories', 'job_subcategories'],
    refreshOnSearch: kind === 'occupations',
    options: async ({ auth, job_categories, job_subcategories }, { searchValue }) =>
      dropdownState({
        auth,
        emptyPlaceholder: NO_TAXONOMY,
        load: async (apiKey) => {
          const tree = await joboLookups.loadTaxonomy({ apiKey })
          if (tree === null) return []
          if (kind === 'categories') return joboLookups.categoryOptions({ tree })
          if (kind === 'subcategories') return joboLookups.subcategoryOptions({ tree, pickedCategories: job_categories })
          return joboLookups.occupationOptions({
            tree,
            pickedCategories: job_categories,
            pickedSubcategories: job_subcategories,
            query: searchValue,
          })
        },
      }),
  })
}

const sources = sourceList({
  displayName: 'Sources',
  description: `Only jobs from these applicant tracking systems, such as Greenhouse, Lever or Ashby. ${FILTER_NOTE}`,
})

const companies = companyList({
  displayName: 'Companies',
  description:
    'Only jobs at these companies. Type at least 2 letters of a company name or website domain, then pick the company. ' +
    'To use a value from an earlier step, map a Jobo company ID, a website domain such as stripe.com, or an exact company name. ' +
    FILTER_NOTE,
})

const excludeCompanies = companyList({
  displayName: 'Exclude Companies',
  description: 'Leave out jobs at these companies. Search and pick them the same way as Companies.',
})

const workModel = enumList({
  displayName: 'Work Model',
  description: 'Remote, hybrid or onsite.',
  options: staticOptions({ values: WORK_MODELS, label: title }),
})

const employmentType = enumList({
  displayName: 'Employment Type',
  description: 'Full-time, part-time, contract, internship, freelance or temporary.',
  options: staticOptions({ values: EMPLOYMENT_TYPES, label: title }),
})

const experienceLevel = enumList({
  displayName: 'Experience Level',
  description: 'Intern through executive.',
  options: staticOptions({ values: EXPERIENCE_LEVELS, label: title }),
})

const language = Property.StaticMultiSelectDropdown<string, false>({
  displayName: 'Languages',
  description: `The language the job description is written in. ${FILTER_NOTE}`,
  required: false,
  options: { options: LANGUAGES.map((entry) => ({ label: entry.name, value: entry.code })) },
})

const industries = facetList({
  displayName: 'Industries',
  description: `Only jobs at companies in these industries. ${FILTER_NOTE}`,
  facet: 'industries',
  searchable: false,
})

const excludeIndustries = facetList({
  displayName: 'Exclude Industries',
  description: 'Leave out jobs at companies in these industries.',
  facet: 'industries',
  searchable: false,
})

const companyCategories = enumList({
  displayName: 'Company Categories',
  description: "The hiring company's business model, such as b2b, saas or marketplace.",
  options: staticOptions({ values: COMPANY_CATEGORIES, label: (value) => value }),
  advanced: true,
})

const excludeCompanyCategories = enumList({
  displayName: 'Exclude Company Categories',
  description: 'Leave out companies with these business models, for example agency.',
  options: staticOptions({ values: COMPANY_CATEGORIES, label: (value) => value }),
  advanced: true,
})

const jobCategories = taxonomyList({
  displayName: 'Job Categories',
  description: `Occupation categories, such as Healthcare. ${FILTER_NOTE}`,
  kind: 'categories',
})

const excludeJobCategories = taxonomyList({
  displayName: 'Exclude Job Categories',
  description: 'Leave out jobs in these occupation categories.',
  kind: 'categories',
})

const jobSubcategories = taxonomyList({
  displayName: 'Job Subcategories',
  description: `Occupation subcategories, such as Nursing. The list follows the Job Categories you picked. ${FILTER_NOTE}`,
  kind: 'subcategories',
})

const excludeJobSubcategories = taxonomyList({
  displayName: 'Exclude Job Subcategories',
  description: 'Leave out jobs in these occupation subcategories.',
  kind: 'subcategories',
})

const occupationIds = taxonomyList({
  displayName: 'Occupations',
  description: `Specific occupations. Type part of an occupation name to search. ${FILTER_NOTE}`,
  kind: 'occupations',
})

const excludeOccupationIds = taxonomyList({
  displayName: 'Exclude Occupations',
  description: 'Leave out jobs with these occupations. Type part of an occupation name to search.',
  kind: 'occupations',
})

const descriptionFormat = Property.StaticDropdown<string, false>({
  displayName: 'Description Format',
  description: 'How each job description is written. Enhanced is a beta rewrite with consistent headings and lists.',
  required: false,
  defaultValue: 'markdown',
  advanced: true,
  options: {
    options: DESCRIPTION_FORMATS.map((value) => ({
      label: value === 'markdown' ? 'Markdown (as stored)' : value === 'html' ? 'HTML' : value === 'enhanced' ? 'Enhanced Markdown (beta)' : 'Enhanced HTML (beta)',
      value,
    })),
  },
})

const searchLocation = Property.Dropdown<string, false, typeof joboAuth>({
  displayName: 'Location',
  description:
    'A city, region or country. Type at least 2 letters to search, then pick a place. ' +
    'To use text from an earlier step, map it instead, for example "Berlin, Germany" or "Remote".',
  auth: joboAuth,
  required: false,
  refreshers: [],
  refreshOnSearch: true,
  options: async ({ auth }, { searchValue }) =>
    dropdownState({
      auth,
      load: (apiKey) => joboLookups.loadPlaceLabels({ apiKey, query: searchValue }),
      emptyPlaceholder: TYPE_TO_SEARCH,
    }),
})

const triggerLocation = Property.MultiSelectDropdown<Place, false, typeof joboAuth>({
  displayName: 'Locations',
  description:
    'Only jobs in these places. Type at least 2 letters to search, then pick a place. A job matches when it is in any one of them. ' +
    'Mapped values must be objects such as {"city":"Berlin","country":"Germany"}; the country is required.',
  auth: joboAuth,
  required: false,
  refreshers: [],
  refreshOnSearch: true,
  options: async ({ auth }, { searchValue }) =>
    dropdownState({
      auth,
      load: (apiKey) => joboLookups.loadPlaces({ apiKey, query: searchValue }),
      emptyPlaceholder: TYPE_TO_SEARCH,
    }),
})

const query = Property.ShortText({
  displayName: 'Search Query',
  description:
    'Words to find in the job title and description, such as "data engineer". Wrap a phrase in double quotes for an exact title match, ' +
    'and put a minus sign before a word to leave it out.',
  required: false,
})

const searchDescription = Property.Checkbox({
  displayName: 'Search Descriptions',
  description: 'Match the query against full descriptions as well as titles. Untick to match titles only.',
  required: false,
  defaultValue: true,
  advanced: true,
})

const skills = facetList({
  displayName: 'Skills',
  description: `Only jobs that ask for these skills, such as Python or Kubernetes. Type to search beyond the most common ones. ${FILTER_NOTE}`,
  facet: 'skills',
  searchable: true,
})

const excludeSkills = facetList({
  displayName: 'Exclude Skills',
  description: 'Leave out jobs that ask for any of these skills.',
  facet: 'skills',
  searchable: true,
})

const minSalary = Property.Number({
  displayName: 'Minimum Salary (USD)',
  description: 'Only jobs whose advertised pay meets this floor, in US dollars.',
  required: false,
  advanced: true,
})

const maxSalary = Property.Number({
  displayName: 'Maximum Salary (USD)',
  description: 'Only jobs whose advertised pay is at or below this ceiling, in US dollars.',
  required: false,
  advanced: true,
})

const postedAfter = Property.DateTime({
  displayName: 'Posted After',
  description: 'Only jobs the employer posted on or after this time.',
  required: false,
  advanced: true,
})

const postedBefore = Property.DateTime({
  displayName: 'Posted Before',
  description: 'Only jobs the employer posted on or before this time.',
  required: false,
  advanced: true,
})

const sort = Property.StaticDropdown<string, false>({
  displayName: 'Sort',
  description: 'Relevance is the default. The other two order by the time Jobo first indexed the job.',
  required: false,
  defaultValue: 'relevance',
  advanced: true,
  options: {
    options: [
      { label: 'Relevance', value: 'relevance' },
      { label: 'Oldest first', value: 'discovered_asc' },
      { label: 'Newest first', value: 'discovered_desc' },
    ],
  },
})

const limit = Property.Number({
  displayName: 'Maximum Jobs',
  description:
    `How many jobs to return, 1 to ${joboConstants.SEARCH_MAX_PAGE_SIZE}. Every job returned is billed, including one an earlier search returned; ` +
    `see the [pricing page](${joboConstants.PRICING_URL}). Your balance must cover this many jobs before the search runs.`,
  required: false,
  defaultValue: joboConstants.SEARCH_DEFAULT_PAGE_SIZE,
  display: 'stepper',
  min: 1,
  max: joboConstants.SEARCH_MAX_PAGE_SIZE,
  step: 1,
})

const page = Property.Number({
  displayName: 'Page',
  description: 'Which page of results to return, starting at 1. Each page holds up to Maximum Jobs jobs.',
  required: false,
  defaultValue: 1,
  advanced: true,
})

type DropdownStateParams<T> = {
  auth: AppConnectionValueForAuthProperty<typeof joboAuth> | undefined
  load: (apiKey: string) => Promise<DropdownOption<T>[]>
  emptyPlaceholder?: string
}

export const joboProps = {
  sources,
  companies,
  excludeCompanies,
  workModel,
  employmentType,
  experienceLevel,
  language,
  industries,
  excludeIndustries,
  companyCategories,
  excludeCompanyCategories,
  jobCategories,
  excludeJobCategories,
  jobSubcategories,
  excludeJobSubcategories,
  occupationIds,
  excludeOccupationIds,
  descriptionFormat,
  searchLocation,
  triggerLocation,
  query,
  searchDescription,
  skills,
  excludeSkills,
  minSalary,
  maxSalary,
  postedAfter,
  postedBefore,
  sort,
  limit,
  page,
}
