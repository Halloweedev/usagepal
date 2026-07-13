# ClinePass

Tracks your [ClinePass](https://cline.bot) subscription usage and prepaid balance.

## What it tracks

| Metric | Meaning |
|---|---|
| Session | 5-hour rolling usage percentage (same as the Cline dashboard's 5-Hour bar) |
| Weekly | 7-day rolling usage percentage (same as the dashboard's Weekly bar) |
| Monthly | Billing-period usage percentage (same as the dashboard's Monthly bar) |
| Balance | Prepaid credits remaining (in dollars) |
| Plan | "Cline Pass (Monthly)" when a subscription is active |

## Share Graph

When the usages API returns history, the plugin also emits share-graph lines:

- **Today / Yesterday / Last 30 Days** — spend totals plus token counts from `/api/v1/users/{id}/usages`
- **Usage Trend** — daily token bar chart for the last 31 days
- **Per-model breakdown** — one text line per model with 30-day share and Today/Yesterday/7d/30d spend

Model names are prettified for display (for example `glm-5.2` → `GLM 5.2`, `gpt-5.4` → `GPT 5.4`).

Costs come from each transaction's `costUsd` field (or `creditsUsed` when absent), stored in **micro-USD** (1/1,000,000 of a dollar — the same unit the Cline app uses for usage history) and converted to dollars for display. If the usages endpoint is unavailable, progress bars and balance still work; share-graph lines are omitted.

## Where credentials come from

ClinePass is the subscription tier of [Cline](https://cline.bot). The plugin reads your auth token
from one of these places (checked in this order, first match wins):

1. **Cline config file:** `~/.cline/data/settings/providers.json`

   The token lives under `providers.cline.settings.auth.accessToken` (set automatically when you
   sign in to Cline in VS Code). It has the form `workos:eyJ...` — the `workos:` prefix is Cline's
   internal auth-provider tag and is stripped before sending. Access tokens expire (typically after
   1 hour); the plugin refreshes them automatically using the stored refresh token via WorkOS, so
   you don't need to keep VS Code open. The refreshed token is written back to the config file.

2. **Environment variable:** set `CLINE_API_KEY` in your shell profile (e.g. `~/.zshrc`). Create a
   key at [app.cline.bot](https://app.cline.bot) → Settings → API Keys. On launch the app reads
   your login shell's environment, so a key exported there is picked up even when the app is started
   from Finder or the Dock. API keys don't expire and need no refresh.

## Troubleshooting

- **"No Cline auth token found"** — sign in to Cline in VS Code, or set `CLINE_API_KEY`.
- **"Cline auth token invalid"** — the token was rejected (401). If you're using the config file
  path, sign in again in Cline so a fresh token is stored. If you're using `CLINE_API_KEY`, recreate
  your API key at app.cline.bot.

## Under the hood

REST calls with a `Bearer` token against `https://api.cline.bot`:

- `GET /api/v1/users/me` — your user ID (needed for the balance endpoint).
- `GET /api/v1/users/me/plan/usage-limits` — pre-computed usage percentages and reset times for the
  5-hour, weekly, and monthly windows. This is the same endpoint the Cline dashboard uses to render
  its progress bars. The response contains a `limits` array with `{ type, percentUsed, resetsAt }`
  entries.
- `GET /api/v1/users/{id}/balance` — prepaid balance in micro-USD (1/1,000,000 of a dollar).
- `GET /api/v1/users/{id}/usages` — usage transaction history with per-model `costUsd` (micro-USD) and `totalTokens` (share graph).
- `GET /api/v1/users/me/plan` — subscription period and plan display name (best-effort).

The balance is returned in **micro-USD** (1/1,000,000 of a dollar) and converted to dollars for
display. The progress bar percentages come directly from the usage-limits endpoint, so they always
match what the Cline dashboard shows.

When the OAuth access token is expired, a `POST` to WorkOS
(`https://api.workos.com/user_management/token` with the refresh token) exchanges it for a fresh
one before any API calls are made.
