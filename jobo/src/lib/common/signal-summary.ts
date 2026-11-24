import { joboSignals } from './signals'

function signalTypeLabel(type: unknown): string {
  const name = typeof type === 'string' ? type : ''
  const known = joboSignals.SIGNAL_TYPE_LABELS[name]
  if (known) return known
  const words = name.replace(/_/g, ' ').trim()
  return words.length === 0 ? 'Signal' : words.charAt(0).toUpperCase() + words.slice(1)
}

function round({ value, digits }: { value: number, digits: number }): number {
  const factor = 10 ** digits
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor
}

function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function whole(value: number): string {
  return grouped(String(round({ value, digits: 0 })))
}

function decimal(value: number): string {
  const [integer = '0', fraction] = String(round({ value, digits: 1 })).split('.')
  return fraction ? `${grouped(integer)}.${fraction}` : grouped(integer)
}

function counted({ count, noun }: { count: number, noun: string }): string {
  return Math.abs(count - 1) < 0.0001 ? `1 ${noun}` : `${whole(count)} ${noun}s`
}

function lookback(days: number | null): string {
  if (days === null || days <= 0) return 'six months'
  if (days < 60) return `${whole(days)} days`
  const months = round({ value: days / 30, digits: 0 })
  return months === 6 ? 'six months' : `${months} months`
}

function describeSignal({ type, details }: { type: unknown, details: unknown }): string {
  if (!isRecord(details)) return signalTypeLabel(type)

  const number = (name: string): number | null => {
    const value = details[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const text = (name: string): string | null => {
    const value = details[name]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }

  const newJobs = number('new_jobs')
  const period = lookback(number('lookback_days'))

  switch (type) {
    case 'hiring_surge': {
      const baseline = number('baseline_weekly_avg')
      if (newJobs === null || baseline === null) break
      return `${counted({ count: newJobs, noun: 'new job' })} this week vs ${decimal(baseline)} a week normally`
    }
    case 'hiring_slowdown': {
      const now = number('open_roles')
      const before = number('open_roles_before')
      if (now === null || before === null) break
      const drop = Math.abs(number('change_pct') ?? 0)
      const day = text('compared_to')
      return `Open roles down ${decimal(drop)}%${day ? ` since ${day}` : ''}: ${whole(now)} now, ${whole(before)} then`
    }
    case 'new_function': {
      const category = text('category')
      if (!category) break
      return newJobs !== null && newJobs > 1
        ? `${counted({ count: newJobs, noun: 'new job' })} in ${category}, a first in ${period}`
        : `First ${category} job in ${period}`
    }
    case 'new_country': {
      const country = text('country')
      if (!country) break
      return newJobs !== null && newJobs > 1
        ? `${counted({ count: newJobs, noun: 'new job' })} in ${country}, a first in ${period}`
        : `First job in ${country} in ${period}`
    }
    case 'new_skill': {
      const skill = text('skill')
      if (!skill) break
      return newJobs !== null && newJobs > 1
        ? `${whole(newJobs)} new jobs ask for ${skill}, a first in ${period}`
        : `First job asking for ${skill} in ${period}`
    }
    case 'leadership_hire': {
      const title = text('title')
      if (!title) break
      return `Hiring a leader: ${title}`
    }
    case 'first_role': {
      const occupation = text('occupation')
      if (!occupation) break
      return `First ${occupation} role`
    }
    case 'new_technology': {
      const technology = text('technology')
      if (!technology) break
      const role = text('title')
      return role ? `First mention of ${technology}, in a ${role} role` : `First mention of ${technology}`
    }
    case 'function_surge': {
      const category = text('category')
      const usual = number('baseline_avg')
      if (!category || newJobs === null || usual === null) break
      const days = number('window_days')
      return `${counted({ count: newJobs, noun: `new ${category} job` })} in ${days !== null ? `${whole(days)} days` : 'two weeks'} vs ${decimal(usual)} normally`
    }
    case 'new_city': {
      const city = text('city')
      if (!city) break
      const region = text('region')
      const place = region ? `${city}, ${region}` : city
      return newJobs !== null && newJobs > 1
        ? `${counted({ count: newJobs, noun: 'new job' })} in ${place}, a first there`
        : `First job in ${place}`
    }
    case 'hard_to_fill': {
      const title = text('title')
      const open = number('days_open')
      if (!title || open === null) break
      const city = text('city')
      const at = city ? ` (${city})` : ''
      if (text('reason') !== 'reposted') return `${title}${at} open ${counted({ count: open, noun: 'day' })}`
      const closed = number('closed_days')
      return closed !== null && closed > 0
        ? `${title}${at} re-posted after ${counted({ count: closed, noun: 'day' })} closed`
        : `${title}${at} re-posted`
    }
    case 'leadership_role_closed': {
      const title = text('title')
      const open = number('days_open')
      if (!title || open === null) break
      return `${title} search closed after ${counted({ count: open, noun: 'day' })}`
    }
    case 'hiring_freeze': {
      const removed = number('closed_jobs')
      const had = number('open_roles_before')
      if (removed === null || had === null) break
      const last = text('closed_to')
      return `${whole(removed)} of ${counted({ count: had, noun: 'open role' })} removed${last ? ` in the week to ${last}` : ''}`
    }
    case 'hiring_resumed': {
      const gap = number('gap_days')
      if (gap === null) break
      return `First new job in ${counted({ count: gap, noun: 'day' })}`
    }
    default:
      break
  }

  return signalTypeLabel(type)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const joboSignalSummary = {
  signalTypeLabel,
  describeSignal,
}
