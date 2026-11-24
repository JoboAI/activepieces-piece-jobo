import { joboClient } from './client'
import { joboOutput, type SignalRecord } from './output'
import { joboSignals } from './signals'

async function readSignals({ apiKey, path, keys, values }: ReadSignalsParams): Promise<SignalPage> {
  const query = joboSignals.toSignalsQuery({ values, keys })
  const cursor = joboSignals.readCursor(values['cursor'])
  const body = await joboClient.readBilledPage({
    apiKey,
    path,
    query: { ...query, limit: joboSignals.readLimit(values['limit']), ...(cursor ? { cursor } : {}) },
  })
  const page: Record<string, unknown> = typeof body === 'object' && body !== null && !Array.isArray(body) ? { ...body } : {}
  const signals: unknown[] = Array.isArray(page['signals']) ? page['signals'] : []
  const nextCursor = page['next_cursor']
  return {
    signals: signals.map((signal) => joboOutput.flattenSignal(signal)),
    has_more: page['has_more'] === true,
    next_cursor: typeof nextCursor === 'string' && nextCursor !== '' ? nextCursor : null,
  }
}

type ReadSignalsParams = {
  apiKey: string
  path: string
  keys: readonly string[]
  values: Record<string, unknown>
}

type SignalPage = {
  signals: SignalRecord[]
  has_more: boolean
  next_cursor: string | null
}

export const joboSignalPage = {
  readSignals,
}

export type { SignalPage }
