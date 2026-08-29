# Antigravity

> Reverse-engineered from app bundle and language server binary. May change without notice.

Antigravity is built on Codeium/Windsurf-derived infrastructure and uses the same Codeium language server binary and Connect-RPC protocol. The discovery, port probing, and RPC endpoints are virtually identical to that stack. The key differences: Antigravity uses fraction-based per-model quota (not credits), and doesn't require an API key in the request metadata.

## Overview

- **Vendor:** Google (internal codename "Jetski")
- **Protocol:** Connect RPC v1 (JSON over HTTP) on local language server
- **Service:** `exa.language_server_pb.LanguageServerService`
- **Auth:** CSRF token from app/IDE process args; Google OAuth tokens from SQLite; `agy` token from the macOS Keychain or its token file
- **Quota:** fraction (0.0–1.0, where 1.0 = 100% remaining)
- **Quota window:** 5 hours
- **Timestamps:** ISO 8601
- **Platforms:** macOS, Windows, Linux
- **Requires:** Antigravity app/IDE running, signed-in app/IDE SQLite credentials, or `agy` signed in

## What Antigravity Does Not Report

Antigravity publishes a remaining-quota fraction per model and nothing else. There are **no token
counts, no request counts and no costs** — not in the language server, not in the Cloud Code
endpoints, and not in any local file the IDE or `agy` writes. UsagePal therefore shows no spend for
this provider, and any dollar figure would be invented rather than measured.

## Discovery

The Antigravity app/IDE language server listens on a random localhost port. Three values must be discovered from the running process.

```bash
# 1. Find process and extract CSRF token
#    UsagePal reads the process table directly, which works the same on
#    macOS, Windows and Linux. The shell equivalent on macOS/Linux is:
ps -ax -o pid=,command= | grep -i '[l]anguage_server.*antigravity'
# Process name: language_server plus a per-OS suffix —
#   language_server_macos, language_server_macos_arm,
#   language_server_linux_x64, language_server_windows_x64.exe
# Match: --app_data_dir antigravity / antigravity-ide OR path contains /antigravity/
# Extract: --csrf_token <token>
# Extract: --extension_server_port <port>  (HTTP fallback)

# 2. Find listening ports
#    UsagePal reads the kernel socket table; lsof is only a fallback.
lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>

# 3. Probe each port to find the Connect-RPC endpoint
POST https://127.0.0.1:<port>/.../GetUnleashData  → first 200 OK wins
```

Port and CSRF token change on every app/IDE restart. The LS may use HTTPS with a self-signed cert.

An IDE usually runs several language-server child processes and only one of them listens, so
discovery prefers a process with real listening sockets and falls back to the process that
advertises `--extension_server_port`.

`agy` can also expose the same local service via an `agy` process. It has listening ports but no CSRF token or Antigravity marker flags, so discovery matches the `agy` executable directly.

## Headers (all local requests)

| Header | Required | Value |
|---|---|---|
| Content-Type | yes | `application/json` |
| Connect-Protocol-Version | yes | `1` |
| x-codeium-csrf-token | yes | `<csrf_token>` (from process args) |

## Endpoints

### GetUserStatus (primary)

Returns plan info and per-model quota for all models (Gemini, Claude, GPT-OSS) in a single call.

```
POST http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus
```

#### Request

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

#### Response

```jsonc
{
  "userStatus": {
    "planStatus": {
      "planInfo": {
        "planName": "Pro",                       // "Free" | "Pro" | "Teams" | "Ultra"
        "teamsTier": "TEAMS_TIER_PRO"
      }
    },

    "cascadeModelConfigData": {
      "clientModelConfigs": [
        {
          "label": "Gemini 3 Pro (High)",
          "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M7" },
          "quotaInfo": {
            "remainingFraction": 1,              // 0.0–1.0
            "resetTime": "2026-02-07T14:23:01Z"
          }
        },
        {
          "label": "Claude Sonnet 4.5",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        },
        {
          "label": "Claude Opus 4.5 (Thinking)",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        },
        {
          "label": "GPT-OSS 120B (Medium)",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        }
        // ~7 models total, dynamic
      ]
    }
  }
}
```

