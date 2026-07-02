# OpenRouter

Tracks your [OpenRouter](https://openrouter.ai) credit balance and spend from your account API key.

## What it tracks

| Metric | Meaning |
|---|---|
| Credits | Lifetime spend against the credits you've purchased (a dollar meter) |
| Balance | Prepaid credits remaining |
| Today | Spend so far today |
| This Week | Spend so far this week |
| This Month | Spend so far this month |
| Key Limit | Spend against this key's cap — shown only when the key has one configured |
| Plan | "Pay as you go" or "Free tier" |

## Where credentials come from

Unlike the CLI-backed providers, OpenRouter has no companion app that leaves a credential on your
machine, so you supply an API key. Create one at [openrouter.ai/keys](https://openrouter.ai/keys),
then provide it one of these ways (checked in this order, first match wins):

1. **Settings → API Keys (recommended):** paste the key into the OpenRouter field and Save. It's
   written to the config file below and picked up on the next refresh. The saved key is never read
   back into the app — the API Keys card only knows whether a key is present, not its value.

2. **Config file:** `~/.config/usagepal/openrouter.json` (the file the Settings card writes)

   ```json
   { "apiKey": "sk-or-v1-..." }
   ```

   A plain-text file containing just the key, or `~/.config/openrouter/key.json`, also work.

3. **Environment variable:** set `OPENROUTER_API_KEY` (or `OPENROUTER_KEY`) in your shell profile
   (e.g. `~/.zshrc` or `~/.zprofile`). On launch the app reads your login shell's environment, so a
   key exported there is picked up even when the app is started from Finder or the Dock — not just
   when run from a terminal.

The config file is checked before the environment, so a key saved in the app wins over a stale env
var. Clearing the saved key in Settings falls back to the environment key, or to none.

## Troubleshooting

- **"No OpenRouter API key"** — add the key to the config file or environment variable, then refresh.
- **"API key invalid"** — the key was rejected (401/403). Check or recreate it at openrouter.ai/keys.

## Under the hood

Two REST calls with a `Bearer` token against `https://openrouter.ai/api/v1`:

- `GET /credits` — account-wide `total_credits` and `total_usage`; the Credits meter and Balance come
  from these. Required for a usable snapshot.
- `GET /key` — best-effort: the tier, daily/weekly/monthly spend, and an optional per-key cap. If this
  call fails, the balance still renders from `/credits`.

Both endpoints wrap their payload in `{ "data": { ... } }`. A period spend of `$0.00` is shown as a
real, measured zero (the API reports it directly) rather than "No data".
