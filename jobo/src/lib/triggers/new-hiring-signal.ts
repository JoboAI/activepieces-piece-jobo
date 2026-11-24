import { createTrigger, isNil, Property, StoreScope, TriggerStrategy } from '@activepieces/pieces-framework'
import { joboAuth } from '../auth'
import { joboConstants } from '../common/constants'
import { joboOutput } from '../common/output'
import { joboSignalPoll, type SignalPollState } from '../common/signal-poll'
import { joboSignalProps } from '../common/signal-props'
import { joboSignals } from '../common/signals'

const TRIGGER_FILTER_KEYS = joboSignals.ALL_SIGNAL_FILTER_KEYS.filter((key) => key !== 'created_after')

const NARROWING_TEXT = joboSignals.SIGNAL_FILTERS.filter((filter) => joboSignals.NARROWING_SIGNAL_FILTER_KEYS.includes(filter.key))
  .map((filter) => filter.label)
  .join(', ')

const props = {
  cost_notice: Property.MarkDown({
    value: `**How this trigger is billed.** Every signal it delivers is billed at ten times the price of a job, included signals first, then your wallet; see the [pricing page](${joboConstants.PRICING_URL}). Each check asks only for signals stored after the last one it delivered, so in normal operation a signal is read and billed once. A check that finds nothing is free. Maximum Signals per Poll caps what one check reads and bills; when more are waiting, the next check continues where this one stopped.

Turning the flow on reads nothing: only signals stored after that moment are delivered. Loading sample data makes no request and is free: it shows a fictional signal with the fields a real one has. If a check fails part-way, it saves nothing, and the next check reads the same signals again, which bills them again.

**Set at least one of ${NARROWING_TEXT}.** Without one the trigger would match every hiring signal Jobo detects. It needs a live account API key.`,
  }),
  types: joboSignalProps.types,
  domains: joboSignalProps.domains,
  company_ids: joboSignalProps.companyIds,
  exclude_domains: joboSignalProps.excludeDomains,
  countries: joboSignalProps.countries,
  company_sizes: joboSignalProps.companySizes,
  industries: joboSignalProps.industries,
  categories: joboSignalProps.categories,
  funding_stages: joboSignalProps.fundingStages,
  founded_after: joboSignalProps.foundedAfter,
  exclude_agencies: joboSignalProps.excludeAgencies,
  functions: joboSignalProps.functions,
  roles: joboSignalProps.roles,
  seniority: joboSignalProps.seniority,
  technologies: joboSignalProps.technologies,
  skills: joboSignalProps.skills,
  technology_categories: joboSignalProps.technologyCategories,
  job_countries: joboSignalProps.jobCountries,
  job_regions: joboSignalProps.jobRegions,
  job_cities: joboSignalProps.jobCities,
  min_strength: joboSignalProps.minStrength,
  min_new_jobs: joboSignalProps.minNewJobs,
  min_days_open: joboSignalProps.minDaysOpen,
  reposted_only: joboSignalProps.repostedOnly,
  detected_after: joboSignalProps.detectedAfter,
  detected_before: joboSignalProps.detectedBefore,
  max_signals: joboSignalProps.maxSignalsPerPoll,
}

export const newHiringSignal = createTrigger({
  auth: joboAuth,
  name: 'new_hiring_signal',
  classification: 'READ',
  displayName: 'New Hiring Signal',
  description:
    'Triggers when Jobo stores a new hiring signal matching your filters, such as a hiring surge, a first job in a country or a leadership search. ' +
    'Every signal delivered is billed at ten times the price of a job.',
  aiMetadata: {
    description:
      'Fires once for each hiring signal Jobo stores after the flow is turned on that matches the chosen filters, oldest first. ' +
      'One payload is one flat signal record, the same shape List Hiring Signals returns in its signals list. Each signal is billed at ten times the price of a job.',
  },
  type: TriggerStrategy.POLLING,
  props,
  sampleData: joboOutput.SIGNAL_SAMPLE,
  async onEnable(context) {
    readQuery(context.propsValue)
    const stored = await context.store.get<SignalPollState>(joboConstants.SIGNAL_TRIGGER_STATE_KEY, StoreScope.FLOW)
    if (context.isRepublish && !isNil(stored)) return
    await context.store.put<SignalPollState>(
      joboConstants.SIGNAL_TRIGGER_STATE_KEY,
      { watermark: new Date().toISOString() },
      StoreScope.FLOW,
    )
  },
  async onDisable() {
    return
  },
  async run(context) {
    const query = readQuery(context.propsValue)
    const state = await context.store.get<SignalPollState>(joboConstants.SIGNAL_TRIGGER_STATE_KEY, StoreScope.FLOW)
    const result = await joboSignalPoll.pollSignals({
      apiKey: context.auth.secret_text,
      query,
      state,
      maxSignals: joboSignals.readLimit(context.propsValue.max_signals),
      now: () => new Date(),
    })
    // Saved last, after every page was read and just before the signals are handed back: run() returning is the
    // only way Activepieces is told about them ("each item in the array will trigger the flow to run", triggers
    // overview). A read that throws saves nothing, so the next check repeats it. Not verified in Activepieces'
    // docs: what the engine does with a store write made by a run() whose items it then fails to start.
    if (result.changed) {
      await context.store.put<SignalPollState>(joboConstants.SIGNAL_TRIGGER_STATE_KEY, result.state, StoreScope.FLOW)
    }
    return result.signals.map((signal) => joboOutput.flattenSignal(signal))
  },
  async test(context) {
    // A static sample, no request. Activepieces runs test() each time the user loads sample data, and every
    // signal returned is billed at ten times a job, so a real read would charge on every click. The sample goes
    // through the same flattenSignal as run(), so a flow mapped on it maps the same fields of a real signal.
    // The filters are still checked, so a bad value fails here and not on the first check.
    readQuery(context.propsValue)
    return [joboOutput.SIGNAL_SAMPLE]
  },
})

function readQuery(values: Record<string, unknown>): Record<string, string> {
  const query = joboSignals.toSignalsQuery({ values, keys: TRIGGER_FILTER_KEYS })
  joboSignals.requireNarrowingSignalFilter(query)
  return query
}
