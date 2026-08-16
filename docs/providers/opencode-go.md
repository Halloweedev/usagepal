# OpenCode Go

> Uses OpenCode's account API to show authoritative Go usage limits.

## Overview

- **Source of truth:** `https://opencode.ai/zen/go/v1/usage`
- **Provider ID:** `opencode-go`
- **Usage scope:** account usage across devices

## API Key

UsagePal checks these sources in order:

1. A key saved for the account you're tracking (see Multiple accounts below)
2. A key saved in UsagePal Settings
3. The `opencode-go` key from `~/.local/share/opencode/auth.json`
4. The `OPENCODE_API_KEY` environment variable

UsagePal stores a key entered in Settings at `~/.config/usagepal/opencode-go.json`. It does not
change OpenCode's auth file. The saved key is never read back into the app interface.

The plugin is detected when the UsagePal key file or OpenCode auth file exists, or when
`OPENCODE_API_KEY` is set.

## Multiple accounts

OpenCode Go supports registering several API keys, each tracked as its own card. When you add an
account from its card or from Settings, UsagePal stores that account's key in an owner-only file
under `~/.config/usagepal/accounts/opencode-go/` and uses it for that account's usage — it never
touches the shared Settings key or OpenCode's own auth file. Because usage comes from the account
API (keyed by the API key), each account reports its own limits, with no local-log attribution.

## Usage Bars

The API supplies the percentage used and exact reset time for:

- **Session:** rolling five-hour usage
- **Weekly:** weekly usage
- **Monthly:** subscription-month usage

UsagePal displays these values directly. It does not estimate limits from local history, token
prices, or the local OpenCode database.

## Failure Behavior

If an update fails after a successful fetch, UsagePal keeps the last successful result visible and
shows an inline warning. A failed response never replaces the cached result and never falls back to
local estimates.

If no previous result exists, UsagePal shows a friendly error for a missing or invalid key, a
missing Go subscription, an unreachable service, or an invalid API response.
