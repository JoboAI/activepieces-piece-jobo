import { createAction } from '@activepieces/pieces-framework'
import { joboAuth } from '../auth'
import { joboSignalPage } from '../common/signal-page'
import { joboSignalProps } from '../common/signal-props'
import { joboSignals } from '../common/signals'

export const listCompanyHiringSignals = createAction({
  auth: joboAuth,
  name: 'list_company_hiring_signals',
  classification: 'SEARCH',
  displayName: 'List Company Hiring Signals',
  description:
    "Lists one company's hiring signals, newest first, by its Jobo company ID. " +
    'Every signal returned is billed at ten times the price of a job, and again each time the same signal is read.',
  audience: 'both',
  aiMetadata: {
    description:
      "List one company's hiring signals (a hiring surge, a new country, a leadership search and more) by its Jobo company ID, " +
      'filtered by type, strength and dates, newest detection day first. ' +
      'Each signal returned is billed at ten times the price of a job and billed again when read again, so keep Maximum Signals small and do not repeat a read. ' +
      'Returns one page: signals as flat records with a one-sentence summary, has_more and next_cursor.',
    idempotent: false,
  },
  props: {
    company_id: joboSignalProps.companyId,
    types: joboSignalProps.types,
    min_strength: joboSignalProps.minStrength,
    detected_after: joboSignalProps.detectedAfter,
    detected_before: joboSignalProps.detectedBefore,
    created_after: joboSignalProps.createdAfter,
    limit: joboSignalProps.limit,
    cursor: joboSignalProps.cursor,
  },
  async run(context) {
    const companyId = joboSignals.readCompanyId(context.propsValue.company_id)
    return joboSignalPage.readSignals({
      apiKey: context.auth.secret_text,
      path: `/api/companies/${encodeURIComponent(companyId)}/signals`,
      keys: joboSignals.COMPANY_SIGNAL_FILTER_KEYS,
      values: { ...context.propsValue },
    })
  },
})
