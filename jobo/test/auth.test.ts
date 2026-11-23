import { afterEach, describe, expect, test, vi } from 'vitest'
import { joboAuth } from '../src/lib/auth'
import { FAKE_KEY, FAKE_SANDBOX_KEY, FREE_PATHS, mockApi } from './helpers/mock-api'

const validate = joboAuth.validate
if (!validate) throw new Error('auth.validate is not defined')

const server = { apiUrl: 'http://localhost', publicUrl: 'http://localhost', token: 't', mintOidcToken: async () => 'oidc' }

afterEach(() => vi.restoreAllMocks())

describe('auth validate', () => {
  test('rejects a malformed key without any request', async () => {
    const { requests } = mockApi(() => ({}))
    const result = await validate({ auth: 'not-a-key', server })
    expect(result.valid).toBe(false)
    expect(requests).toHaveLength(0)
  })

  test('checks a live key with the free filters endpoint and sends the key as X-Api-Key', async () => {
    const { requests } = mockApi(() => ({ body: { enums: {}, sources: [] } }))
    const result = await validate({ auth: FAKE_KEY, server })
    expect(result).toEqual({ valid: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url).toBe('https://connect.jobo.world/api/connectors/filters')
    expect(FREE_PATHS.some((pattern) => pattern.test(requests[0].path))).toBe(true)
    expect(requests[0].headers['X-Api-Key']).toBe(FAKE_KEY)
    expect(requests[0].headers['X-Jobo-Client']).toBe('activepieces')
  })

  test('accepts a sandbox key refused with not_available_in_sandbox', async () => {
    mockApi(() => ({ status: 404, body: { code: 'not_available_in_sandbox', detail: 'sandbox' } }))
    expect(await validate({ auth: FAKE_SANDBOX_KEY, server })).toEqual({ valid: true })
  })

  test('maps 401 to an invalid key message', async () => {
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    const result = await validate({ auth: FAKE_KEY, server })
    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toContain('HTTP 401')
  })

  test('reports 429 and 500 as not valid with the reason', async () => {
    mockApi(() => ({ status: 429, body: { error: 'Rate limit exceeded', retry_after_seconds: 7 } }))
    const limited = await validate({ auth: FAKE_KEY, server })
    expect(limited.valid === false && limited.error).toContain('Try again in 7 seconds')

    vi.restoreAllMocks()
    mockApi(() => ({ status: 500, body: { message: 'boom' } }))
    const failed = await validate({ auth: FAKE_KEY, server })
    expect(failed.valid === false && failed.error).toContain('HTTP 500')
  })

  test('never puts the key in an error message', async () => {
    mockApi(() => ({ status: 401, body: { error: 'Invalid or expired API key' } }))
    const result = await validate({ auth: FAKE_KEY, server })
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY)
  })
})
