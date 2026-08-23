# Devin

> Reverse-engineered from Devin CLI credentials and Devin app state. May change without notice.

## Overview

- **Vendor:** Cognition / Devin
- **Protocol:** Connect RPC v1, JSON over HTTPS
- **Service:** `exa.seat_management_pb.SeatManagementService`
- **Auth:** local Devin session token (`devin-session-token$...`)
- **Quota:** weekly quota percentage, optional daily quota, ACU, and credits
- **Extra:** overage balance in micros, on-demand/flex credits
- **Requires:** `devin auth login` or a signed-in Devin app

UsagePal does not use `api.devin.ai` for this provider. Devin's public API usage and consumption endpoints are enterprise/admin APIs and do not expose the same local account quota shown in the app.

## Auth Sources

The plugin checks auth in this order:

1. Devin CLI credentials file
2. Devin app SQLite state
3. Devin - Next app SQLite state

The plugin skips duplicate API keys, so a stale token in one install does not mask a valid token in another.

| Platform | CLI credentials | App state DB |
|---|---|---|
| macOS | `~/.local/share/devin/credentials.toml` | `~/Library/Application Support/{Devin,Devin - Next}/User/globalStorage/state.vscdb` |
| Linux | `~/.local/share/devin/credentials.toml` | `~/.config/{Devin,Devin - Next}/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%\devin\credentials.toml` | `%APPDATA%\{Devin,Devin - Next}\User\globalStorage\state.vscdb` |

CLI credentials:

```toml
windsurf_api_key = "devin-session-token$..."
api_server_url = "https://server.codeium.com"
devin_api_url = "https://api.devin.ai"
```

Only `windsurf_api_key` and `api_server_url` are used. If `api_server_url` is missing or invalid, the plugin uses `https://server.codeium.com`.

App SQLite:

```bash
sqlite3 "~/Library/Application Support/Devin/User/globalStorage/state.vscdb" \
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

| Response field | Display |
|---|---|
| `userStatus.planStatus.planInfo.planName` | Plan label |
| `userStatus.planStatus.dailyQuotaRemainingPercent` | Daily quota percent |
| `userStatus.planStatus.weeklyQuotaRemainingPercent` | Weekly quota percent |
| `userStatus.planStatus.dailyQuotaResetAtUnix` | Daily reset time |
| `userStatus.planStatus.weeklyQuotaResetAtUnix` | Weekly reset time |
| `userStatus.planStatus.overageBalanceMicros` | Extra usage balance |
| `userStatus.planStatus.acuConsumed` / `acuLimit` | ACU used percent |
| `userStatus.planStatus.availablePromptCredits` / `usedPromptCredits` | Prompt credits |
| `userStatus.planStatus.availableFlowCredits` / `usedFlowCredits` | Flow credits |
| `userStatus.planStatus.availableFlexCredits` / `usedFlexCredits` | On-demand credits |
| `userStatus.planStatus.planStart` / `planEnd` | Plan period for ACU/credit reset timers |
| `userStatus.planStatus.planInfo.hideDailyQuota` | Hide daily quota line when `true` |

When `weeklyQuotaRemainingPercent` is missing and `hideDailyQuota` is `true`, the plugin maps `dailyQuotaRemainingPercent` onto the weekly line as a last resort. This fallback is logged.

A credit value of `-1` is treated as unlimited.

## Plugin Strategy

1. Read CLI credentials.
2. Read Devin app SQLite auth if CLI credentials are missing or fail.
3. Read Devin - Next app SQLite auth if stable Devin auth fails.
4. POST `GetUserStatus` with `ideName: "devin"`.
5. Build lines: ACU used, weekly quota, daily quota (unless hidden), prompt/flow/on-demand credits, extra usage balance, and a pace badge.
6. If auth fails, show: `Run devin auth login or sign in to Devin and try again.`
