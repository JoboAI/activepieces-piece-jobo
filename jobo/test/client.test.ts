import { httpClient } from '@activepieces/pieces-common'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { joboClient } from '../src/lib/common/client'
import { FAKE_KEY, mockApi } from './helpers/mock-api'

afterEach(() => vi.restoreAllMocks())

const call = () => joboClient.withJobo({ apiKey: FAKE_KEY, run: (client) => client.getJob('x') })

describe('error mapping', () => {
  test('401 names the API keys page', async () => {
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    await expect(call()).rejects.toThrow(/HTTP 401.*enterprise\.jobo\.world\/api-keys/)
  })

  test('402 carries the top-up link from the body and is never retried', async () => {
    const { requests } = mockApi(() => ({
      status: 402,
      body: { error: 'Insufficient credits', detail: 'This request needs 75 credits.', top_up_url: 'https://enterprise.jobo.world/credits?topup=10&src=api_402' },
    }))
    await expect(call()).rejects.toThrow(/HTTP 402.*75 credits.*topup=10/)
    expect(requests).toHaveLength(1)
  })

  test('402 without a link falls back to the billing page', async () => {
    mockApi(() => ({ status: 402, body: { error: 'Insufficient credits' } }))
    await expect(call()).rejects.toThrow(/enterprise\.jobo\.world\/credits/)
  })

  test('429 reports the wait from retry_after_seconds and is not retried in the step', async () => {
    const { requests } = mockApi(() => ({ status: 429, body: { code: 'rate_limit_exceeded', detail: 'Per-minute limit exceeded.', retry_after_seconds: 42 } }))
    await expect(call()).rejects.toThrow(/HTTP 429.*42 seconds/)
    expect(requests).toHaveLength(1)
  })

  test('503 and other statuses are described with the status', async () => {
    mockApi(() => ({ status: 503, body: { detail: 'busy' } }))
    await expect(call()).rejects.toThrow(/temporarily unavailable \(HTTP 503\)/)
    vi.restoreAllMocks()
    mockApi(() => ({ status: 400, body: { detail: 'bad batch size' } }))
    await expect(call()).rejects.toThrow(/Jobo API error \(HTTP 400\): bad batch size/)
  })

  test('sandbox refusal explains the live key requirement', async () => {
    mockApi(() => ({ status: 404, body: { code: 'not_available_in_sandbox', detail: 'x' } }))
    await expect(call()).rejects.toThrow(/live Jobo API key/)
  })

  test('a network failure becomes a readable error', async () => {
    vi.spyOn(httpClient, 'sendRequest').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    await expect(call()).rejects.toThrow(/Could not reach the Jobo API: getaddrinfo ENOTFOUND/)
  })

  test('refuses a malformed key before any request', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(joboClient.withJobo({ apiKey: 'nope', run: (client) => client.getJob('x') })).rejects.toThrow(/does not look like a Jobo API key/)
    expect(requests).toHaveLength(0)
  })
})
