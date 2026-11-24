import { httpClient } from '@activepieces/pieces-common'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { joboClient } from '../src/lib/common/client'
import { FAKE_KEY, mockApi } from './helpers/mock-api'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const call = () => joboClient.withJobo({ apiKey: FAKE_KEY, run: (client) => client.getJob('x') })

async function afterRetryWait<T>(pending: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = Promise.allSettled([pending]).then(([result]) => result)
  await vi.advanceTimersByTimeAsync(5_000)
  return settled
}

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

  test('a 503 is retried once, 5 seconds later, then described with the status', async () => {
    vi.useFakeTimers()
    const { requests } = mockApi(() => ({ status: 503, body: { detail: 'busy' }, headers: { 'Retry-After': '5' } }))
    const settled = Promise.allSettled([call()])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const [result] = await settled
    expect(requests).toHaveLength(2)
    expect(result.status === 'rejected' && String(result.reason)).toMatch(/temporarily unavailable \(HTTP 503\)/)
  })

  test('a 503 followed by a success returns the success', async () => {
    vi.useFakeTimers()
    let calls = 0
    mockApi(() => {
      calls += 1
      return calls === 1 ? { status: 503, body: { detail: 'busy' } } : { body: { id: 'x' } }
    })
    const result = await afterRetryWait(call())
    expect(result.status === 'fulfilled' && result.value.data).toEqual({ id: 'x' })
  })

  test('a 400 is not retried and is described with the status', async () => {
    const { requests } = mockApi(() => ({ status: 400, body: { detail: 'bad batch size' } }))
    await expect(call()).rejects.toThrow(/Jobo API error \(HTTP 400\): bad batch size/)
    expect(requests).toHaveLength(1)
  })

  test('sandbox refusal explains the live key requirement', async () => {
    mockApi(() => ({ status: 404, body: { code: 'not_available_in_sandbox', detail: 'x' } }))
    await expect(call()).rejects.toThrow(/live Jobo API key/)
  })

  test('a network failure becomes a readable error', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(httpClient, 'sendRequest').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    const result = await afterRetryWait(call())
    expect(result.status === 'rejected' && String(result.reason)).toMatch(/Could not reach the Jobo API: getaddrinfo ENOTFOUND/)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  test('refuses a malformed key before any request', async () => {
    const { requests } = mockApi(() => ({}))
    await expect(joboClient.withJobo({ apiKey: 'nope', run: (client) => client.getJob('x') })).rejects.toThrow(/does not look like a Jobo API key/)
    expect(requests).toHaveLength(0)
  })
})
