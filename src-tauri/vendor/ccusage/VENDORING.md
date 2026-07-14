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
"vendor/ccusage" }`. `usagepal`'s `src/lib.rs` was **not** modified to add
`mod vendor;` — there's no module to declare; `usagepal` code reaches this
crate via `use ccusage_vendor::...`, which is Task 3's job (see "What Task 3
gets").

**Correction (Task 2 review fix, when `adapter/codex.rs` was vendored):**
this file originally claimed a path dependency alone makes Cargo treat
`usagepal` as the root of an implicit workspace with `ccusage-vendor` as a
full member. That's wrong — a path dependency without an explicit
`[workspace]` table is built as part of every `cargo build`, but is *not* a
workspace member for `cargo test -p`/dev-dependency purposes. That
distinction was invisible while `ccusage-vendor` had zero `[dev-dependencies]`
(so `cargo test -p ccusage-vendor` "happened" to work), and broke the moment
one was added for the vendored `insta` snapshot test that came in with
`adapter/codex.rs` — the error is literally "cannot be tested because it
requires dev-dependencies and is not a member of the workspace". Fixed by
adding a real `[workspace]` table to `src-tauri/Cargo.toml`:
`members = ["vendor/ccusage"]` (the root package is an implicit member of
its own workspace once `[workspace]` exists, so it doesn't need to be
listed). No other observable effect — there was never a separate
`vendor/ccusage/Cargo.lock`; everything already resolves through this
crate's single root `Cargo.lock`.

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
- `adapter/codex.rs` — Codex daily/weekly/monthly/session aggregation and
  the exact daily-JSON shape upstream's `ccusage codex daily --json` prints
  (`report_json`, `aggregate_events`, `calculate_group_cost`,
  `filter_events_by_date`, `calculate_codex_model_cost`, plus the CLI-only
  `run`/`print_table` halves — see "The cut line" below for why the whole
  file is taken, CLI halves included). Vendored **2026-07-14 (review fix)**,
  after initially being left out; added `src/adapter/mod.rs` (not
  byte-identical — see "Local modifications") to declare it, plus its own
  upstream unit tests, including one `insta` snapshot test (`src/adapter/
  snapshots/`, renamed for this crate's name — see "Local modifications").

`models-dev-pricing.json` does not exist at v20.0.2 (confirmed against the
pinned commit); it is a HEAD-only file and out of scope here.

## What was deliberately NOT taken, and why

- **`main.rs`, `cli.rs` (mostly — see "The cut line" for the four types now
  extracted from it), `config.rs`, `config_schema.rs`, `output.rs`,
  `progress.rs`'s CLI callers, `blocks.rs`, `summary.rs` (mostly — see
  below), `commands/`, `bin/`** — argument parsing, config-file handling,
  and terminal rendering, as instructed.
- **14 of the 15 providers in `adapter/`** (`all`, `amp`, `codebuff`,
  `copilot`, `droid`, `gemini`, `goose`, `hermes`, `kilo`, `kimi`,
  `openclaw`, `opencode`, `pi`, `qwen`) — only `codex` is needed by Task 3;
  see "The cut line".
- **`project_names.rs`** — not referenced (directly or transitively) by any
  file in "Files taken"; confirmed via `grep` across the whole set. Not
  vendored because nothing needs it.
- **`cli-help.json`, `bin/generate_config_schema.rs`** — belong to `cli.rs`
  / `config_schema.rs`, not taken with them.

## The cut line: `adapter/codex.rs` IS vendored, byte-identical

**This section originally concluded `adapter/codex.rs` could not be
vendored at all. That conclusion was wrong, and this is the corrected
version, written for the Task 2 review fix that vendored it.**

The brief's framing was: `adapter/mod.rs` declares 15 `pub(crate) mod`
provider lines; prune 14, keep `codex`. The file mixes two things: pure
data functions (`aggregate_events`, `load_groups`, `calculate_group_cost`,
`calculate_codex_model_cost`, `filter_events_by_date`, and — importantly —
`report_json`, which builds the exact daily-JSON shape upstream's
`ccusage codex daily --json` prints) with CLI-only functions (`run`,
`print_table`, from ~line 549). Rust compiles whole files, so taking the
pure functions means also compiling the CLI ones, whose imports are:

```
cli::{AgentCommandArgs, AgentReportKind, CodexSpeed, SharedArgs, WeekDay}
color, print_box_title                      // main.rs, delegating to ccusage_terminal
print_json_or_jq, wants_json                // output.rs
format_currency, format_date_tz, format_models_multiline,
format_number, json_float, json_value_u64   // output.rs / utils.rs mix
week_start                                  // summary.rs
Align, Color, SimpleTable                   // ccusage_terminal (external workspace crate)
```

The original mistake was treating "Rust needs these symbols to exist" as
equivalent to "we must vendor (or hand-port) their real behavior." It
doesn't: `Align`/`Color`/`SimpleTable`, `color`/`print_box_title`,
`print_json_or_jq`/`wants_json`, and `format_currency`/
`format_models_multiline`/`format_number` are referenced **only** inside
`run`/`print_table` — the CLI-rendering half — which is never called from
this crate or from `codex.rs`'s own `#[cfg(test)] mod tests`. They only
need to type-check, so they're supplied as **inert stubs living outside the
vendored file**, each `unimplemented!()`, in two new non-vendored modules:

