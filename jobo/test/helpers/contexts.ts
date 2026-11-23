import { createMockActionContext } from '@activepieces/pieces-framework'
import { authValue, memoryStore } from './mock-api'

export function actionContext(propsValue: Record<string, unknown>, secret?: string) {
  const base = createMockActionContext({ propsValue })
  return { ...base, auth: authValue(secret), propsValue }
}

export function triggerContext({
  propsValue,
  store = memoryStore(),
  isRepublish,
}: {
  propsValue: Record<string, unknown>
  store?: ReturnType<typeof memoryStore>
  isRepublish?: boolean
}) {
  const base = createMockActionContext({ propsValue })
  return {
    ...base,
    auth: authValue(),
    propsValue,
    store,
    isRepublish,
    setSchedule: () => undefined,
    files: base.files,
    server: base.server,
  }
}
