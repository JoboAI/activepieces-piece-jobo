import { createAction, Property } from '@activepieces/pieces-framework'
import { JoboApiError } from '@jobo-ai/connector-core'
import { joboAuth } from '../auth'
import { joboClient } from '../common/client'
import { joboOutput } from '../common/output'

export const getJob = createAction({
  auth: joboAuth,
  name: 'get_job',
  classification: 'READ',
  displayName: 'Get Job by ID',
  description: 'Gets one job by its Jobo job ID. This lookup is free.',
  audience: 'both',
  aiMetadata: {
    description:
      'Fetch one job by its Jobo job ID, as returned by Search Jobs or the New Job trigger. Free of charge and safe to repeat. Fails when no job has that ID.',
    idempotent: true,
  },
  props: {
    job_id: Property.ShortText({
      displayName: 'Job ID',
      description:
        'The ID of the job, for example 7c9e6679-7425-40de-944b-e07fc1f90ae7. Map **Job ID** from the New Job trigger or a Search Jobs step.',
      required: true,
    }),
  },
  async run(context) {
    const id = context.propsValue.job_id.trim()
    if (id === '') {
      throw new Error('Enter the ID of the job to look up.')
    }

    return joboClient.withJobo({
      apiKey: context.auth.secret_text,
      run: async (client) => {
        try {
          const { data } = await client.getJob(id)
          return joboOutput.flattenJob(data)
        }
        catch (error) {
          if (error instanceof JoboApiError && error.status === 404 && !joboClient.isNotAvailableInSandbox(error)) {
            throw new Error(`No job was found with the ID "${id}". It may have expired, or the ID may be wrong.`)
          }
          throw error
        }
      },
    })
  },
})