- `src/terminal_stub.rs` — `Align`, `Color`, `SimpleTable`, `color`,
  `print_box_title` (stands in for the external `ccusage-terminal`
  workspace crate, which is not part of this repo).
- `src/output_stub.rs` — `wants_json`, `print_json_or_jq`,
  `format_currency`, `format_models_multiline`, `format_number` (stand in
  for upstream `output.rs`, which is not vendored).

Two more imports — `json_float` (from `output.rs`) and `week_start` (from
`summary.rs`) — are **not** in that unreachable set: `json_float` is called
by `group_json`/`totals_json`, both called from `report_from_groups`, which
`report_json` calls directly; `week_start` is called directly by
`aggregate_events` for `AgentReportKind::Weekly`. Both are on the
pure-data path the review named explicitly, and both are exercised by
`codex.rs`'s own snapshot test (which covers daily/weekly/monthly/session).
Stubbing either would silently produce wrong week buckets or wrong dollar
figures that still pass a differential gate blind to Weekly/Monthly/Session
reports. So they are **not** stubs: `src/report_support.rs` reproduces both
verbatim from upstream `output.rs`/`summary.rs` (unedited logic, just
relocated, since taking either file whole is still out of scope). Their own
dependencies (`parse_iso_date`, `format_naive_date`, `IsoDate::
weekday_from_sunday`) were already vendored byte-identical in
`date_utils.rs`, so nothing further needed porting.

The `cli::{AgentCommandArgs, AgentReportKind, CodexSpeed, WeekDay}` types
are handled differently again: they're real upstream `cli.rs` struct/enum
declarations (not stub-able logic, not pure functions to port), so they were
added to this crate's existing `src/cli.rs` shim, copied verbatim (see
"Local modifications").

Net result: `adapter/codex.rs` is vendored **byte-identical** — `diff`
against the pinned upstream commit is empty. Its CLI-rendering half
compiles but can never run in this crate (nothing calls `run`/`print_table`,
and their stubbed dependencies would panic if it ever did); its pure-data
half is 100% real, either vendored-with-the-file or ported verbatim
alongside it. `report_json`, `aggregate_events`, `calculate_group_cost`,
`filter_events_by_date`, and `calculate_codex_model_cost` are all correct by
construction — none of them were hand-ported.

`adapter/mod.rs` **is** vendored in the loose sense (it exists, and exists
to declare `codex`), but is not byte-identical to upstream: upstream
declares 15 `pub(crate) mod` provider lines, this declares 1
(`pub(crate) mod codex;`). See "Local modifications".

**Consequence for Task 3**: none, for aggregation logic — Task 3 gets real,
vendored `report_json`/`aggregate_events`/etc. to build on, not a
hand-port. Task 3 still has to write the `Provider`/`query_daily` glue and
map errors to `usagepal`'s error types (per the brief, "Task 3 wraps them;
nothing calls them directly yet") — none of that changed.

## Local modifications

