import { createAction, Property } from '@activepieces/pieces-framework'
import { joboAuth } from '../auth'
import { joboClient } from '../common/client'
import { joboConstants } from '../common/constants'
import { joboOutput } from '../common/output'

export const findCompany = createAction({
  auth: joboAuth,
  name: 'find_company',
  classification: 'SEARCH',
  displayName: 'Find Company',
  description:
    'Finds companies by the first letters of their name or website domain, with how many open jobs each has. This lookup is free.',
  audience: 'both',
  aiMetadata: {
    description:
      'Look up companies by the start of a name or website domain, returning each company ID and its open job count. Free and safe to repeat. ' +
      'Use it to find the company IDs to pass to Search Jobs or the New Job trigger.',
    idempotent: true,
  },
  props: {
    query: Property.ShortText({
      displayName: 'Company Name or Domain',
      description: `The first letters of a company name, such as "acme", or its website domain, such as "example.com". At least ${joboConstants.SUGGEST_MIN_QUERY_LENGTH} characters.`,
      required: true,
    }),
    limit: Property.Number({
      displayName: 'Maximum Companies',
      description: `How many companies to return, 1 to ${joboConstants.COMPANY_SUGGEST_MAX}. Companies with open jobs come first.`,
      required: false,
      defaultValue: joboConstants.COMPANY_SUGGEST_DEFAULT,
      display: 'stepper',
      min: 1,
      max: joboConstants.COMPANY_SUGGEST_MAX,
      step: 1,
    }),
  },
  async run(context) {
    const query = context.propsValue.query.trim()
    if (query.length < joboConstants.SUGGEST_MIN_QUERY_LENGTH) {
      throw new Error(`Enter at least ${joboConstants.SUGGEST_MIN_QUERY_LENGTH} characters of a company name or website domain.`)
    }
    const limit = readLimit(context.propsValue.limit)

    return joboClient.withJobo({
      apiKey: context.auth.secret_text,
      run: async (client) => {
        const { data } = await client.suggestCompanies(query, limit)
        return (data.suggestions ?? []).map(joboOutput.flattenCompany)
      },
    })
  },
})

function readLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return joboConstants.COMPANY_SUGGEST_DEFAULT
  return Math.min(Math.floor(value), joboConstants.COMPANY_SUGGEST_MAX)
}
