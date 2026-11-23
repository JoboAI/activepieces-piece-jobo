import { createAction, Property } from '@activepieces/pieces-framework'
import { joboAuth } from '../auth'
import { joboClient } from '../common/client'
import { joboConstants } from '../common/constants'
import { joboOutput, type GeocodedLocation } from '../common/output'

export const geocodeLocation = createAction({
  auth: joboAuth,
  name: 'geocode_location',
  classification: 'READ',
  displayName: 'Geocode Location',
  description:
    'Finds the city, region, country and coordinates of a place name. Each lookup is billed, whether or not the place is found.',
  audience: 'both',
  aiMetadata: {
    description:
      'Resolve a free-text place such as "San Francisco, CA" into normalized city, region, country and coordinates. ' +
      'Each lookup is billed even when nothing is found, which returns an empty list. Needs a live API key.',
    idempotent: true,
  },
  props: {
    location: Property.ShortText({
      displayName: 'Location',
      description: `A city, region or country to look up, such as "San Francisco, CA". Each lookup is billed, whether or not the place is found; see the [pricing page](${joboConstants.PRICING_URL}). Needs a live API key.`,
      required: true,
    }),
  },
  async run(context) {
    const input = context.propsValue.location.trim()
    if (input === '') {
      throw new Error('Enter a place to look up, such as a city, region or country.')
    }

    return joboClient.withJobo({
      apiKey: context.auth.secret_text,
      run: async (client) => {
        const { data } = await client.geocode(input)
        if (data['succeeded'] !== true) return []
        const locations = readLocations(data['locations'])
        return locations.map((location) => joboOutput.flattenLocation({ location, input }))
      },
    })
  },
})

function readLocations(value: unknown): GeocodedLocation[] {
  return Array.isArray(value) ? value.filter(isLocation) : []
}

function isLocation(value: unknown): value is GeocodedLocation {
  return typeof value === 'object' && value !== null
}
