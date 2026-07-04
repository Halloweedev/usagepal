export type ModelBreakdownParsed = {
  percent: string
  today?: string
  sevenDay?: string
  thirtyDay?: string
}

export type ModelDisplayOptions = {
  showPercent: boolean
  showToday: boolean
  showSevenDay: boolean
  showThirtyDay: boolean
}

// Leading "<" matches the "<0.1%" label producers use for near-zero shares.
const PERCENT_PREFIX = /^(<?\d+(?:\.\d+)?%)(?: · (.+))?$/

export function parseModelBreakdownValue(value: string): ModelBreakdownParsed | null {
  const match = value.match(PERCENT_PREFIX)
  if (!match) return null

  const parsed: ModelBreakdownParsed = { percent: match[1] }
  const rest = match[2]
  if (!rest) return parsed

  for (const segment of rest.split(" · ")) {
    if (segment.startsWith("Today ")) parsed.today = segment.slice("Today ".length)
    else if (segment.startsWith("7d ")) parsed.sevenDay = segment.slice("7d ".length)
    else if (segment.startsWith("30d ")) parsed.thirtyDay = segment.slice("30d ".length)
  }

  return parsed
}
