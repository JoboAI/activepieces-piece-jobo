import { httpClient, HttpError, type HttpRequest } from '@activepieces/pieces-common'
import { AppConnectionType } from '@activepieces/pieces-framework'
import { vi } from 'vitest'

export const FAKE_KEY = `jbe_live_${'a'.repeat(21)}_${'b'.repeat(43)}`
export const FAKE_SANDBOX_KEY = `jbe_test_${'c'.repeat(21)}_${'d'.repeat(43)}`

export const FREE_PATHS = [
  /^\/api\/connectors\/filters$/,
  /^\/api\/connectors\/filter-options\/[a-z_]+$/,
  /^\/api\/connectors\/companies\/suggest$/,
  /^\/api\/connectors\/locations\/suggest$/,
  /^\/api\/occupations$/,
  /^\/api\/jobs\/[^/]+$/,
]

export type Reply = {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type Recorded = {
  method: string
  url: string
  path: string
  query: URLSearchParams
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

export function mockApi(handler: (request: Recorded) => Reply | Promise<Reply>) {
  const requests: Recorded[] = []
  const spy = vi.spyOn(httpClient, 'sendRequest').mockImplementation(async (request: HttpRequest) => {
    const parsed = new URL(request.url)
    const recorded: Recorded = {
      method: String(request.method),
      url: request.url,
      path: parsed.pathname,
      query: parsed.searchParams,
      headers: request.headers ?? {},
      body: typeof request.body === 'string' ? JSON.parse(request.body) : request.body,
    }
    requests.push(recorded)
    const reply = await handler(recorded)
    const status = reply.status ?? 200
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {})
    if (status < 200 || status >= 300) {
      throw new HttpError(request.body, { status, responseBody: text })
    }
    return { status, headers: reply.headers ?? {}, body: text }
  })
  return { requests, spy }
}

export function authValue(secret: string = FAKE_KEY) {
  return { type: AppConnectionType.SECRET_TEXT as const, secret_text: secret }
}

export function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial))
  return {
    data,
    put: async <T>(key: string, value: T): Promise<T> => {
      data.set(key, value)
      return value
    },
    get: async <T>(key: string): Promise<T | null> => (data.has(key) ? (data.get(key) as T) : null),
    delete: async (key: string): Promise<void> => {
      data.delete(key)
    },
  }
}

export function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    title: 'Backend Engineer',
    normalized_title: 'Backend Engineer',
    company: { id: 'company-1', name: 'Acme', website: 'https://acme.example', logo_url: null, summary: null, industries: ['Software'], categories: ['saas'], linkedin_url: null, crunchbase_url: null, details_url: null },
    description: 'Build things',
    summary: null,
    listing_url: 'https://careers.acme.example/1',
    apply_url: null,
    locations: [{ location: 'Berlin, Germany', city: 'Berlin', region: 'Berlin', country: 'Germany', latitude: 52.5, longitude: 13.4 }],
    compensation: { min: 1, max: 2, currency: 'EUR', period: 'yearly' },
    employment_type: 'Full-time',
    workplace_type: 'Remote',
    experience_level: 'Senior',
    source: 'greenhouse',
    created_at: '2026-11-23T10:00:00Z',
    updated_at: '2026-11-23T10:00:00Z',
    date_posted: '2026-11-23T09:00:00Z',
    valid_through: null,
    qualifications: { must_have: { education: [], certifications: [], skills: [{ name: 'Go', type: 'hard' }] }, preferred: null },
    responsibilities: ['Ship'],
    benefits: [],
    is_work_auth_required: null,
    is_h1b_sponsor: null,
    is_clearance_required: null,
    ...overrides,
  }
}