### GetCommandModelConfigs (fallback)

Returns model configs with per-model quota only. No plan info, no email. Use when `GetUserStatus` fails.

```
POST http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs
```

#### Request

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

#### Response

```jsonc
{
  "clientModelConfigs": [
    // same shape as GetUserStatus.cascadeModelConfigData.clientModelConfigs
  ]
}
```

## Available Models

| Display Name | Internal ID | Provider |
|---|---|---|
| Gemini 3 Flash | 1018 | Google |
| Gemini 3 Pro (High) | 1008 | Google |
| Gemini 3 Pro (Low) | 1007 | Google |
| Claude Sonnet 4.5 | 333 | Anthropic (proxied) |
| Claude Sonnet 4.5 (Thinking) | 334 | Anthropic (proxied) |
| Claude Opus 4.6 (Thinking) | MODEL_PLACEHOLDER_M26 | Anthropic (proxied) |
| GPT-OSS 120B (Medium) | 342 | OpenAI (proxied) |

Models are dynamic — the list changes as Google adds/removes them. The plugin reads labels from the response, not a hardcoded list.

Interestingly, non-Google models (Claude, GPT-OSS) are proxied through Codeium/Windsurf infrastructure — Antigravity uses the same language server binary as Windsurf. The `GetUserStatus` response also includes `monthlyPromptCredits`, `monthlyFlowCredits`, and `monthlyFlexCreditPurchaseAmount` fields inherited from the Windsurf credit system, but these appear to be completely irrelevant to Antigravity's quota model which is purely fraction-based per model.

## Local SQLite Database

The Antigravity IDE stores auth credentials in VS Code-compatible state databases.

Antigravity IDE is a VS Code fork, so the database lives under the standard user-data directory for
each OS. `Antigravity IDE` is the current folder name and `Antigravity` the pre-2.0 one, still
present on machines that upgraded; both are tried, current first.

- **Paths, by platform:**
  - macOS: `~/Library/Application Support/Antigravity IDE|Antigravity/User/globalStorage/state.vscdb`
  - Linux: `~/.config/Antigravity IDE|Antigravity/User/globalStorage/state.vscdb`
  - Windows: `%APPDATA%\Antigravity IDE|Antigravity\User\globalStorage\state.vscdb`
- **Table:** `ItemTable` (`key` TEXT, `value` TEXT)

The same table also holds a cached `antigravityUnifiedStateSync.userStatus` blob. It is wrapped like
the OAuth value but under a `userStatusSentinelKey` sentinel, and its payload carries no model
display names — only unlabeled numbers — so UsagePal does not use it as an offline fallback.

### antigravityUnifiedStateSync.oauthToken (sentinel envelope → protobuf)

Google OAuth tokens are stored under this key in a double-wrapped base64 envelope.

Decoding layers:

1. Base64-decode the DB `value` → `outer` bytes.
2. `outer` field 1 (wire type 2) → `wrapper` bytes.
3. Inside `wrapper`: field 1 is the sentinel string `"oauthTokenInfoSentinelKey"`; field 2 is `payload` bytes.
4. Inside `payload`: field 1 (wire type 2) is a **UTF-8 base64 string** (not raw bytes).
5. Base64-decode that string → final `OAuthTokenInfo` protobuf.

```protobuf
message OAuthTokenInfo {
  string access_token = 1;              // "ya29...." Google OAuth access token
  string token_type = 2;                // ignored
  string refresh_token = 3;             // "1//..." Google OAuth refresh token
  Timestamp expiry = 4;                 // field 4, wire type 2
}
message Timestamp {
  int64 seconds = 1;                    // Unix epoch seconds
}
```

The plugin decodes this using a minimal protobuf wire-format parser (varint, length-delimited, fixed32, fixed64). The access token is short-lived; the refresh token is used to obtain new access tokens via Google OAuth.

