import { createCustomApiCallAction } from '@activepieces/pieces-common'
import { createPiece, PieceCategory } from '@activepieces/pieces-framework'
import { findCompany } from './lib/actions/find-company'
import { geocodeLocation } from './lib/actions/geocode-location'
import { getJob } from './lib/actions/get-job'
import { searchJobs } from './lib/actions/search-jobs'
import { joboAuth } from './lib/auth'
import { joboConstants } from './lib/common/constants'
import { newJob } from './lib/triggers/new-job'

export const jobo = createPiece({
  displayName: 'Jobo',
  description:
    'Search and monitor open jobs from employer career sites and applicant tracking systems with the Jobo jobs data API.',
  auth: joboAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/jobo.png',
  categories: [PieceCategory.HUMAN_RESOURCES],
  authors: [],
  actions: [
    searchJobs,
    getJob,
    findCompany,
    geocodeLocation,
    createCustomApiCallAction({
      auth: joboAuth,
      baseUrl: () => joboConstants.BASE_URL,
      authMapping: async (auth) => ({
        'X-Api-Key': auth.secret_text,
      }),
    }),
  ],
  triggers: [newJob],
})
