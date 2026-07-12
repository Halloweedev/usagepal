# Grok

Tracks Grok Build credit usage from the local Grok CLI login. This single provider covers **SuperGrok**, **SuperGrok Heavy**, and **X Premium+** subscribers — there is no separate SuperGrok plugin.

> Reverse-engineered, undocumented API. May change without notice.

## Overview

- **Protocol:** REST (plain JSON)
- **Base URL:** `https://cli-chat-proxy.grok.com/v1`
- **Auth:** cached Grok CLI token from `~/.grok/auth.json`
- **Refresh:** Grok CLI refresh token from the same file
- **Usage unit:** raw billing units from Grok
- **Plan source:** `GET /settings` (`subscription_tier_display`)
- **Reset period:** billing period from the CLI billing response

## SuperGrok

SuperGrok subscribers use the **same data path** as pay-as-you-go Grok Build users:

| Data | Path |
|------|------|
| Auth | `~/.grok/auth.json` (created by `grok login`) |
| Billing credits | `GET https://cli-chat-proxy.grok.com/v1/billing` |
| Plan label | `GET https://cli-chat-proxy.grok.com/v1/settings` → `subscription_tier_display` (e.g. `SuperGrok`, `SuperGrok Heavy`) |
| Share graph / model breakdown | `~/.grok/logs/unified.jsonl` (or `$GROK_HOME/logs/unified.jsonl`) |

A web-only SuperGrok subscription does **not** populate UsagePal by itself. Run `grok login` once so the CLI auth file exists, then enable the Grok plugin. After that:

- **Provider card & overview** show your subscription tier and included-credit usage from the billing API.
- **Share graph** estimates CLI spend from `unified.jsonl` (Today, Yesterday, Last 30 Days, per-model lines). Usage on grok.com that never goes through the CLI is not in that log.

X Premium+ subscribers with bundled Grok Build access follow the same flow.

## Setup

1. Install and sign in to the Grok CLI (works for SuperGrok, SuperGrok Heavy, and X Premium+):

```bash
grok login
```

2. Enable the Grok plugin in UsagePal settings.

UsagePal reads the same local auth file that the Grok CLI uses. Access tokens are refreshed automatically before expiry when a `refresh_token` is present. If refresh fails, run `grok login` again.

## Endpoint

### GET /billing

Returns the current Grok Build billing period, credit usage, and pay-as-you-go cap.

#### Headers

| Header | Required | Value |
|--------|----------|-------|
| Authorization | yes | `Bearer <token from ~/.grok/auth.json>` |
| X-XAI-Token-Auth | yes | `xai-grok-cli` |
| Accept | yes | `application/json` |

#### Response

```json
{
  "config": {
    "monthlyLimit": { "val": 60000 },
    "used": { "val": 4277 },
    "onDemandCap": { "val": 0 },
    "billingPeriodStart": "2026-05-01T00:00:00+00:00",
    "billingPeriodEnd": "2026-06-01T00:00:00+00:00",
    "history": [
      {
        "billingCycle": { "year": 2026, "month": 4 },
        "includedUsed": { "val": 0 },
        "onDemandUsed": { "val": 0 },
        "totalUsed": { "val": 0 }
      }
    ]
  }
}
```

### GET /settings

Returns remote CLI settings. UsagePal reads `subscription_tier_display` from this response and shows it as the provider plan label, for example `SuperGrok Heavy`.

Used fields:

- `used.val` — current billing period usage
- `monthlyLimit.val` — included credit limit
- `onDemandCap.val` — pay-as-you-go cap; `0` or omitted means disabled (typical for subscription-only accounts)
- `billingPeriodEnd` — current billing period reset time

## Displayed Lines

| Line | Description |
|------|-------------|
| Credits used | Percent of included monthly credits used |
| Pay as you go | Disabled, or the configured pay-as-you-go cap |

## Share Graph

When `~/.grok/logs/unified.jsonl` exists (or `$GROK_HOME/logs/unified.jsonl`), UsagePal also estimates local spend for the Share graph:

- **Today / Yesterday / Last 30 Days** — dollar and token totals priced from embedded `GROK_PRICING` rates (unknown models count toward tokens at $0)
- **Usage Trend** — daily token bar chart for the last 31 days
- **Per-model breakdown** — one text line per model with 30-day share and Today/Yesterday/7d/30d spend (spend segments omitted when $0)

Token rows come from `shell.turn.inference_done` events; model attribution uses per-process (`pid`) timelines from the CLI's model-change events. If the log is missing or unreadable, billing lines still render and share-graph lines are omitted.

## Errors

| Condition | Message |
|-----------|---------|
| Missing auth file | "Grok not logged in. Run `grok login`." |
| Expired token with no refresh token | "Grok auth expired. Run `grok login` again." |
| Refresh token rejected | "Grok auth expired. Run `grok login` again." |
| 401/403 after retry | "Grok auth expired. Run `grok login` again." |
| HTTP error | "Grok billing request failed (HTTP {status}). Try again later." |
| Network error | "Grok billing request failed. Check your connection." |
| Invalid response | "Grok billing response changed." |
