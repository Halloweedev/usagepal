# Devin

> Reverse-engineered from Devin CLI credentials and Devin app state. May change without notice.

## Overview

- **Vendor:** Cognition / Devin
- **Protocol:** Connect RPC v1, JSON over HTTPS
- **Service:** `exa.seat_management_pb.SeatManagementService`
- **Auth:** local Devin session token (`devin-session-token$...`)
- **Quota:** weekly quota percentage
- **Extra:** overage balance in micros
- **Requires:** `devin auth login` or a signed-in Devin app

UsagePal does not use `api.devin.ai` for this provider. Devin's public API usage and consumption endpoints are enterprise/admin APIs and do not expose the same local account quota shown in the app.

## Auth Sources

The plugin checks auth in this order:

| Order | Source | Path / key |
|---|---|---|
| 1 | Devin CLI | `~/.local/share/devin/credentials.toml` |
| 2 | Devin app | `~/Library/Application Support/Devin/User/globalStorage/state.vscdb` / `windsurfAuthStatus` |

CLI credentials:

```toml
windsurf_api_key = "devin-session-token$..."
api_server_url = "https://server.codeium.com"
devin_api_url = "https://api.devin.ai"
```

Only `windsurf_api_key` and `api_server_url` are used. If `api_server_url` is missing or invalid, the plugin uses `https://server.codeium.com`.

App SQLite:

```bash
sqlite3 ~/Library/Application\ Support/Devin/User/globalStorage/state.vscdb \
  "SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus'"
```

The value is JSON:

```json
{ "apiKey": "devin-session-token$..." }
```

## GetUserStatus

```http
POST https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus
Content-Type: application/json
Connect-Protocol-Version: 1
```

Request:

```json
{
  "metadata": {
    "apiKey": "devin-session-token$...",
    "ideName": "devin",
    "ideVersion": "1.108.2",
    "extensionName": "devin",
    "extensionVersion": "1.108.2",
    "locale": "en"
  }
}
```

Response fields used:

Observed response shape, sanitized:

```json
{
  "userStatus": {
    "teamsTier": "TEAMS_TIER_DEVIN_MAX",
    "planStatus": {
      "planInfo": {
        "planName": "Max",
        "teamsTier": "TEAMS_TIER_DEVIN_MAX",
        "hideDailyQuota": true,
        "isDevin": true,
        "billingStrategy": "BILLING_STRATEGY_QUOTA"
      },
      "availablePromptCredits": -1,
      "dailyQuotaRemainingPercent": 100,
      "overageBalanceMicros": "1829587876",
      "dailyQuotaResetAtUnix": "1780560000",
      "weeklyQuotaResetAtUnix": "1780819200"
    }
  },
  "planInfo": {
    "planName": "Max",
    "hideDailyQuota": true,
    "isDevin": true
  }
}
```

Response fields used:

| Response field | Display |
|---|---|
| `userStatus.planStatus.planInfo.planName` | Plan label |
| `userStatus.planStatus.dailyQuotaRemainingPercent` | Weekly quota percent when `hideDailyQuota` is `true` and no weekly percent is present |
| `userStatus.planStatus.weeklyQuotaRemainingPercent` | Weekly quota percent if Devin starts returning it |
| `userStatus.planStatus.dailyQuotaResetAtUnix` | Daily reset time when daily quota is visible |
| `userStatus.planStatus.weeklyQuotaResetAtUnix` | Weekly reset time |
| `userStatus.planStatus.overageBalanceMicros` | Extra usage balance |
| `userStatus.planStatus.planInfo.hideDailyQuota` | Hide daily quota line when `true` |

Devin currently returns no `weeklyQuotaRemainingPercent` field in the observed payload. When `hideDailyQuota` is `true`, UsagePal maps `dailyQuotaRemainingPercent` as a used percentage on the visible weekly line and uses `weeklyQuotaResetAtUnix` for the reset timer. Despite the field name, `100` matches Devin's `Weekly quota: 100%` UI, not `100% left`.

## Plugin Strategy

1. Read CLI credentials.
2. Read Devin app SQLite auth if CLI credentials are missing or different.
3. POST `GetUserStatus` with `ideName: "devin"`.
4. Build weekly quota and extra balance lines. Show daily quota only if Devin does not mark it hidden.
5. If auth fails, show: `Run devin auth login or sign in to Devin and try again.`
