import { httpClient, HttpError, HttpHeaders, HttpMethod } from '@activepieces/pieces-common'
import {
  InsufficientCreditsError,
  isValidApiKeyFormat,
  JoboApiError,
  JoboClient,
  JoboTransportError,
  RateLimitError,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from '@jobo-ai/connector-core'
import { joboConstants } from './constants'

async function withJobo<T>({ apiKey, run }: WithJoboParams<T>): Promise<T> {
  if (!isValidApiKeyFormat(apiKey)) {
    throw new Error(INVALID_KEY_MESSAGE)
  }
  const client = new JoboClient({
    apiKey,
    transport,
    retry: { sleep: waitBeforeRetry, maxAttempts: joboConstants.RETRY_MAX_ATTEMPTS, retryRateLimit: false },
    timeoutMs: joboConstants.REQUEST_TIMEOUT_MS,
    client: joboConstants.CLIENT_NAME,
    userAgent: joboConstants.USER_AGENT,
  })
  try {
    return await run(client)
  }
  catch (error) {
    throw toFriendlyError(error)
  }
}

function isNotAvailableInSandbox(error: unknown): boolean {
  return error instanceof JoboApiError && error.status === 404 && error.code === 'not_available_in_sandbox'
}

function toFriendlyError(error: unknown): unknown {
  if (error instanceof RateLimitError) {
    const wait = error.retryAfterSeconds === null ? '' : ` Try again in ${error.retryAfterSeconds} seconds.`
    return new Error(`Jobo rate limit reached (HTTP 429).${wait} ${error.message}`.trim())
  }
  if (error instanceof InsufficientCreditsError) {
    const topUp = readString({ body: error.body, key: 'top_up_url' }) ?? joboConstants.BILLING_URL
    return new Error(
      `Jobo wallet balance too low (HTTP 402). ${error.message} Top up at ${topUp} and run this step again. ` +
        'The balance check covers a full page of jobs, so asking for fewer jobs needs less.',
    )
  }
  if (error instanceof JoboApiError) {
    return new Error(describeApiError(error))
  }
  if (error instanceof JoboTransportError) {
    return new Error(error.message)
  }
  return error
}

function describeApiError(error: JoboApiError): string {
  if (error.status === 401) {
    return `Jobo rejected the API key (HTTP 401). Create a new key at ${joboConstants.API_KEYS_URL} and reconnect.`
  }
  if (isNotAvailableInSandbox(error)) {
    return 'This needs a live Jobo API key (jbe_live_...). A sandbox key (jbe_test_...) serves job search and job lookups only.'
  }
  if (error.status === 503) {
    return `Jobo is temporarily unavailable (HTTP 503): ${error.message}`
  }
  return `Jobo API error (HTTP ${error.status}): ${error.message}`
}

async function readBilledPage({ apiKey, path, query }: BilledPageParams): Promise<unknown> {
  try {
    return await fetchBilledPage({ apiKey, path, query })
  }
  catch (error) {
    throw toFriendlySignalsError(error)
  }
}

async function fetchBilledPage({ apiKey, path, query }: BilledPageParams): Promise<unknown> {
  if (!isValidApiKeyFormat(apiKey)) {
    throw new Error(INVALID_KEY_MESSAGE)
  }
  const response = await transport.request({
    method: 'GET',
    url: `${joboConstants.BASE_URL}${path}${queryString(query)}`,
    headers: {
      'X-Api-Key': apiKey,
      Accept: 'application/json',
      'User-Agent': joboConstants.USER_AGENT,
      'X-Jobo-Client': joboConstants.CLIENT_NAME,
    },
    timeoutMs: joboConstants.REQUEST_TIMEOUT_MS,
  })
  const body = parseBody(response.body)
  if (response.status >= 200 && response.status < 300) return body
  throw toApiError({ status: response.status, headers: response.headers, body })
}

function toFriendlySignalsError(error: unknown): unknown {
  if (error instanceof InsufficientCreditsError) {
    const topUp = readString({ body: error.body, key: 'top_up_url' }) ?? joboConstants.BILLING_URL
    return new Error(
      `Jobo balance too low for these hiring signals (HTTP 402). ${error.message} Every signal returned is billed at ten times the price of a job: ` +
        `included signals are used first, then the wallet. Top up at ${topUp}, or lower Maximum Signals, and run this step again.`,
    )
  }
  if (error instanceof JoboApiError && error.status === 403 && error.code === 'account_key_required') {
    return new Error(
      `Hiring signals need a Jobo account API key (HTTP 403): they are charged to an account. Create a key at ${joboConstants.API_KEYS_URL} and reconnect.`,
    )
  }
  if (isNotAvailableInSandbox(error)) {
    return new Error('Hiring signals need a live Jobo API key (jbe_live_...). A sandbox key (jbe_test_...) serves job search and job lookups only.')
  }
  if (error instanceof JoboApiError && error.status >= 500) {
    return new Error(`${describeApiError(error)} ${NOT_RETRIED}`)
  }
  if (error instanceof JoboTransportError) {
    return new Error(`${error.message} ${NOT_RETRIED}`)
  }
  return toFriendlyError(error)
}

function toApiError({ status, headers, body }: { status: number, headers: Record<string, string>, body: unknown }): JoboApiError {
  const code = readString({ body, key: 'code' })
  const detail = readString({ body, key: 'detail' }) ?? readString({ body, key: 'error' }) ?? readString({ body, key: 'title' })
  const base = { status, message: detail ?? `Jobo API returned HTTP ${status}`, code, detail, body }
  if (status === 402) return new InsufficientCreditsError(base)
  if (status === 429) {
    const retryAfterSeconds = readSeconds(headers['retry-after']) ?? readSeconds(readField({ body, key: 'retry_after_seconds' }))
    return new RateLimitError({ ...base, retryAfterSeconds })
  }
  return new JoboApiError(base)
}

function queryString(query: Record<string, string | number>): string {
  const parts = Object.entries(query).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

function parseBody(raw: string): unknown {
  if (raw.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  }
  catch {
    return raw
  }
}

function readField({ body, key }: { body: unknown, key: string }): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  return Object.entries(body).find(([name]) => name === key)?.[1]
}

function readSeconds(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

async function sendThroughHttpClient(request: TransportRequest): Promise<TransportResponse> {
  try {
    const response = await httpClient.sendRequest<string>({
      method: request.method === 'GET' ? HttpMethod.GET : HttpMethod.POST,
      url: request.url,
      headers: request.headers,
      body: request.body,
      timeout: request.timeoutMs,
      responseType: 'text',
    })
    return { status: response.status, headers: lowerCaseHeaders(response.headers), body: response.body }
  }
  catch (error) {
    if (error instanceof HttpError) {
      return { status: error.response.status, headers: {}, body: asText(error.response.body) }
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new JoboTransportError(`Could not reach the Jobo API: ${reason}`, error)
  }
}

function lowerCaseHeaders(headers: HttpHeaders | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).flatMap(([name, value]) => {
      if (value === undefined) return []
      return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]]
    }),
  )
}

