import type { CompanySuggestion, Job } from '@jobo-ai/connector-core'

function flattenJob(job: Job & JobExtras): FlatRecord {
  const company = job.company ?? null
  const locations = Array.isArray(job.locations) ? job.locations : []
  const first = locations[0] ?? null
  const compensation = job.compensation ?? null
  const mustHave = job.qualifications?.must_have ?? null
  const preferred = job.qualifications?.preferred ?? null

  return {
    id: job.id,
    title: text(job.title),
    normalized_title: text(job.normalized_title),
    company_name: text(company?.name),
    company_id: text(company?.id),
    company_website: text(company?.website),
    company_logo_url: text(company?.logo_url),
    company_summary: text(company?.summary),
    company_industries: joined({ values: company?.industries, separator: LIST_SEPARATOR }),
    company_categories: joined({ values: company?.categories, separator: LIST_SEPARATOR }),
    company_linkedin_url: text(company?.linkedin_url),
    company_details_url: text(company?.details_url),
    brand_name: text(job.brand?.name),
    brand_domain: text(job.brand?.domain),
    location: text(first?.location),
    city: text(first?.city),
    region: text(first?.region),
    country: text(first?.country),
    latitude: num(first?.latitude),
    longitude: num(first?.longitude),
    all_locations: joined({ values: locations.map((location) => location?.location), separator: '; ' }),
    workplace_type: text(job.workplace_type),
    employment_type: text(job.employment_type),
    experience_level: text(job.experience_level),
    salary_min: num(compensation?.min),
    salary_max: num(compensation?.max),
    salary_currency: text(compensation?.currency),
    salary_period: text(compensation?.period),
    occupation_id: text(job.occupation?.id),
    occupation_name: text(job.occupation?.name),
    job_category: text(job.occupation?.category),
    job_subcategory: text(job.occupation?.subcategory),
    listing_url: text(job.listing_url),
    apply_url: text(job.apply_url),
    source: text(job.source),
    external_id: text(job.external_id),
    language: text(job.language),
    summary: text(job.summary),
    description: text(job.description),
    required_skills: skillNames(mustHave),
    preferred_skills: skillNames(preferred),
    required_education: joined({ values: mustHave?.education, separator: LIST_SEPARATOR }),
    required_certifications: joined({ values: mustHave?.certifications, separator: LIST_SEPARATOR }),
    responsibilities: joined({ values: job.responsibilities, separator: LINE_SEPARATOR }),
    benefits: joined({ values: job.benefits, separator: LINE_SEPARATOR }),
    is_work_auth_required: flag(job.is_work_auth_required),
    is_h1b_sponsor: flag(job.is_h1b_sponsor),
    is_clearance_required: flag(job.is_clearance_required),
    date_posted: text(job.date_posted),
    valid_through: text(job.valid_through),
    created_at: text(job.created_at),
    updated_at: text(job.updated_at),
  }
}

function flattenCompany(company: CompanySuggestion): FlatRecord {
  const ids = Array.isArray(company.ids) && company.ids.length > 0 ? company.ids : [company.id]
  return {
    id: company.id,
    name: text(company.name),
    domain: text(company.domain),
    logo_url: text(company.logo_url),
    country: text(company.country),
    job_count: num(company.job_count),
    company_ids: ids.join(','),
  }
}

function flattenLocation({ location, input }: { location: GeocodedLocation, input: string }): FlatRecord {
  const parts = [location.city, location.region, location.country].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  )
  const label = text(location.display_name) ?? (parts.join(', ') || input)
  return {
    id: label,
    display_name: label,
    city: text(location.city),
    region: text(location.region),
    country: text(location.country),
    country_code: text(location.country_code),
    latitude: num(location.latitude),
    longitude: num(location.longitude),
    confidence: num(location.fuzzy_confidence),
    input,
  }
}

function skillNames(bucket: { skills?: { name?: string | null }[] | null } | null | undefined): string | null {
  const skills = bucket?.skills
  if (!Array.isArray(skills)) return null
  return joined({ values: skills.map((skill) => skill?.name), separator: LIST_SEPARATOR })
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function joined({ values, separator }: { values: unknown, separator: string }): string | null {
  if (!Array.isArray(values)) return null
  const parts = values.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return parts.length > 0 ? parts.join(separator) : null
}

const LIST_SEPARATOR = ', '
const LINE_SEPARATOR = '\n'

const JOB_SAMPLE: FlatRecord = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  title: 'Senior Backend Engineer',
  normalized_title: 'Backend Engineer',
  company_name: 'Northwind Robotics',
  company_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  company_website: 'https://northwind-robotics.example',
  company_logo_url: 'https://northwind-robotics.example/logo.png',
  company_summary: 'Northwind Robotics builds warehouse automation software.',
  company_industries: 'Software Development, Robotics',
  company_categories: 'b2b, saas',
  company_linkedin_url: 'https://www.linkedin.com/company/northwind-robotics-example',
  company_details_url: 'https://connect.jobo.world/api/companies/0f8fad5b-d9cb-469f-a165-70867728950e',
  brand_name: 'Northwind Group',
  brand_domain: 'northwind-group.example',
  location: 'Berlin, Germany',
  city: 'Berlin',
  region: 'Berlin',
  country: 'Germany',
  latitude: 52.52,
  longitude: 13.405,
  all_locations: 'Berlin, Germany; Remote',
  workplace_type: 'Hybrid',
  employment_type: 'Full-time',
  experience_level: 'Senior',
  salary_min: 95000,
  salary_max: 120000,
  salary_currency: 'EUR',
  salary_period: 'yearly',
  occupation_id: 'esco:f2b15a0e-e65a-438a-affb-29b9d50b77d1',
  occupation_name: 'Software Engineer',
  job_category: 'Technology',
  job_subcategory: 'Software Engineering',
  listing_url: 'https://careers.northwind-robotics.example/jobs/4012345',
  apply_url: 'https://careers.northwind-robotics.example/jobs/4012345/apply',
  source: 'example_ats',
  external_id: '4012345',
  language: 'en',
  summary: "Build and run the services behind Northwind's fleet scheduling platform.",
  description:
    "## About the role\n\nYou will design, build and operate the backend services that schedule robot fleets across our customers' warehouses.",
  required_skills: 'Go, PostgreSQL, Kubernetes',
  preferred_skills: 'Kafka, Terraform',
  required_education: "Bachelor's degree in Computer Science or equivalent experience",
  required_certifications: 'AWS Certified Developer',
  responsibilities: "Design and operate backend services\nMentor engineers on the team",
  benefits: '30 days of paid leave\nLearning budget',
  is_work_auth_required: true,
  is_h1b_sponsor: false,
  is_clearance_required: false,
  date_posted: '2026-11-18T09:30:00Z',
  valid_through: '2026-12-18T00:00:00Z',
  created_at: '2026-11-18T10:02:11Z',
  updated_at: '2026-11-19T04:15:42Z',
}

type FlatRecord = Record<string, string | number | boolean | null>

type JobExtras = {
  external_id?: string | null
  language?: string | null
  occupation?: { id?: string, name?: string, category?: string, subcategory?: string } | null
  brand?: { id?: string, name?: string, domain?: string, logo_url?: string } | null
}

type GeocodedLocation = {
  city?: string | null
  region?: string | null
  country?: string | null
  display_name?: string | null
  country_code?: string | null
  latitude?: number | null
  longitude?: number | null
  fuzzy_confidence?: number | null
}

export const joboOutput = {
  flattenJob,
  flattenCompany,
  flattenLocation,
  JOB_SAMPLE,
}

export type { FlatRecord, GeocodedLocation, JobExtras }
