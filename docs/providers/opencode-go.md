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

OpenCode Go keeps the existing credential sources as the Default account and supports registering
several more API keys. Each account is tracked on the same swipeable card. The Default account can be
renamed from Settings → Manage accounts. When you add an
account from its card or from Settings, UsagePal stores that account's key in an owner-only file
under `~/.config/usagepal/accounts/opencode-go/` and uses it for that account's usage — it never
touches the shared Settings key or OpenCode's own auth file. Because usage comes from the account
API (keyed by the API key), each account reports its own limits.

Local spend is different: the local OpenCode database is machine-wide and not tagged by API key, so
only the account whose key matches the one signed in to the local OpenCode CLI
(`~/.local/share/opencode/auth.json`, `opencode-go.key`) reads real local usage. Every other
registered account shows "No local OpenCode CLI usage" instead of another login's spend.

## Usage Bars

The API supplies the percentage used and exact reset time for:

- **Session:** rolling five-hour usage
- **Weekly:** weekly usage
- **Monthly:** subscription-month usage

UsagePal displays these values directly. It does not estimate limits from local history, token
prices, or the local OpenCode database.

## Local Usage

On top of the web quota bars, UsagePal reads the local OpenCode history
(`~/.local/share/opencode/opencode.db`, read-only) and shows spend lines for the account that is the
current local CLI login:

- **Today / Yesterday:** tokens and cost for those days (for example, "$0.50 · 1K")
- **Last 30 Days:** the 31-day window total
- **Usage Trend:** a daily token bar chart of the same window
- **Per-model lines:** each model's share of the window (for example, "88.2% · 30d $0.75")

Costs come from the values OpenCode stored with each message — UsagePal does not price tokens
itself. The database query runs only after the web quota fetch, with a 15-second timeout; a slow
or locked database skips the local lines without affecting the quota bars. When the tracked
account isn't the local CLI login, Today / Yesterday / Last 30 Days show "—" instead.

## Failure Behavior

If an update fails after a successful fetch, UsagePal keeps the last successful result visible and
shows an inline warning. A failed response never replaces the cached result and never falls back to
local estimates.

If no previous result exists, UsagePal shows a friendly error for a missing or invalid key, a
missing Go subscription, an unreachable service, or an invalid API response.

If the local database read fails (missing database, locked file, or a probe timeout), the quota
bars still render and the local lines are simply omitted — the web quota is the source of truth.