function asText(body: unknown): string {
  if (typeof body === 'string') return body
  return body === undefined || body === null ? '' : JSON.stringify(body)
}

async function waitBeforeRetry(ms: number): Promise<void> {
  const delay = Math.max(ms, joboConstants.RETRY_DELAY_MS)
  await new Promise<void>((resolve) => setTimeout(resolve, delay))
}

function readString({ body, key }: { body: unknown, key: string }): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value = Object.entries(body).find(([name]) => name === key)?.[1]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

const transport: Transport = { request: sendThroughHttpClient }

const INVALID_KEY_MESSAGE =
  'That does not look like a Jobo API key. Keys start with jbe_live_ or jbe_test_ and are 74 characters long. ' +
  `Create one at ${joboConstants.API_KEYS_URL}`

const NOT_RETRIED = 'The step was not retried, because the signals may already have been billed and reading them again bills them again.'

type WithJoboParams<T> = {
  apiKey: string
  run: (client: JoboClient) => Promise<T>
}

type BilledPageParams = {
  apiKey: string
  path: string
  query: Record<string, string | number>
}

export const joboClient = {
  withJobo,
  readBilledPage,
  fetchBilledPage,
  toFriendlySignalsError,
  isNotAvailableInSandbox,
  toFriendlyError,
  INVALID_KEY_MESSAGE,
}