### Token Refresh

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com
&client_secret=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
&refresh_token=<refresh_token>
&grant_type=refresh_token
```

Response: `{ "access_token": "ya29...", "expires_in": 3599 }`

Same client_id/secret is there in the Antigravity app bundle, used for the Google OAuth refresh token.

## Cloud Code API (fallback)

When the language server is not running, the plugin falls back to Google's Cloud Code API using a Google OAuth access token from the unified-state protobuf, a cached refreshed token, or the `agy` keychain account.

### fetchAvailableModels

```
POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
Authorization: Bearer <access_token>
Content-Type: application/json
User-Agent: antigravity
```

Base URLs tried in order:
1. `https://daily-cloudcode-pa.googleapis.com`
2. `https://cloudcode-pa.googleapis.com`

### agy credential fallback

`agy` caches its auth in the OS keyring — service `gemini`, account `antigravity`. UsagePal reads
that exact account only; it does not use legacy Gemini CLI files.

When the keyring is unavailable, `agy` falls back to a token file and drops a marker beside it:

- Token: `~/.gemini/antigravity-cli/antigravity-oauth-token`
- Marker: `~/.gemini/antigravity-cli/cache/antigravity-keyring-unavailable`

This is the normal case on Linux, where a session often has no secret service. UsagePal tries the
keyring first and then the file, so macOS behaviour is unchanged and Linux works without a keyring.
The file may hold a bare token, a `Bearer` value, JSON containing a token field, or a
`go-keyring-base64:` wrapper; all four are accepted.

For `agy`, UsagePal calls:

1. `POST /v1internal:loadCodeAssist`
2. `POST /v1internal:retrieveUserQuota`

#### Response

```jsonc
{
  "models": {
    "gemini-3-pro": {
      "displayName": "Gemini 3 Pro",
      "model": "gemini-3-pro",
      "quotaInfo": {
        "remainingFraction": 0.8,          // 0.0–1.0
        "resetTime": "2026-02-08T10:00:00Z"
      }
    }
    // ... more models
  }
}
```

Returns 401/403 if the token is invalid or expired — triggers reactive refresh.

The response includes all models provisioned for the account. The plugin filters out non-user-facing models using three layers: (1) `isInternal: true` flag from the API, (2) empty `displayName` (catches internal autocomplete models like `chat_20706`, `tab_flash_lite_preview`), and (3) a model-ID blacklist (catches Gemini 2.5 variants and placeholders).

The Cloud Code model set is a superset of the LS model set. The LS returns only cascade-configured chat models, Cloud Code includes all provisioned models. This difference is expected.

## Plugin Strategy

1. Probe the Antigravity app/IDE language server.
2. Probe the `agy` local language server.
3. Read SQLite token candidates from this platform's Antigravity state DB paths.
4. Try unexpired SQLite/cached access tokens with `fetchAvailableModels`.
5. Refresh SQLite refresh tokens only after auth failure or when no access token exists.
6. Read the `agy` token from the keyring, then from its token file, then call `loadCodeAssist` and `retrieveUserQuota`.
7. If no credentials were found anywhere: error "Start Antigravity or run `agy` and try again."
8. If credentials existed but Cloud Code was unreachable or answered with an error: "Can't reach Antigravity right now. Try again shortly."

## What UsagePal Shows

- **Three pool bars** — Gemini Pro, Gemini Flash and Claude, each reporting the worst remaining
  fraction among the models in that pool. Non-Gemini models share one quota bucket, so anything
  that matches no rule is folded into Claude and logged, which is how a new model family shows up.
- **A line per model**, below the pools, at its own remaining fraction. Variants that differ only by
  a suffix — "Gemini 3 Pro (High)" and "(Low)" — collapse into one line at the worse value.
- **Usage Trend** — a bar per day holding that day's peak quota used across pools. Antigravity keeps
  no history, so UsagePal samples what it reports and stores the series in the plugin's data
  directory (`history.json`, 31 days). Days when the app was not running read low.
- **Burn Rate** — quota consumed per hour inside the current reset window, for whichever pool is
  closest to running out. Needs at least two samples spanning 15 minutes, and is withheld after a
  reset refills the pool.
