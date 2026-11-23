import type { DropdownOption } from '@activepieces/pieces-framework'
import {
  JoboApiError,
  type FilterOptionsFacet,
  type JobFacet,
  type JoboClient,
  type OccupationCategory,
  type OccupationTaxonomyResponse,
} from '@jobo-ai/connector-core'
import { joboClient } from './client'
import { joboConstants } from './constants'
import type { Place } from './filters'

async function loadSources({ apiKey }: { apiKey: string }): Promise<DropdownOption<string>[]> {
  return joboClient.withJobo({
    apiKey,
    run: async (client) => {
      const { data } = await client.filters()
      return unique(facetOptions(data.sources ?? [])).sort(byLabel)
    },
  })
}

async function loadFacet({ apiKey, facet, query }: { apiKey: string, facet: FilterOptionsFacet, query: string | undefined }): Promise<DropdownOption<string>[]> {
  return joboClient.withJobo({
    apiKey,
    run: async (client) => {
      const { data } = await client.filterOptions(facet, {
        limit: joboConstants.FILTER_OPTIONS_MAX,
        ...(query ? { q: query } : {}),
      })
      const options = unique(facetOptions(data.options ?? []))
      return facet === 'skills' ? options : options.sort(byLabel)
    },
  })
}

async function loadCompanies({ apiKey, query }: { apiKey: string, query: string | undefined }): Promise<DropdownOption<string>[]> {
  if (!isSearchable(query)) return []
  return joboClient.withJobo({
    apiKey,
    run: async (client) => {
      const { data } = await client.suggestCompanies(query, joboConstants.COMPANY_SUGGEST_MAX)
      return unique(
        (data.suggestions ?? []).map((company) => {
          const details = [company.domain, company.country].filter(Boolean).join(', ')
          const ids = Array.isArray(company.ids) && company.ids.length > 0 ? company.ids : [company.id]
          return { label: details ? `${company.name} (${details})` : company.name, value: ids.join(',') }
        }),
      )
    },
  })
}

async function loadPlaces({ apiKey, query }: { apiKey: string, query: string | undefined }): Promise<DropdownOption<Place>[]> {
  if (!isSearchable(query)) return []
  return joboClient.withJobo({
    apiKey,
    run: async (client) => {
      const { data } = await client.suggestLocations(query, joboConstants.LOCATION_SUGGEST_MAX)
      return (data.suggestions ?? []).flatMap((suggestion) => {
        const label =
          suggestion.display_name ?? [suggestion.city, suggestion.region, suggestion.country].filter(Boolean).join(', ')
        if (!label || !suggestion.country) return []
        const place: Place = {
          country: suggestion.country,
          ...(suggestion.region ? { region: suggestion.region } : {}),
          ...(suggestion.city ? { city: suggestion.city } : {}),
        }
        return [{ label, value: place }]
      })
    },
  })
}

async function loadPlaceLabels({ apiKey, query }: { apiKey: string, query: string | undefined }): Promise<DropdownOption<string>[]> {
  if (!isSearchable(query)) return []
  return joboClient.withJobo({
    apiKey,
    run: async (client) => {
      const { data } = await client.suggestLocations(query, joboConstants.LOCATION_SUGGEST_MAX)
      return unique(
        (data.suggestions ?? []).flatMap((suggestion) => {
          const label =
            suggestion.display_name ?? [suggestion.city, suggestion.region, suggestion.country].filter(Boolean).join(', ')
          return label ? [{ label, value: label }] : []
        }),
      )
    },
  })
}

async function loadTaxonomy({ apiKey }: { apiKey: string }): Promise<OccupationTaxonomyResponse | null> {
  return joboClient.withJobo({ apiKey, run: fetchTaxonomy })
}

async function fetchTaxonomy(client: JoboClient): Promise<OccupationTaxonomyResponse | null> {
  try {
    const { data } = await client.occupations()
    return data
  }
  catch (error) {
    if (error instanceof JoboApiError && error.status === 404 && !joboClient.isNotAvailableInSandbox(error)) return null
    throw error
  }
}

function categoryOptions({ tree }: { tree: OccupationTaxonomyResponse }): DropdownOption<string>[] {
  return unique(tree.categories.map((category) => ({ label: category.name, value: category.name }))).sort(byLabel)
}

function subcategoryOptions({ tree, pickedCategories }: { tree: OccupationTaxonomyResponse, pickedCategories: unknown }): DropdownOption<string>[] {
  return unique(
    categoriesIn({ tree, pickedCategories }).flatMap((category) =>
      category.subcategories.map((subcategory) => ({
        label: `${subcategory.name} (${category.name})`,
        value: subcategory.name,
      })),
    ),
  ).sort(byLabel)
}

function occupationOptions({
  tree,
  pickedCategories,
  pickedSubcategories,
  query,
}: {
  tree: OccupationTaxonomyResponse
  pickedCategories: unknown
  pickedSubcategories: unknown
  query: string | undefined
}): DropdownOption<string>[] {
  const chosenSubcategories = pickedValues(pickedSubcategories)
  const needle = query?.trim().toLowerCase() ?? ''
  const placed = categoriesIn({ tree, pickedCategories }).flatMap((category) =>
    category.subcategories
      .filter((subcategory) => chosenSubcategories.size === 0 || chosenSubcategories.has(subcategory.name.toLowerCase()))
      .flatMap((subcategory) =>
        subcategory.occupations.map((occupation) => ({
          label: `${occupation.name} (${category.name} > ${subcategory.name})`,
          value: occupation.id,
          name: occupation.name,
        })),
      ),
  )
  const matching = needle === '' ? placed : placed.filter((entry) => entry.name.toLowerCase().includes(needle))
  return unique(matching.map(({ label, value }) => ({ label, value })))
    .sort(byLabel)
    .slice(0, joboConstants.OCCUPATION_OPTIONS_MAX)
}

function categoriesIn({ tree, pickedCategories }: { tree: OccupationTaxonomyResponse, pickedCategories: unknown }): OccupationCategory[] {
  const chosen = pickedValues(pickedCategories)
  const matching = tree.categories.filter((category) => chosen.has(category.name.toLowerCase()))
  return matching.length > 0 ? matching : tree.categories
}

function pickedValues(value: unknown): Set<string> {
  const entries = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return new Set(entries.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => entry !== ''))
}

function facetOptions(facets: JobFacet[]): DropdownOption<string>[] {
  return facets.map((facet) => ({ label: facet.name ?? facet.key, value: facet.key }))
}

function isSearchable(query: string | undefined): query is string {
  return typeof query === 'string' && query.trim().length >= joboConstants.SUGGEST_MIN_QUERY_LENGTH
}

function unique<T>(options: DropdownOption<T>[]): DropdownOption<T>[] {
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = typeof option.value === 'string' ? option.value : JSON.stringify(option.value)
    if (key === '' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function byLabel(a: DropdownOption<unknown>, b: DropdownOption<unknown>): number {
  return a.label.localeCompare(b.label)
}

export const joboLookups = {
  loadSources,
  loadFacet,
  loadCompanies,
  loadPlaces,
  loadPlaceLabels,
  loadTaxonomy,
  categoryOptions,
  subcategoryOptions,
  occupationOptions,
  isSearchable,
}