Six categories, per the brief's own permitted-edit rule ("deleting a `mod
x;` line... must be recorded here") plus the honest accounting of
everything this exercise's discovered cut-line problems required.

**Every edit to a file under "Files taken" is in item 0, 0b or 0c. There are
six such edits, across three files, and all six are single tokens.**

0. **Visibility widening in a vendored file** (Task 3). `src/adapter/codex.rs`.
   Two functions changed from private `fn` to `pub(crate) fn`:

   - `report_from_groups` (upstream line 61)
   - `load_groups` (upstream line 121) — its signature also reflows onto three
     lines, purely because the added `pub(crate) ` pushes it past rustfmt's
     100-column limit. No other character changes.

   **Nothing else in the file changed**: no logic, no types, no test. `git diff`
   against the pinned upstream commit shows exactly these two `fn` → `pub(crate)
   fn` tokens and the one reflow.

   **Why these two, and not `report_json`:** Task 3 needs the JSON that
   `ccusage codex daily --json` prints. Upstream's `main.rs:134` dispatches that
   command to `adapter::codex::run`, whose body is
   `PricingMap::load` → `load_groups` → `resolve_codex_speed` →
   `report_from_groups` → print. `run` itself is unusable here (it prints via
   the `print_json_or_jq` stub, which is `unimplemented!()`), so `lib.rs`'s
   `codex_daily_json` wrapper reproduces that body minus the printing — which
   requires exactly `load_groups` and `report_from_groups` to be reachable.

   The obvious-looking alternative is `report_json` (already `pub(crate)`, just
   behind `#[cfg(test)]`), driven by `load_codex_events`. **That would be
   wrong**, and silently so. `report_json` is a test-only helper — upstream
   calls it *only* from `main.rs`'s `#[cfg(test)] mod tests`, never from the
   CLI — and the two paths do not dedupe the same way:

   | path | dedupe key |
   |---|---|
   | `load_groups` → `insert_event_key` (the CLI) | `(timestamp, model, tokens…)` |
   | `load_codex_events` → `dedupe_codex_events` (the test helper) | `(session_id, timestamp, model, tokens…)` |

   The CLI's key omits `session_id`, so it collapses an event duplicated across
   two session files; the test helper's key keeps both. On real user data that
   is a silent over-report. Take the CLI's path.

   **This is now pinned by a test** (Task 3 review fix). It used to be only a
   reachability argument: the differential corpus contained no cross-session
   duplicate, so both paths produced identical output on it and a refactor back
   to `report_json` would have stayed green. `tests/fixtures/ccusage/codex/
   sessions/session-c.jsonl` is a byte-for-byte copy of `session-b.jsonl` — the
   same event in a second session file — and `codex-expected.json` (re-captured
   from the real `ccusage@20.0.2` binary with the new corpus in place, and
   byte-identical to what it was, because the real binary collapses the
   duplicate) therefore only matches the CLI's dedupe key. Verified by switching
   `codex_daily_json` to the `report_json` path: the gate fails, doubling that
   day's cost.

0b. **Home override channel: `env::var` → `crate::env_var`** (Task 3 review
   fix). Three call sites, one token each, in three vendored files:

   | file | line (upstream) | edit |
   |---|---|---|
   | `src/claude_loader.rs` | 872, in `claude_paths` | `env::var("CLAUDE_CONFIG_DIR")` → `crate::env_var("CLAUDE_CONFIG_DIR")` |
   | `src/codex_loader.rs` | 115, in `codex_home_paths` | `env::var("CODEX_HOME")` → `crate::env_var("CODEX_HOME")` |
   | `src/adapter/codex.rs` | 100, in its own private `codex_home_paths` | `env::var("CODEX_HOME")` → `crate::env_var("CODEX_HOME")` |

   Nothing else changed — not the comma-splitting, not the normalization, not
   the error messages, not the fall-through to the default home directory.
   `crate::env_var` (in `lib.rs`, not vendored) is a drop-in for
   `std::env::var`: it returns a thread-local override when one is set for that
   key and otherwise defers to the real environment, so with no override in
   effect these three functions behave exactly as upstream.

   **Why:** these three are the only channel the vendored code accepts a home
   directory override through. The `bunx ccusage` subprocess we replaced set
   `CLAUDE_CONFIG_DIR`/`CODEX_HOME` on the *child*, which was free. In-process,
   the first cut of Task 3 set them on *this* process under a mutex. That is
   unsound and was reverted: a Rust mutex cannot exclude `getenv` calls from the
   Cocoa/WebKit threads in a Tauri process, nor from `usagepal`'s own
   `host_api::read_env_from_process` (which backs a JS API whose whitelist
   includes both of these variables) — which is precisely why `std::env::set_var`
   became `unsafe` in edition 2024. The crate now never writes the process
   environment. See `lib.rs`, "Home override channel", for the threading
   argument (both resolvers run on the calling thread, before any
   `thread::scope`, so the thread-local is always visible where it is read).

   **`adapter/codex.rs`'s copy is easy to miss and expensive to miss.** It is a
   *third*, private `codex_home_paths` — distinct from `codex_loader.rs`'s — and
   it feeds `detect_codex_fast_service_tier()`, which reads
   `<CODEX_HOME>/config.toml` to decide whether to apply Codex's **2× fast-tier
   cost multiplier**. Routing only the two loaders and not this one leaves it
   reading the *real* `~/.codex/config.toml` while the loaders read the override
   — so a machine whose real config sets `service_tier = "fast"` doubles every
   Codex dollar figure, with correct token counts. The differential gate caught
   exactly that during the review fix. If a future upstream bump adds another
   `env::var("CODEX_HOME")` / `env::var("CLAUDE_CONFIG_DIR")` reader, it must be
   routed here too; `grep -rn 'env::var' src/` is the check.

