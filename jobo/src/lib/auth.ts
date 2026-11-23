import { PieceAuth } from '@activepieces/pieces-framework'
import { isValidApiKeyFormat } from '@jobo-ai/connector-core'
import { joboClient } from './common/client'
import { joboConstants } from './common/constants'

export const joboAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: `To get your API key:

1. Sign in to the [Jobo dashboard](${joboConstants.API_KEYS_URL}).
2. Open **Developers > API Keys** and create a key.
3. Paste the key here. It starts with \`jbe_live_\`.

New accounts get a free starting balance when they verify their email address, enough to try the piece. Searching jobs and the New Job trigger are billed per job, see the [pricing page](${joboConstants.PRICING_URL}). Checking this connection is free.`,
  required: true,
  validate: async ({ auth }) => {
    if (!isValidApiKeyFormat(auth)) {
      return { valid: false, error: joboClient.INVALID_KEY_MESSAGE }
    }
    try {
      await joboClient.withJobo({
        apiKey: auth,
        run: async (client) => {
          try {
            await client.filters()
          }
          catch (error) {
            if (!joboClient.isNotAvailableInSandbox(error)) throw error
          }
        },
      })
      return { valid: true }
    }
    catch (error) {
      return { valid: false, error: describeFailure(error) }
    }
  },
})

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not check the API key.'
}
