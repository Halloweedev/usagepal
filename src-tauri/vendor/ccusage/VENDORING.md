# Vendored: ccusage

Source: https://github.com/ccusage/ccusage
Tag: v20.0.2
Commit: 973a53b8c755ccdd1c8d11f9d76fe4670a9c27d4
Vendored: 2026-07-14
License: MIT (Copyright (c) 2025 ryoppippi) — see `LICENSE` (copied verbatim
from `apps/ccusage/LICENSE`, the file the repo-root `LICENSE` symlinks to).

## Why vendored, not depended on

Upstream publishes no library. `rust/crates/ccusage` is a `[[bin]]`-only
crate at `version = "20.0.2"` (two bins: `ccusage` and
`generate-config-schema`), and `ccusage-cli`-equivalent code (`cli.rs`) is
only the argument parser. There is nothing on crates.io to depend on, so we
own this copy and its merge burden.

## Structure: separate crate, not a module

The brief's default plan was `mod vendor;` inside the `usagepal` crate
(edition 2024). That was tried first, on paper, and rejected before writing
any code: upstream's crate is `edition = "2021"`, and editions are
per-crate, not per-module — vendoring these files as a module inside
`usagepal` would silently compile 2021-authored code under 2024 rules
(`unsafe_op_in_unsafe_fn`, RPIT capture changes, etc.), which is exactly the
kind of divergence-from-upstream-semantics this vendoring exercise exists to
prevent, and the vendored files cannot be edited to fix any resulting
lint/error.

Independently of the edition question, the dependency-closure work below
(see "The cut line") required writing a real amount of non-vendored glue
(`lib.rs`, `cli.rs`, `build.rs`) — code that legitimately wants to be
formatted and linted by our own house style, distinct from the
byte-identical vendored files sitting next to it. A separate crate isolates
that naturally: its own `Cargo.toml` states its own `edition = "2021"`
and pinned dependency versions, and it is excluded from `usagepal`'s lints
via its own `#![allow(clippy::all, dead_code, unused)]` (see `src/lib.rs`)
and its own `rustfmt.toml`.

`src-tauri/Cargo.toml` depends on it as `ccusage-vendor = { path =
"vendor/ccusage" }`. Because `usagepal`'s `Cargo.toml` has no `[workspace]`
table, this path dependency makes Cargo treat `usagepal` as the root of an
implicit workspace with `ccusage-vendor` as a member — this is normal Cargo
behavior for path dependencies, not something we configured. `usagepal`'s
`src/lib.rs` was **not** modified to add `mod vendor;` — there's no module
to declare; `usagepal` code reaches this crate via `use ccusage_vendor::...`,
which is Task 3's job (see "What Task 3 gets").

## Files taken (byte-identical to upstream)

From `rust/crates/ccusage/src/` at the pinned commit, copied with no changes:

- `claude_loader.rs` — Claude Code JSONL loading + daily aggregation.
  Contains `load_daily_summaries` (Task 3's Claude entrypoint), left exactly
  as authored, including its `pub(crate)` visibility (see "What Task 3
  gets" for how that's exposed across the crate boundary).
- `codex_loader.rs` — Codex session JSONL loading → raw
  `CodexTokenUsageEvent` list.
- `cost.rs` — `calculate_cost` / `calculate_cost_for_usage` / `tiered_cost`.
- `pricing.rs` — `PricingMap`: LiteLLM-shaped pricing lookup, fast-multiplier
  overrides, embedded fallback pricing, optional live refresh.
- `types.rs` — All the plain data types (`UsageEntry`, `UsageSummary`,
  `TokenUsageRaw`, `LoadedEntry`, `CodexTokenUsageEvent`, etc).
- `date_utils.rs` — `TimestampMs` and all date/timezone formatting/parsing.
- `fast.rs` — `FxHashMap`/`FxHashSet`/`SmallIndexVec` aliases, `byte_lines`,
  `suffix_string`.
- `home.rs` — `home_dir()` resolution (HOME / USERPROFILE / HOMEDRIVE+PATH).
- `utils.rs` — `non_empty_json_string`, `json_value_u64`,
  `apply_total_token_fallback`, `total_usage_tokens`.
- `logger.rs` — `debug_log`, `log_level`.
- `progress.rs` — terminal spinner/progress tracking (`track_usage_load`,
  `track_status`). Kept because `claude_loader.rs`/`pricing.rs` call it
  unconditionally; it is self-contained (no further `crate::` deps) and is a
  no-op-ish spinner, not argument parsing or config.
- `litellm-pricing-fallback.json`, `fast-multiplier-overrides.json` — data
  files `pricing.rs` embeds via `include_str!`, placed alongside it exactly
  as upstream does.

`models-dev-pricing.json` does not exist at v20.0.2 (confirmed against the
pinned commit); it is a HEAD-only file and out of scope here.

## What was deliberately NOT taken, and why

- **`main.rs`, `cli.rs`, `config.rs`, `config_schema.rs`, `output.rs`,
  `progress.rs`'s CLI callers, `blocks.rs`, `summary.rs`, `commands/`,
  `bin/`** — argument parsing, config-file handling, and terminal
  rendering, as instructed.
- **The entire `adapter/` directory (all 15 providers, including `codex`)**
  — see "The cut line" below. This is the one place this vendoring
  deliberately diverges from the brief's stated expectation ("prune 14 of
  15 `mod` lines, keep `codex`"), for reasons discovered only by tracing the
  actual dependency graph.
- **`project_names.rs`** — not referenced (directly or transitively) by any
  file in "Files taken"; confirmed via `grep` across the whole set. Not
  vendored because nothing needs it.
- **`cli-help.json`, `bin/generate_config_schema.rs`** — belong to `cli.rs`
  / `config_schema.rs`, not taken with them.

## The cut line: why `adapter/codex.rs` is NOT vendored

The brief's framing was: `adapter/mod.rs` declares 15 `pub(crate) mod`
provider lines; prune 14, keep `codex`. That undersold the actual coupling.
`adapter/codex.rs` mixes two things in one file: pure data functions
(`aggregate_events`, `load_groups`, `calculate_group_cost`,
`calculate_codex_model_cost`, `filter_events_by_date`, and — importantly —
`report_json`, which builds the exact daily-JSON shape upstream's
`ccusage codex daily --json` prints) with CLI-only functions (`run`,
`print_table`). Rust compiles whole files, so taking the pure functions
means also compiling the CLI ones, whose imports are:

```
cli::{AgentCommandArgs, AgentReportKind, CodexSpeed, SharedArgs, WeekDay}
color, print_box_title                      // main.rs, delegating to ccusage_terminal
print_json_or_jq, wants_json                // output.rs
format_currency, format_date_tz, format_models_multiline,
format_number, json_float, json_value_u64   // output.rs / utils.rs mix
week_start                                  // summary.rs
Align, Color, SimpleTable                   // ccusage_terminal (external workspace crate)
```

`Align`/`Color`/`SimpleTable` are not defined anywhere in `rust/crates/
ccusage/src` at all — they live in a *separate* workspace crate,
`ccusage-terminal` (`main.rs`: `pub(crate) use ccusage_terminal::{Align,
Color, SimpleTable};`), which is terminal table/color rendering, is not
part of this repo, and is squarely "argument parsing and terminal
rendering" — the exact category the brief says to exclude. Taking
`adapter/codex.rs` byte-identical would require either vendoring that
external crate too, or vendoring `output.rs` (banned) + `cli.rs` (banned,
and itself requires `config.rs` → `config_schema.rs` → the `schemars`
crate, i.e. the CLI's config-file system) + `summary.rs` (banned) — i.e.
exactly the "transitively pulls in the whole CLI" scenario the brief warns
about and says to stop and reconsider at.

Given that, `adapter/mod.rs` is not vendored at all (not even pruned down to
zero lines) — no file in "Files taken" references `adapter::` anything, so
there is nothing to satisfy by keeping an empty shell of it.

**Consequence for Task 3**: there is no vendored, upstream-verbatim
day-bucketing/report-JSON logic for Codex. Task 3 must build daily summaries
for Codex from `load_codex_events`'s raw `CodexTokenUsageEvent` list itself,
using `PricingMap`/`calculate_cost_for_usage` (both vendored) for costing.
This is real, nontrivial porting work with correctness risk (it's exactly
what `ccusage_differential.rs`'s Codex case exists to catch) — flagged
prominently in the Task 2 report, not quietly absorbed here.

## Local modifications

Two categories, per the brief's own permitted-edit rule ("deleting a `mod
x;` line... must be recorded here") plus the honest accounting of
everything this exercise's discovered cut-line problems required:

1. **Pruned `mod` lines**: N/A as a literal edit to `adapter/mod.rs` — that
   file was never vendored (see "The cut line"). If it had been taken and
   pruned to zero lines, the effect is identical; it just isn't a file that
   exists in this tree to point at.

2. **Files in this crate that are NOT vendored** (i.e., not claimed to be
   byte-identical to any upstream file — all local logic/glue, called out
   explicitly so a future `diff` against upstream isn't mistaken for a
   vendoring change):
   - `src/lib.rs` — this crate's root. Upstream has no equivalent (it's a
     `[[bin]]` crate); this replaces the handful of things `main.rs` used to
     provide to sibling modules (`Result`/`CliError`, crate-root
     re-exports) plus the `pub` surface Task 3 calls through (see below).
   - `src/cli.rs` — **not** upstream's `cli.rs`. It reproduces, verbatim,
     only the struct/enum text of upstream `cli.rs` lines 42–186
     (`SharedArgs`, `impl SharedArgs::with_defaults`, `CostMode`,
     `SortOrder`) — the minimum needed for `claude_loader.rs` /
     `codex_loader.rs` / `cost.rs`'s unedited `use crate::cli::{...}` to
     resolve, without the ~2300 remaining lines of argument parsing / help
     text / `config.rs` integration. See "The cut line" reasoning above —
     the same reasoning applies to why full `cli.rs` isn't taken.
   - `build.rs` — upstream's `build.rs` also generates `cli-help.rs` (moot,
     we don't take `cli.rs`'s help text) and fetches live LiteLLM pricing
     over the network for `pricing.rs`'s `BUILD_TIME_PRICING_JSON`. Ours
     always takes upstream's own `CCUSAGE_SKIP_PRICING_FETCH` fallback path
     — copying the vendored `litellm-pricing-fallback.json` to
     `$OUT_DIR/litellm-pricing.json` — for build determinism (no network
     dependency, no CI flakiness). `pricing.rs::load_embedded()` loads that
     *same* fallback file a second time anyway (`FALLBACK_PRICING_JSON`, a
     separate `include_str!`) as a full-coverage layer on top, so no model
     coverage is lost versus upstream's own offline path; the only thing
     forgone is the network-refreshed, curated-subset optimization. This is
     Task 2/10's territory (pricing data correctness), not a vendoring
     defect.
   - `Cargo.toml`, `rustfmt.toml` — this crate's own manifest/format config,
     naturally not upstream files.

**No file under "Files taken" above was edited.** `git diff` against a
fresh `v20.0.2` checkout of those specific files is empty.

## Public API for Task 3 (`plugin_engine/ccusage.rs`)

Because this vendor tree is its own crate, the vendored functions' original
`pub(crate)` visibility (e.g. `claude_loader::load_daily_summaries` at
`claude_loader.rs:34`, deliberately left as-is per the brief) is only
visible *inside* `ccusage-vendor` — not to `usagepal`. `src/lib.rs`
re-exports the needed items as `pub` (a superset of `pub(crate)`, so this
required no change to any vendored file):

- `SharedArgs`, `CostMode`, `SortOrder` (from the `cli.rs` shim)
- `UsageSummary`, `CodexTokenUsageEvent`, `TokenUsageRaw`, and the rest of
  `types.rs`
- `PricingMap`
- `load_daily_summaries`, `load_codex_events`, `calculate_cost_for_usage`
  (plus thin same-signature wrappers `load_claude_daily_summaries` /
  `calculate_usage_cost` for call-site readability — no new logic)

This is visibility plumbing only. It does not implement `Provider`,
`query_daily`, error mapping to `usagepal`'s error types, or Codex daily
aggregation — that is Task 3's work, per the brief ("Task 3 wraps them;
nothing calls them directly yet").

## Dependencies added (`vendor/ccusage/Cargo.toml`)

Versions copied exactly from upstream's
`rust/crates/ccusage/Cargo.toml` at the pinned commit (not upgraded):

```
jiff = { version = "0.2.24", default-features = false, features = ["std", "tz-system", "tzdb-zoneinfo"] }
memchr = "2"
compact_str = "0.9"
phf = { version = "0.13", features = ["macros"] }
rustc-hash = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
smallvec = "1"
ureq = { version = "3.3.0", default-features = false, features = ["rustls"] }
```

Note the brief's Step 4 suggested `jiff` features `tz-system`,
`tzdb-zoneinfo`, `tzdb-bundle-platform` — the last does not exist in
upstream's actual `Cargo.toml` at v20.0.2 (verified directly). Used
upstream's real feature list instead of the brief's guess.

Not taken from upstream's dependency list because nothing vendored here
needs them: `ccusage-terminal` (path dep, terminal rendering — see "The cut
line"), `schemars` (config schema only), `sqlite` (statusline caching,
confirmed unreferenced by `grep` across the vendored set), `mimalloc`
(musl-only global allocator in `main.rs`, not vendored).

`usagepal`'s existing `serde`/`serde_json` were not reused for this crate's
`[dependencies]` — each crate resolves its own dependency graph; Cargo
unifies compatible versions in the shared `Cargo.lock` automatically.

## Merging upstream

1. Clone the new upstream tag.
2. Diff its `rust/crates/ccusage/src/` against `src/` in this crate for each
   file listed under "Files taken" above — should be empty for the pinned
   commit; for a new tag, this is the real changelog to read.
3. Re-check "The cut line": if `adapter/codex.rs`'s dependency on
   `ccusage-terminal`/`output.rs`/`cli.rs` has narrowed upstream, re-evaluate
   whether Codex daily aggregation can be vendored directly instead of
   ported by hand in the adapter layer.
4. Read the diff for behavior changes that move dollar figures — see the
   four listed in
   `docs/superpowers/specs/2026-07-13-pricing-and-native-scanners-design.md`.
5. Any number that moves needs a release note.