0c. **Pricing overlay channel: `PricingMap::load` → `crate::load_pricing_map`**
   (Task 4). One call site, one token, in one vendored file:

   | file | line (upstream) | edit |
   |---|---|---|
   | `src/claude_loader.rs` | 58, in `load_daily_summaries_inner` | `PricingMap::load(shared.offline, log_level() != Some(0))` → `crate::load_pricing_map(shared, log_level() != Some(0))` |

   `crate::load_pricing_map` (in `lib.rs`, not vendored) is a drop-in: it calls
   `PricingMap::load(shared.offline, log)` and then, *only if the caller supplied
   one*, overlays `shared.pricing_overlay` with `PricingMap::load_json` — which
   is exactly what upstream's own `PricingMap::load(offline = false)` does
   internally with the JSON it fetches. With no overlay (`None`, the `SharedArgs`
   default, and what `tests/ccusage_differential.rs` passes) this function is
   byte-for-byte `PricingMap::load`, so the vendored loader behaves exactly as
   upstream.

   `SharedArgs::pricing_overlay` is a **new field on a non-vendored file**
   (`src/cli.rs`, see item 3) — the only field there that is not upstream's.

   **Why:** `lib.rs` pins `OFFLINE_PRICING = true`, so the loader never fetches —
   a probe worker must not block on GitHub. But embedded-only pricing has its own
   failure mode: Codex token-usage events carry no pre-baked `costUSD`, so
   `CostMode::Auto` falls through to `PricingMap::find`, and
   `cost.rs::calculate_cost_from_tokens` returns **0.0** on a miss — no error, no
   log. A model released after the embedded `litellm-pricing-fallback.json`
   snapshot renders as zero spend, silently. (Claude has the same hole for any
   entry whose `costUSD` is absent, which is what this call site is.) So the
   fetch happens *outside* this crate, in `usagepal`'s
   `plugin_engine::pricing_cache` (24h disk cache, background refresh, embedded
   floor), and the resulting LiteLLM JSON is handed in as an overlay. The loader
   still never touches the network.

   **Two other `PricingMap::load` call sites are deliberately left unedited**:
   `claude_loader.rs:145` (in `load_entries`) and `adapter/codex.rs:38` (in
   `run`, the CLI entry point). Neither is reachable from this crate's `pub` API
   — `claude_daily_json` calls `load_daily_summaries`, and `codex_daily_json`
   reproduces `run`'s body rather than calling it (see item 0) — so editing them
   would grow the vendored diff for no behavior. The codex path gets its overlay
   in `lib.rs`, which is ours. If a future upstream bump makes either reachable,
   route it through `crate::load_pricing_map` too; `grep -rn 'PricingMap::load(' src/`
   is the check.

