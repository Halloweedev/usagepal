# OpenCode Go

> Uses local OpenCode history from SQLite to track observed OpenCode Go spend on this machine.

## Overview

- **Source of truth:** `~/.local/share/opencode/opencode.db`
- **Auth discovery:** `~/.local/share/opencode/auth.json`
- **Provider ID:** `opencode-go`
- **Usage scope:** local observed assistant spend only

## Detection

The plugin enables when either condition is true:

- `~/.local/share/opencode/auth.json` contains an `opencode-go` entry with a non-empty `key`
- local OpenCode history already contains `opencode-go` assistant messages with numeric `cost` or token usage

If neither signal exists, the plugin stays hidden.

## Data Source

UsagePal reads the local OpenCode SQLite database directly:

```sql
SELECT
  CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
  CAST(json_extract(data, '$.cost') AS REAL) AS cost,
  COALESCE(
    json_extract(data, '$.modelID'),
    json_extract(data, '$.model'),
    json_extract(data, '$.modelName')
  ) AS modelID,
  (
    COALESCE(CAST(json_extract(data, '$.tokens.input') AS INTEGER), 0) +
    COALESCE(CAST(json_extract(data, '$.tokens.output') AS INTEGER), 0) +
    COALESCE(CAST(json_extract(data, '$.tokens.reasoning') AS INTEGER), 0) +
    COALESCE(CAST(json_extract(data, '$.tokens.cacheRead') AS INTEGER), 0) +
    COALESCE(CAST(json_extract(data, '$.tokens.cacheWrite') AS INTEGER), 0) +
    COALESCE(CAST(json_extract(data, '$.tokens.cache_read') AS INTEGER), 0) +
    COALESCE(CAST(json_extract(data, '$.tokens.cache_write') AS INTEGER), 0)
  ) AS tokensTotal
FROM message
WHERE json_valid(data)
  AND json_extract(data, '$.providerID') = 'opencode-go'
  AND json_extract(data, '$.role') = 'assistant'
  AND (
    json_type(data, '$.cost') IN ('integer', 'real')
    OR tokensTotal > 0
  )
```

Only assistant messages with numeric `cost` or token counts count. When `cost` is zero or missing but per-token fields are present, UsagePal estimates spend using the published OpenCode Go per-million rates (same table as the official docs). Stored non-zero `cost` values always win over estimates. Missing remote or other-device usage is not estimated.

## Share Graph

When local history is available, the plugin also emits share-graph lines:

- **Today / Yesterday / Last 30 Days** — provider spend totals, plus token counts when message `tokens` are present
- **Usage Trend** — daily token bar chart for the last 31 days (only when tokens exist)
- **Per-model breakdown** — one text line per model with 30-day share and Today/Yesterday/7d/30d spend

Model names come from `modelID` (with `model` / `modelName` fallbacks) and are prettified for display (for example `glm-5.1` → `Glm 5.1`). If no model ID is stored on any row, UsagePal shows a single aggregate line labeled **OpenCode Go** at 100%.

Day buckets use UTC calendar dates, matching the Cursor share-graph behavior.

## Limits

UsagePal uses the current published OpenCode Go plan limits from the official docs:

- `5h`: `$12`
- `Weekly`: `$30`
- `Monthly`: `$60`

Bars show observed local spend as a percentage of those fixed limits and clamp at `100%`.

## Window Rules

- `5h`: rolling last 5 hours from now
- `Weekly`: UTC Monday `00:00` through the next UTC Monday `00:00`
- `Monthly`: inferred subscription-style monthly window using the earliest local OpenCode Go usage timestamp as the anchor

Monthly usage is inferred from local history, not read from OpenCode’s account API. UsagePal reuses the earliest observed local OpenCode Go usage timestamp as the monthly anchor. If no local history exists yet, it falls back to UTC calendar month boundaries until the first Go usage is recorded.

## Failure Behavior

If auth or prior history already indicates OpenCode Go is in use, but SQLite becomes unreadable or malformed, the provider stays visible and shows a grey `Status: No usage data` badge instead of failing hard.

## Future Compatibility

The public provider identity stays `opencode-go`. If OpenCode later exposes account-truth usage by API key, UsagePal can swap the backend without changing the provider ID or UI contract.
