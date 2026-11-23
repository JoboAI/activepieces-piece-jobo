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
    retry: { sleep: noSleep, maxAttempts: 1, retryRateLimit: false },
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

async function noSleep(): Promise<void> {
  return undefined
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

type WithJoboParams<T> = {
  apiKey: string
  run: (client: JoboClient) => Promise<T>
}

export const joboClient = {
  withJobo,
  isNotAvailableInSandbox,
  toFriendlyError,
  INVALID_KEY_MESSAGE,
}
