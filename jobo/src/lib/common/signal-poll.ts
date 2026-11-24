import { JoboApiError } from '@jobo-ai/connector-core'
import { joboClient } from './client'
import { joboConstants } from './constants'

// The reference algorithm of the shared spec, written here because the connector-core on npm (0.5.0) has no
// signals poller. It reads GET /api/signals in the order signals were stored (sort=created_asc) and sends back
// the created_at of the last signal delivered as created_after, as the string the API sent: created_at has
// microseconds and one write batch is a microsecond apart, so a parsed or rounded value would bill signals twice
// or skip them.
async function pollSignals({ apiKey, query, state, maxSignals, now }: PollParams): Promise<PollResult> {
  if (state === null || typeof state.watermark !== 'string' || state.watermark === '') {
    return { signals: [], state: { watermark: now().toISOString() }, changed: true }
  }

  const watermark = state.watermark
  const held = state.cursor
  let since = held === undefined ? watermark : held.since
  let cursor = held?.value
  let cursorRefused = false
  const read: unknown[] = []

  while (read.length < maxSignals) {
    const limit = Math.min(joboConstants.SIGNAL_PAGE_MAX, maxSignals - read.length)
    let body: unknown
    try {
      body = await joboClient.fetchBilledPage({
        apiKey,
        path: SIGNALS_PATH,
        query: {
          ...query,
          sort: joboConstants.SIGNAL_POLL_SORT,
          created_after: since,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
        },
      })
    }
    catch (error) {
      if (held !== undefined && !cursorRefused && cursor === held.value && read.length === 0 && isRefusedCursor(error)) {
        cursorRefused = true
        cursor = undefined
        since = watermark
        continue
      }
      throw joboClient.toFriendlySignalsError(error)
    }

    const page = record(body)
    const signals = Array.isArray(page['signals']) ? page['signals'] : []
    read.push(...signals)
    const next = page['next_cursor']
    cursor = page['has_more'] === true && typeof next === 'string' && next !== '' ? next : undefined
    if (cursor === undefined || signals.length === 0) break
  }

  if (read.length === 0) {
    return cursorRefused ? { signals: [], state: { watermark }, changed: true } : { signals: [], state, changed: false }
  }

  const reached = record(read[read.length - 1])['created_at']
  if (typeof reached !== 'string' || reached.trim() === '') {
    throw new Error('The Jobo API returned a hiring signal without Created At, so the trigger cannot record where it stopped. Nothing was saved.')
  }

  return {
    signals: read,
    state: cursor === undefined ? { watermark: reached } : { watermark: reached, cursor: { value: cursor, since } },
    changed: true,
  }
}

function isRefusedCursor(error: unknown): boolean {
  if (!(error instanceof JoboApiError) || error.status !== 400) return false
  const errors = record(record(error.body)['errors'])
  return Object.keys(errors).some((key) => key.toLowerCase() === 'cursor')
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {}
}

const SIGNALS_PATH = '/api/signals'

type SignalPollState = {
  watermark: string
  cursor?: { value: string, since: string }
}

type PollParams = {
  apiKey: string
  query: Record<string, string>
  state: SignalPollState | null
  maxSignals: number
  now: () => Date
}

type PollResult = {
  signals: unknown[]
  state: SignalPollState
  changed: boolean
}

export const joboSignalPoll = {
  pollSignals,
}

export type { SignalPollState }
