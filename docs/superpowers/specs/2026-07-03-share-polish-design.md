# Share screen polish: plan badge, clean model names, grouped checklist — design

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Three small, independent polish items on the existing Share Usage screen, based on live feedback:

1. Show the account's subscription plan (e.g. "Max 5x") on the card, toggleable.
2. Clean up raw model ids ("claude-opus-4-8") into friendly display names ("Opus 4.8").
3. Group the checklist into labeled sections instead of one flat chip grid.

All three stay inside the current dropdown panel — the separate pop-out window is a follow-up design, tracked independently.

## Decisions (confirmed)

### 1. Plan badge

`PluginOutput` already carries an optional `plan` field (verified live: Claude's real data includes `"plan": "Max 5x"`), and `ProviderCard` already renders it as a small outline `Badge` next to the provider name — this mirrors that exact convention.

- `ShareCard` gains a `plan?: string` prop, rendered as a small pill next to the provider name in the header.
- **Not** the shared `src/components/ui/badge.tsx` component — its `outline` variant uses `text-foreground`, a CSS variable tied to the app's own theme, which would break `ShareCard`'s independent-of-app-theme requirement (the same reason `Progress` was avoided when building the card originally). Build a small inline `<span>` styled from `ShareCard`'s own literal `styles` object instead.
- `share.tsx` gets a new `showPlan` toggle checkbox alongside the existing "Light card"/"Watermark" ones, defaulting to **on** when the selected provider has a `plan` value, and hidden entirely when it doesn't (nothing to toggle).

### 2. Clean model names

Raw model ids are irregular across providers, so this is a small regex-based "prettify" helper per plugin — not a lookup table (no per-model data entry to maintain) — with a safe fallback to the raw id if the shape isn't recognized (never crash or blank out an unfamiliar model).

- **Claude** (`plugins/claude/plugin.js`): strip the `claude-` prefix, split on `-`, drop a trailing 8-digit date segment if present (e.g. `20251001`), then the first remaining part is the family name (capitalized) and the rest join with `.` as the version. Only applies the transform if the shape actually matches (family is letters-only, version parts are all-numeric) — otherwise returns the raw id unchanged.
  - `claude-opus-4-8` → `Opus 4.8`
  - `claude-haiku-4-5-20251001` → `Haiku 4.5`
  - `claude-fable-5` → `Fable 5`
  - `claude-sonnet-4-6` → `Sonnet 4.6`
- **Codex** (`plugins/codex/plugin.js`): strip a `gpt-` prefix, split on `-`; the first part must look like a version number (`5`, `5.5`, `5.4`) — becomes `GPT-<version>`; any remaining parts are capitalized words appended after it.
  - `gpt-5.5` → `GPT-5.5`
  - `gpt-5` → `GPT-5`
  - `gpt-5-codex` → `GPT-5 Codex`
- The prettified name is used **only** for the line's display `label`. The raw id remains the lookup key for `collectModelCosts`'s per-model cost totals (`costTotals.Today[model.name]`, etc., where `model.name` is still the raw id) — only the final `ctx.line.text({ label: ..., ... })` call uses the prettified version. No change to aggregation, bucketing, or any other logic.

### 3. Grouped checklist

Reuses the classification that already exists (`ShareLineScope`: `"overview" | "detail" | "modelBreakdown"`) as the grouping key, rather than inventing a new taxonomy — it already conceptually matches "what a line does":

- **Usage** (`overview` scope) — primary quota bars (Session, Weekly, Extra usage spent, etc.)
- **Details** (`detail` scope) — deeper per-provider stats (model-scoped limits, day-level cost lines, Usage Trend)
- **Models** (`modelBreakdown` scope) — the per-model merged lines

Rendered top-to-bottom in that order. A section with zero lines for the current provider is omitted entirely (same "don't show an empty control" convention already used for the plan toggle and, previously, the quick-toggle buttons). Each section gets a small uppercase label above its own `flex flex-wrap` chip row — the chip styling itself (`rounded-md border px-1.5 py-1 text-xs`) is unchanged from the current single-group layout, just split into three grouped rows instead of one.

## Components

### `src/components/share-card.tsx` (modified)
- `ShareCardProps` gains `plan?: string`.
- Header row gains a small pill (literal `styles`-based, not the shared `Badge`) shown when `plan` is set.

### `plugins/claude/plugin.js` / `plugins/codex/plugin.js` (modified)
- New `prettifyModelName(rawId)` helper per file (provider-specific rules above).
- `pushModelUsageLines` uses `prettifyModelName(model.name)` for the pushed line's `label`; all cost-bucket lookups keep using the raw `model.name`.

### `src/pages/share.tsx` (modified)
- New `showPlan` state + toggle checkbox (mirrors the existing theme/watermark toggles), passed through to `ShareCard` as `plan={showPlan ? selected.data.plan : undefined}`.
- Checklist rendering groups `shareableLines` by `entry.scope` into the three sections above, each its own labeled `flex flex-wrap` row, omitting empty sections.

## Data flow

Plugin emits a line with a prettified `label` and (for model lines) a merged cost value → `buildShareableLines` classifies it by `scope` exactly as before (classification only ever looked at declared-vs-undeclared + manifest scope, never at the label text, so prettifying the label doesn't change classification) → `share.tsx` groups the classified lines by `scope` into three sections for rendering → `ShareCard` renders whichever lines are checked, plus the plan pill when enabled.

## Error handling

- No `plan` value on the provider's data → the toggle and pill are both omitted, no empty badge.
- A model id that doesn't match either plugin's expected shape → `prettifyModelName` returns it unchanged (already how `buildShareableLines`/`ShareCard` handle any other line, no special-casing needed).
- A provider with no lines in one of the three scope buckets → that section doesn't render (no empty label with nothing under it).

## Testing

- `src/components/share-card.test.tsx`: renders the plan pill when `plan` is set; omits it when not.
- `plugins/claude/plugin.ccusage.test.js` / codex: `prettifyModelName` unit-style assertions via the existing probe tests (e.g. a fixture with `claude-opus-4-8` now expects the merged line's label to be `"Opus 4.8"`, not the raw id) plus a fallback case (an unrecognized shape stays unchanged).
- `src/pages/share.test.tsx`: the plan toggle appears/disappears based on data; checklist renders three labeled sections in Usage/Details/Models order; a section with no matching lines is omitted; toggling the plan checkbox is reflected in the props passed to `ShareCard`.

## Out of scope (this pass)

- The pop-out window — see [share-popout design](2026-07-03-share-popout-design.md).
- Prettifying names for any provider besides Claude/Codex.
- Persisting toggle state (theme/watermark/plan) across sessions — unchanged from today's in-memory-only behavior.