1. **Pruned `mod` lines**: `src/adapter/mod.rs`. Upstream declares 15
   `pub(crate) mod` provider lines (`all`, `amp`, `codebuff`, `codex`,
   `copilot`, `droid`, `gemini`, `goose`, `hermes`, `kilo`, `kimi`,
   `openclaw`, `opencode`, `pi`, `qwen`); this crate declares one
   (`pub(crate) mod codex;`), with the remaining line copied unedited. This
   is the brief's explicitly permitted edit type, applied for real once
   `adapter/codex.rs` was actually vendored (Task 2 review fix;
   originally N/A because nothing in `adapter/` was taken at all — see "The
   cut line").

2. **Renamed (not edited) test fixture**: `src/adapter/snapshots/
   ccusage_vendor__adapter__codex__tests__snapshots_codex_reports_for_periods_sessions_costs_and_fallback_models.snap`.
   Byte-identical in content to upstream's `adapter/snapshots/
   ccusage__adapter__codex__tests__...snap`; only the filename's crate-name
   prefix changed (`ccusage` → `ccusage_vendor`, i.e. this crate's
   `CARGO_CRATE_NAME`), because `insta` derives the expected snapshot
   filename from the crate name, and ours differs from upstream's. The
   `source:` metadata line inside the file still reads
   `crates/ccusage/src/adapter/codex.rs` (upstream's path) — left as-is;
   `insta` doesn't validate that field against the actual path, it's purely
   informational for human reviewers, so "correcting" it would be an
   edit with no effect and would make the file harder to trace back to its
   real upstream origin.

3. **Files in this crate that are NOT vendored** (i.e., not claimed to be
   byte-identical to any upstream file — all local logic/glue, called out
   explicitly so a future `diff` against upstream isn't mistaken for a
   vendoring change):
   - `src/lib.rs` — this crate's root. Upstream has no equivalent (it's a
     `[[bin]]` crate); this replaces the handful of things `main.rs` used to
     provide to sibling modules (`Result`/`CliError`, crate-root
     re-exports) plus the `pub` surface Task 3 calls through (see below).
     Task 4 added `load_pricing_map` (item 0c) and `PricingTable`/`TokenRates`
     — a thin `pub` wrapper letting `usagepal` do model→rate lookups through
     the *same* `PricingMap::find` matcher the cost path uses, so the app has
     one price source rather than two. Neither adds logic: both call into
     vendored `pricing.rs`.
   - `src/cli.rs` — **not** upstream's `cli.rs`. It reproduces, verbatim,
     only the struct/enum text of upstream `cli.rs` lines 42–197
     (`SharedArgs`, `impl SharedArgs::with_defaults`, `CostMode`,
     `SortOrder`, and — added for the Task 2 review fix that vendored
     `adapter/codex.rs` — `AgentCommandArgs`, `AgentReportKind`,
     `CodexSpeed`, `WeekDay`) — the minimum needed for `claude_loader.rs` /
     `codex_loader.rs` / `cost.rs` / `adapter/codex.rs`'s unedited
     `use crate::cli::{...}` to resolve, without the ~2300 remaining lines
     of argument parsing / help text / `config.rs` integration. Every
     added type is copied verbatim (fields, derives, defaults unchanged —
     `CodexSpeed::Auto` and `SortOrder::Asc`/`CostMode::Auto` remain the
     `#[default]`s exactly as upstream declares them), with only the same
     `pub(crate)` → `pub` visibility widening already applied to the rest
     of this file. See "The cut line" for why full `cli.rs` isn't taken.

     **One field is not upstream's**: `SharedArgs::pricing_overlay` (Task 4),
     defaulting to `None`, which is upstream's exact behavior. It carries the
     LiteLLM JSON that `usagepal`'s pricing cache fetched, so
     `crate::load_pricing_map` can lay it over the embedded snapshot without the
     loader ever going to the network. See item 0c.
   - `src/terminal_stub.rs`, `src/output_stub.rs` — new (Task 2 review fix).
     Inert, `unimplemented!()` stand-ins for CLI-rendering symbols
     `adapter/codex.rs` imports (see "The cut line" for exactly which
     symbols and the reachability argument for why stubbing them is safe).
   - `src/report_support.rs` — new (Task 2 review fix). `json_float`
     (from upstream `output.rs`) and `week_start` (from upstream
     `summary.rs`), reproduced verbatim, not stubbed — both are reachable
     from `adapter/codex.rs`'s pure-data path (see "The cut line").
   - `src/claude_report.rs` — new (Task 3). Same category as
     `report_support.rs`: reproduced **verbatim** from upstream, not
     reinvented, because these are on the money path. Four functions —
     `summary_json` and `totals_json` (upstream `output.rs`),
     `filter_and_sort_summaries` and `sort_summaries` (upstream `summary.rs`).
     They are the Claude half of what upstream's `commands::run_daily` does
     *after* `load_daily_summaries` returns, and neither `output.rs` nor
     `summary.rs` is vendored (both are CLI-rendering files, out of scope).
     They live inside this crate, not in `usagepal`, because they need
     `pub(crate)` access to `UsageSummary`'s fields.

     Three traps they exist to avoid, each of which silently changes users'
     spend history if you "simplify" them:
     - `summary_json` is **not** `serde_json::to_value(row)`. It emits
       `totalTokens` (a computed method, not a serde field), omits `credits`
       entirely when `None` (serde emits `null`), and excludes
       `messageCount`/`versions`.
     - `totals_json` sums `extra_total_tokens`, which is
       `#[serde(skip_serializing)]` and therefore invisible to serde.
     - `load_daily_summaries` does **no** filtering or sorting internally — it
       groups through a `BTreeMap`, i.e. ascending. `--since`/`--until` and
       `--order desc` happen in `filter_and_sort_summaries` or not at all.
   - `src/adapter/mod.rs` — new (Task 2 review fix), not byte-identical;
     see item 1 above.
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

4. **`serde_json`'s `float_roundtrip` feature is enabled** (Task 3 review fix) —
   the one deviation from upstream's dependency list, which declares plain
   `serde_json = "1"`. This is a manifest edit, not a vendored-source edit, but
   it changes vendored *behavior*, so it is recorded here.

   `usagepal` enables `float_roundtrip` (`src-tauri/Cargo.toml`) because
   serde_json's default float parser is not correctly rounded and can land 1 ULP
   from the nearest double — which silently corrupts money values (it reads the
   differential fixture's `0.00015000000000000001` back as `0.00015`, a
   different double).

   Cargo unifies features across the dependency graph, so building this crate as
   part of the app turns `float_roundtrip` on **inside it** whether or not this
   manifest asks for it. Declaring it here changes nothing about the app; what it
   changes is `cargo test -p ccusage-vendor`, which does *not* unify features.
   Without this line, this crate's 40 upstream tests — including the `insta`
   snapshot — parse floats with a different parser than the one production ships,
   i.e. they test a configuration nobody runs. With it, they test what ships.

   The deviation is therefore deliberate and one-directional: it makes the
   vendored loader's float parsing *more* accurate than upstream's default, in
   the app and in the tests alike. Upstream's own test expectations still pass
   (all 40, verified), so it is not a semantic change to any vendored logic — but
   it is a real change, and a future upstream bump should re-confirm those 40
   tests still pass with it on.

5. **`log` is declared as a dependency** (Task 4 review fix) — the second
   deviation from upstream's dependency list, which declares no logging facade
   at all. Like item 4 this is a manifest edit, not a vendored-source edit, and
   **no vendored file uses it**: it is used by exactly one line, in the
   non-vendored `src/lib.rs`.

   That line is in `load_pricing_map` (item 0c). `PricingMap::load_json` returns
   the number of models it loaded, and `0` means the overlay was unparseable or
   carried nothing priceable — the only way it can report a failure. The first
   cut of `load_pricing_map` **discarded that count**, on the stated premise that
   `pricing_cache` "only ever hands over an overlay it has already parsed". That
   premise was false: `pricing_cache` validated what it *fetched*, not what it
   read back off *disk*, so a corrupt cache file reached this call site as a
   zero-model overlay and was silently dropped. (The disk read now validates too
   — but a swallowed count is a swallowed error either way, and upstream itself
   warns at exactly this point: `pricing.rs::load`, `if loaded_count == 0`.)

   Upstream warns with `eprintln!`. That is right for a CLI and useless here:
   nothing captures a bundled Tauri app's stderr, so the warning would reach no
   log file and no Sentry — a "loud" failure that is, in practice, silent. `log`
   is the facade `usagepal` already routes to both, it is already in the
   workspace's dependency graph (so it adds no build), and using it keeps the
   project's "no silent fallbacks" rule (AGENTS.md) true at this boundary.

   A future upstream bump can drop this line the moment `load_pricing_map` stops
   existing; nothing vendored depends on it.

**Three files under "Files taken" have been edited. Six tokens, total.**
`adapter/codex.rs` (two `fn` → `pub(crate) fn`, item 0, plus one
`env::var` → `crate::env_var`, item 0b), `codex_loader.rs` (one
`env::var` → `crate::env_var`, item 0b), and `claude_loader.rs` (one
`env::var` → `crate::env_var`, item 0b, plus one `PricingMap::load` →
`crate::load_pricing_map`, item 0c). `git diff` against a fresh `v20.0.2`
checkout of every *other* file under "Files taken" is empty; for these three it
contains exactly those six tokens plus the one signature reflow the
`pub(crate) ` on `load_groups` forces past rustfmt's 100-column limit. No logic,
no types, no tests, no error messages.

## Public API (consumed by `usagepal`'s `plugin_engine/ccusage.rs`)

**This section previously described a `pub use` re-export plan that does not
work and was never implemented. Rewritten by Task 3 to describe the real
`lib.rs`.**

Why the re-export plan fails: the vendored items are `pub(crate)` (that is how
upstream declared them, and vendored files are not edited to widen them), and
Rust rejects re-exporting a `pub(crate)` item as `pub` — E0364/E0365. You
cannot widen an item's effective visibility past its declaration, only alias it
at the same-or-narrower level. So no arrangement of `pub use` in `lib.rs` can
make `load_daily_summaries` or `UsageSummary` callable from `usagepal`.

What actually works, and what `src/lib.rs` does: a **`pub fn` can call a
`pub(crate) fn`**. So the crate exposes two hand-written wrapper functions
that take only `std` types and return `serde_json::Value`. Because no
`pub(crate)` type appears in their signatures, `UsageSummary`, `PricingMap`,
`CodexGroup` etc. never need to become `pub` — they stay exactly as upstream
declared them.

```rust
pub fn claude_daily_json(home: Option<&Path>, since: Option<&str>, until: Option<&str>)
    -> Result<serde_json::Value, String>;
pub fn codex_daily_json (home: Option<&Path>, since: Option<&str>, until: Option<&str>)
    -> Result<serde_json::Value, String>;
```

Each returns exactly the JSON `ccusage <provider> daily --json --breakdown
--order desc` prints, by reproducing the corresponding upstream command's body
minus the printing (`commands::run_daily` and `adapter::codex::run`
respectively). **No aggregation, cost, dedup, or formatting logic is written in
`lib.rs`** — it is all called into.

Two things the wrappers own, which upstream got from its CLI/process context:

- **`SharedArgs`** (`daily_shared_args`): reproduces the flags the replaced
  subprocess passed, field for field — `json: true`, `breakdown: true`,
  `order: Desc`, plus `since`/`until`. Everything else keeps upstream's default,
  notably `mode: CostMode::Auto` (prefer a pre-baked `costUSD` over recomputing)
  and `timezone: None` (day bucketing is **local** time).

- **`offline`** (`OFFLINE_PRICING`, currently `true`). Upstream's `--offline`
  defaults to `false`, so the subprocess re-fetched LiteLLM pricing over the
  network on *every* refresh. Pinned to `true` here — verified
  output-identical on the differential corpus (the run with `false` passes the
  same gate, and takes ~7s of network time instead of ~0.02s; live LiteLLM and
  the embedded tables agree bit-for-bit on the fixture's models). It is the
  same numbers without the network call, and it makes each query deterministic
  and offline-safe. A cached/refreshable pricing source is Task 4's job.

- **`home`** is passed through a **thread-local override**, not the process
  environment. The three vendored resolvers that accept a home override read it
  via `crate::env_var` instead of `std::env::var` (Local modifications, item 0b);
  `env_var` returns the calling thread's override when one is set and otherwise
  defers to the real environment. The wrapper sets the override, runs the load,
  and clears it on the way out.

  **This crate never calls `std::env::set_var`.** An earlier cut of Task 3 did —
  process-wide, under a mutex — and that was unsound: the mutex excluded other
  ccusage queries and nothing else, while `usagepal` is a Tauri/Cocoa/WebKit
  process whose non-Rust threads call `getenv` unsynchronized, and whose own
  `host_api::read_env_from_process` (backing a whitelisted JS env API that
  includes `CODEX_HOME` and `CLAUDE_CONFIG_DIR`) reads it concurrently on probe
  workers. That is the hazard `set_var` became `unsafe` for in edition 2024;
  being edition 2021 here changes what the compiler demands, not what is true.
  Pinned by `tests/ccusage_differential.rs::
  query_daily_never_exposes_the_home_override_in_the_process_environment`.

## Dependencies added (`vendor/ccusage/Cargo.toml`)

Versions copied exactly from upstream's
`rust/crates/ccusage/Cargo.toml` at the pinned commit (not upgraded). Two lines
deviate, and both are marked:

```
log = "0.4"                                                      # DEVIATES: upstream declares no logging facade. Used by one line in the NON-vendored src/lib.rs. See "Local modifications" item 5.
jiff = { version = "0.2.24", default-features = false, features = ["std", "tz-system", "tzdb-zoneinfo"] }
memchr = "2"
compact_str = "0.9"
phf = { version = "0.13", features = ["macros"] }
rustc-hash = "2"
serde = { version = "1", features = ["derive"] }
serde_json = { version = "1", features = ["float_roundtrip"] }   # DEVIATES: upstream is plain `serde_json = "1"`. See "Local modifications" item 4.
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

**Added for the Task 2 review fix** (vendoring `adapter/codex.rs`):
`[dev-dependencies] insta = { version = "1.47.2", features = ["json"] }` —
same version upstream's `[dev-dependencies]` pins, needed because
`adapter/codex.rs`'s own `#[cfg(test)] mod tests` (vendored unedited, along
with everything else in the file) calls `insta::assert_json_snapshot!`.
This is the first `[dev-dependencies]` entry in this crate, which is what
surfaced the workspace-membership issue described above under "Structure:
separate crate, not a module" — fixed there via `src-tauri/Cargo.toml`'s new
`[workspace]` table, not by avoiding the dependency.

## Merging upstream

1. Clone the new upstream tag.
2. Diff its `rust/crates/ccusage/src/` against `src/` in this crate for each
   file listed under "Files taken" above (now including `adapter/codex.rs`)
   — should be empty for the pinned commit, **except** the five tokens in
   "Local modifications" items 0 and 0b: two `fn` → `pub(crate) fn` in
   `adapter/codex.rs`, and one `env::var` → `crate::env_var` in each of
   `adapter/codex.rs`, `claude_loader.rs`, `codex_loader.rs`. For a new tag,
   everything else in the diff is the real changelog to read.

   Then re-run `grep -rn 'env::var' src/` on the new tag. Every reader of
   `CODEX_HOME` or `CLAUDE_CONFIG_DIR` must go through `crate::env_var`, or the
   home override silently stops applying to it — which is not a crash but a wrong
   number (see item 0b: the reader in `adapter/codex.rs` gates a 2× cost
   multiplier). Readers of anything else (`HOME`, `XDG_CONFIG_HOME`, `LOG_LEVEL`)
   are left alone deliberately: the subprocess never overrode those either.
3. If `adapter/codex.rs`'s imports changed (new symbols, or existing ones
   moving between `report_json`/`aggregate_events`/etc. and `run`/
   `print_table`), redo the reachability check in "The cut line": anything
   still reachable only from `run`/`print_table` stays a stub in
   `terminal_stub.rs`/`output_stub.rs`; anything reachable from the
   pure-data path must be ported verbatim into `report_support.rs` (or a
   sibling module), never stubbed. If `cli.rs`'s `AgentCommandArgs`/
   `AgentReportKind`/`CodexSpeed`/`WeekDay` change shape, re-copy them
   verbatim into `src/cli.rs` — do not hand-adjust.
4. Re-copy `src/claude_report.rs`'s four functions verbatim if upstream's
   `output.rs::summary_json`/`totals_json` or
   `summary.rs::filter_and_sort_summaries`/`sort_summaries` changed, and
   re-check that `commands::run_daily` and `adapter::codex::run` still compose
   the same calls in the same order — `lib.rs`'s two wrappers reproduce those
   two bodies, so a change in either is a change here. Do not hand-adjust.
5. Read the diff for behavior changes that move dollar figures — see the
   four listed in
   `docs/superpowers/specs/2026-07-13-pricing-and-native-scanners-design.md`.
6. Any number that moves needs a release note.
