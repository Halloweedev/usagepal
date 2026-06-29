/**
 * App-owner referral links, keyed by provider id (the plugin folder name).
 * Fill in the URLs you have referral links for and leave the rest blank — a
 * provider with no http(s) URL here simply shows no referral pill.
 *
 * Example:  cursor: "https://cursor.com/?ref=yourcode",
 */
export const REFERRAL_LINKS: Record<string, string> = {
  amp: "",
  antigravity: "",
  claude: "",
  codex: "",
  copilot: "",
  cursor: "",
  devin: "",
  factory: "",
  grok: "",
  "jetbrains-ai-assistant": "",
  kimi: "",
  kiro: "",
  minimax: "",
  "opencode-go": "",
  perplexity: "",
  synthetic: "",
  zai: "",
}

/**
 * Resolve a provider's referral URL. Returns the trimmed URL only when it is
 * configured and is an http(s) link; otherwise undefined (so no pill renders).
 */
export function getReferralUrl(providerId: string): string | undefined {
  const url = REFERRAL_LINKS[providerId]?.trim()
  if (!url) return undefined
  if (!url.startsWith("https://") && !url.startsWith("http://")) return undefined
  return url
}
