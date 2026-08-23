# Work Session Tracking — Design Handoff

> Track what work was actually done with Claude Code and Codex, per repo, per session, with hours and tokens — sourced from local transcripts. Foundation for the cloud sync and leaderboards roadmap item.

Status: design complete, not yet implemented. Last updated 2026-07-14.

## Vision

Today UsagePal answers "how much of my plan have I burned?" — API/credit consumption from provider APIs. This feature answers a different question: **"what did I actually do, on which repo, for how long, using how many tokens?"** It's "GitHub Contributions for AI coding sessions," sourced from the transcripts Claude Code and Codex already write to disk.

Scope for v1: **Claude Code and Codex only.** Cursor is deferred (opaque SQLite storage, fragile to reverse-engineer — see "Deferred" below).

## Key decisions (from the design conversation)

These are settled. Read this section before questioning the approach.

### 1. Transcripts, not process monitoring

Process monitoring (watching for `claude`/`codex` processes) sounds simpler but gives worse data:
- **No tokens.** Token counts only exist in API responses written to transcripts. A running process doesn't expose them.
- **No history.** You can only track from the moment monitoring starts. The 5 months of Codex data and 1 month of Claude data already on disk are unreachable.
- **Inflated time.** The process is alive the whole time the CLI session is open — including idle waits, lunch breaks, reading output. Process alive time ≠ work time.
- **No task names, no sessions, no model.**

Transcripts give per-message timestamps (derive active time by splitting at idle gaps), tokens, repo, branch, session grouping, task names, and full history — all in one source.

The one useful thing process monitoring adds is a **live "agent is running right now" indicator** — a small future feature on top of the transcript parser, not a replacement for it.

### 2. Direct transcript parsing, not ccusage

ccusage is already integrated in the host (`src-tauri/src/plugin_engine/host_api.rs`) and used by the existing Claude/Codex plugins. But it's the wrong tool for this feature:

- ccusage outputs `{ daily: [{ date, totalTokens, modelBreakdowns }] }` — day → model → tokens/cost. That's it.
- It **discards** repo (`cwd`), session ID, task names, timestamps, and time/hours — exactly the dimensions this feature needs.
- Using ccusage for tokens would mean parsing the same 1 GB of files twice (ccusage + our own parser for the other dimensions) for no benefit.

ccusage stays for the existing plan-consumption stats (it owns the per-model pricing table — a maintenance burden we don't want). The new work-tracking data comes from a **separate Rust parser** that keeps the dimensions ccusage throws away.

### 3. Allowlist parsing, not blocklist redaction

The existing host redaction system (`host_api.rs:78-119`) is a **blocklist** — 36+ sensitive key names redacted from HTTP response logs. Right for HTTP, where plugins need the full response.

Transcripts are the opposite: mostly sensitive (full prompts, code, file contents, tool outputs) and we want a tiny metadata slice. So the parser uses an **allowlist** — it reads only named fields and structurally has no code path that touches message content. Safety is enforced by the parser's output type having no field for content. No "parse everything then scrub" step exists.

### 4. "All time" scope, not 30-day limited

The current 30-day window is a plugin-side choice (`since.setDate(since.getDate() - 30)` at `plugins/claude/plugin.js:513`, `plugins/codex/plugin.js:454`) chosen because ccusage re-parses from scratch each run and 30 days keeps that fast. Once we own the parser and persist to SQLite, that constraint disappears.

"All time" means **everything since the user first ran the tool on that machine.** It's not truly lifetime — if they wiped `~/.claude` or reinstalled, the clock resets. Call it "All Time" in the UI, not "Lifetime."

### 5. Codex's own time tracking is the gold

Codex tracks `timeUsedSeconds` and `tokensUsed` per goal in `thread_goal_updated` events — the agent's own accounting of active time. Confirmed populated on real data (e.g. one goal = 1,646 sec / 683,288 tokens; 17 of 40 goals have nonzero values). This is more accurate than any heuristic we'd invent. Claude has no equivalent — time there must be derived from message timestamps with an idle-gap heuristic.

---

## All extractable data — Claude Code

Source: `~/.claude/projects/<repo-path-as-dashes>/<session-id>.jsonl` — one JSONL file per session. Each line is a JSON event. Cross-platform path (`~/.claude/` works on macOS, Windows, Linux).

### Per-session metadata

| Data | Source field | Example |
|---|---|---|
| Session ID | `sessionId` | `0e10b41f-5e32-4041-a4f2-6215836e6c3f` |
| Repo / working directory | `cwd` | `/Users/halloweed/Coding/Projects/usagepal` |
| Git branch | `gitBranch` | `main` |
| Claude Code version | `version` | `2.1.197` |
| Entrypoint | `entrypoint` | `cli`, `sdk-cli`, `claude-desktop` |
| Session title | `ai-title` line → `aiTitle` | (10,068 titles in sampled data) |
| Permission mode | `permissionMode` | `auto`, `acceptEdits`, `default` |
| Worktree usage | `worktree-state` → `worktreeSession` | original cwd + worktree path + name |
| PRs created | `pr-link` → `prNumber`, `prUrl`, `prRepository` | `github.com/keylight-dev/keylight-rust/pull/2` |

### Per-message data (every user + assistant line)

| Data | Source field |
|---|---|
| Timestamp | `timestamp` (ISO 8601) |
| Message type | `type` (`user` / `assistant` / `system`) |
| Prompt source | `promptSource` (`typed`, `system`, `queued`, `sdk`, `suggestion_accepted`) |
| Origin | `origin.kind` (`human`, `task-notification`, `coordinator`) |
| Is sidechain (sub-agent) | `isSidechain` |
| Agent ID (sub-agents) | `agentId` |
| Skill attribution | `attributionSkill` |
| Plugin attribution | `attributionPlugin` |
| MCP server/tool attribution | `attributionMcpServer`, `attributionMcpTool` |

### Per-assistant-turn data

| Data | Source field | Example |
|---|---|---|
| Model | `message.model` | `claude-opus-4-8` |
| Input tokens | `message.usage.input_tokens` | 16,191 |
| Output tokens | `message.usage.output_tokens` | 489 |
| Cache creation tokens | `usage.cache_creation_input_tokens` | 2,950 |
| Cache read tokens | `usage.cache_read_input_tokens` | 16,522 |
| Cache tier breakdown | `usage.cache_creation.ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens` | 1h: 2950, 5m: 0 |
| Web searches | `usage.server_tool_use.web_search_requests` | 0 |
| Web fetches | `usage.server_tool_use.web_fetch_requests` | 0 |
| Service tier | `usage.service_tier` | `standard` |
| Inference geography | `usage.inference_geo` | `not_available` |
| Speed tier | `usage.speed` | `standard` |
| Stop reason | `message.stop_reason` | `tool_use`, `end_turn`, `stop_sequence` |
| API error | `apiErrorStatus`, `error`, `errorDetails` | (246 api_error events in sampled data) |

### Per-turn timing (system lines)

| Data | Source field | Example |
|---|---|---|
| Turn wall-clock duration | `system` subtype `turn_duration` → `durationMs` | 8,726,821 ms (~2.4 h) |
| Messages in turn | `turn_duration` → `messageCount` | 329 |
| Stop-hook timing | `stop_hook_summary` → `hookInfos[].durationMs` | 105 ms, 370 ms |
| Away detection | `away_summary` subtype | (524 in sampled data — gaps where user stepped away) |

### Tool usage (from assistant message content blocks)

| Data | Source field | Example |
|---|---|---|
| Tool name | `content[].name` | `Bash`, `Read`, `Edit`, `Write`, `Agent`, `Skill` |
| Tool call count | (count of `tool_use` content blocks) | 33,591 Bash calls in sampled data |
| MCP tool calls | `mcp__*` tool names | `mcp__plugin_playwright__browser_navigate` |
| Tool denials | user line → `toolDenialKind` | (user rejected a tool call) |

### Attachment events (metadata only — never content)

| Data | Source field | Sampled count |
|---|---|---|
| Hook executions | `hook_success` | 33,350 |
| Task reminders | `task_reminder` | 3,580 |
| Skill listings | `skill_listing` | 2,629 |
| Deferred tools | `deferred_tools_delta` | 2,709 |
| Diagnostics | `diagnostics` | 411 |
| Edited files | `edited_text_file` | 327 |
| Plan mode entries/exits | `plan_mode`, `plan_mode_exit` | 77 |
| Goal status updates | `goal_status` | 11 |

### Fields deliberately never read (sensitive)

`message.content` (prompt/response text), `toolUseResult` (file contents, command outputs), `attachment` (hook outputs — can contain system prompts), user message `content`. These have no field in the parser's output type.

---

## All extractable data — Codex

Source: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — one JSONL file per session, organized by date. Plus `~/.codex/session_index.jsonl` (one line per session with id, thread_name, updated_at). Cross-platform via `$CODEX_HOME` override.

### Per-session metadata

| Data | Source field | Example |
|---|---|---|
| Session ID | `session_meta.session_id` | `019f5b32-8282-7a40-8740-cafa52b7ed8f` |
| Repo / working directory | `session_meta.cwd` | `/Users/halloweed/Coding/Projects/keylight` |
| Git commit hash | `session_meta.git.commit_hash` | `06f49fb2...` |
| Git branch | `session_meta.git.branch` | `feature/customized-roadmap-profree` |
| **Repository URL** | `session_meta.git.repository_url` | `https://github.com/halloweedev/theroadmappr.git` |
| CLI version | `session_meta.cli_version` | `0.144.0-alpha.4` |
| Source | `session_meta.source` | `vscode`, `cli` |
| Originator | `session_meta.originator` | `Codex Desktop`, `codex_cli_rs`, `codex-tui` |
| Model provider | `session_meta.model_provider` | `openai` |
| Thread source | `session_meta.thread_source` | `user` |
| Forked from | `session_meta.forked_from_id` | (session this was forked from) |
| Parent thread | `session_meta.parent_thread_id` | (for sub-agent threads) |
| Agent role | `session_meta.agent_role` | (multi-agent) |
| Agent nickname | `session_meta.agent_nickname` | (multi-agent) |
| Context window | `session_meta.model_context_window` | 258,400 |
| History mode | `session_meta.history_mode` | |
| Memory mode | `session_meta.memory_mode` | |
| Task name | `session_index.thread_name` or `thread_name_updated` event | "Review docs markdown files" |
| Task objective | `thread_goal_updated.goal.objective` | "Simplify the payment UX..." |
| Task status | `thread_goal_updated.goal.status` | `active` |

### Per-turn data

| Data | Source field | Example |
|---|---|---|
| Turn ID | `task_started.turn_id` / `task_complete.turn_id` | `019f5b33-...` |
| Turn start time | `task_started.started_at` (epoch seconds) | 1783941559 |
| Turn end time | `task_complete.completed_at` (epoch seconds) | 1777378701 |
| **Turn duration** | `task_complete.duration_ms` | 58,105 ms |
| **Time to first token** | `task_complete.time_to_first_token_ms` | (latency metric) |
| Collaboration mode | `task_started.collaboration_mode_kind` | `default` |
| Model context window | `task_started.model_context_window` | 258,400 |

### Token usage (per `token_count` event)

| Data | Source field |
|---|---|
| Input tokens | `info.total_token_usage.input_tokens` |
| Cached input tokens | `info.total_token_usage.cached_input_tokens` |
| Output tokens | `info.total_token_usage.output_tokens` |
| Reasoning output tokens | `info.total_token_usage.reasoning_output_tokens` |
| Total tokens | `info.total_token_usage.total_tokens` |
| Last-turn usage (delta) | `info.last_token_usage.*` (same sub-fields) |
| Context window size | `info.model_context_window` |

### Rate limit / plan data (per `token_count` event)

| Data | Source field |
|---|---|
| Plan type | `rate_limits.plan_type` (`plus`, `pro`) |
| Usage percent | `rate_limits.primary.used_percent` |
| Window duration | `rate_limits.primary.window_minutes` |
| Reset time | `rate_limits.primary.resets_at` (epoch) |
| Credits | `rate_limits.credits` |

### Per-goal tracking (Codex's own accounting — the gold)

| Data | Source field | Example |
|---|---|---|
| **Time spent** | `thread_goal_updated.goal.timeUsedSeconds` | 1,646 sec (~27 min) |
| **Tokens used** | `thread_goal_updated.goal.tokensUsed` | 683,288 |
| Goal created at | `goal.createdAt` (epoch) | 1783942298 |
| Goal updated at | `goal.updatedAt` (epoch) | 1783942298 |

Caveat: `timeUsedSeconds`/`tokensUsed` populate only for goals Codex marks. Sessions killed mid-task may show zero (17 of 40 goals nonzero in sampled data). For zero-value goals, fall back to deriving time from first→last timestamp in the rollout file.

### Tool / action events

| Data | Source field | Sampled count |
|---|---|---|
| Patches applied | `patch_apply_end` → `status`, `success`, `changes` | 476 |
| MCP tool calls | `mcp_tool_call_end` → `invocation`, `duration` | 444 |
| Web searches | `web_search_end` → `query`, `action` | 38 |
| Shell commands | `exec_command_end` → `command`, `cwd`, `process_id` | 46 |
| Context compactions | `context_compacted` | 27 |
| Sub-agent activity | `sub_agent_activity` → `kind`, `agent_path` | 22 |
| Turn aborts | `turn_aborted` | 11 |
| Thread rollbacks | `thread_rolled_back` | 4 |

### Fields deliberately never read (sensitive)

`payload.message` (user prompts), `payload.content` (developer/agent messages — full text), `base_instructions` (system prompt), `agent_reasoning` (chain of thought), `last_agent_message` (full response text), `world_state.agents_md` (AGENTS.md contents).

---

## Cross-agent derived stats

Stats that become possible once both sources are aggregated:

- **Total time coding with AI** — Claude derived time + Codex `timeUsedSeconds`
- **Total tokens** — both sources summed
- **Time per repo across agents** — same repo worked on with both Claude and Codex
- **Agent preference per repo** — which tool the user reaches for per project
- **Active days / streaks** — distinct dates with activity from either source
- **Sessions per day / per repo** — both sources
- **Model diversity** — distinct models used (Claude models + Codex/GPT models)
- **Tool usage patterns** — Bash/Read/Edit (Claude) vs patches/commands (Codex)
- **PRs created** — from Claude `pr-link` events
- **Per-repo GitHub URL** — from Codex `git.repository_url` (Claude doesn't expose this — natural key for cross-Mac sync)

---

## Safety & privacy model

Three layers, each independent:

### Layer 1 — Parse (allowlist)

The Rust parser reads each JSONL line, extracts only the allowlisted fields (listed above), and drops the rest immediately. Message content never enters an intermediate structure, never gets logged, never touches SQLite. Enforced structurally: the parser's output type has no field for content. If the parser has no code path that reads `content`, there's no code path that can leak it.

### Layer 2 — Local storage (metadata only)

SQLite stores only metadata rows: date, repo, session, tokens, time, model. No text columns for content. The DB is safe to inspect or back up.

### Layer 3 — Cloud sync (aggregates only)

Only aggregated daily rows leave the machine: `2026-07-14: usagepal repo, 2 sessions, 1.3h, 23K tokens, claude-opus`. Never raw messages, never task names unless explicitly opted in, never file paths beyond the repo folder name. Matches the roadmap's existing spec: "aggregated, never raw prompts/code."

### The one judgment call: task names

Codex `thread_name` / `objective` are short task descriptions ("Review docs markdown files"). Useful — they're the "what work was done" label — but user-written, so could theoretically contain sensitive info.

- **Locally:** include as-is (it's the user's own data on their own machine).
- **Cloud sync:** **opt-in.** The default aggregated daily row omits task names. A toggle lets users share them if they want richer public profiles.

---

## "All time" performance

Benchmarked on real data (Python, cold parse, no cache):

| Source | Files | Size | Messages | Tokens | Parse time |
|---|---|---|---|---|---|
| Claude | 2,665 | 1,025 MB | 144,078 assistant | 158M | 4.4 s |
| Codex | 104 | 165 MB | — | — | <1 s |

Rust will be faster (~1-2 s for Claude). With a SQLite store (parse once, then only re-read files modified since last sync — track by file mtime), subsequent refreshes are near-instant. The 30-day window exists purely because ccusage re-parses from scratch; once we own the parser and persist, it's obsolete.

---

## Connection to cloud sync & leaderboards

This feature is the **prerequisite** for the "Leaderboards & Social Profiles" roadmap item (`docs/ROADMAP.md:34-40`). The sync can't send what it can't compute.

- The leaderboard scoring model rewards **consistency** (streaks, active days, capped token usage, model diversity) over raw spend — never "spend more to rank higher."
- Those dimensions (per-repo, per-session, hours, active days) only exist in transcripts. ccusage throws them away.
- So the work-tracking parser built for the local "All Time" stat is the **same code** that produces the payload for cloud sync.

**What syncs:** aggregated daily rows — "July 14: 3 repos, 2.1 hours, 47K tokens, 8 sessions." One row per day per repo. Never raw messages, never code.

**Cross-Mac access:** the same aggregated rows sync from each machine to one GitHub-authenticated account. Codex's `git.repository_url` is the natural key for matching the same repo across machines.

**Build order:** local all-time work tracking (this doc) → cloud sync of aggregated daily rows → leaderboard and public profiles on top. Each layer enables the next.

---

## Architecture proposal

### New Rust module: transcript parser

Location: `src-tauri/src/work_tracking/` (new module).

```
src-tauri/src/work_tracking/
  mod.rs          — module root, public API
  claude.rs       — Claude transcript parser (allowlist fields only)
  codex.rs        — Codex rollout parser (allowlist fields only)
  store.rs        — SQLite persistence (metadata rows only)
  aggregate.rs    — queries: per-repo, per-session, per-day, all-time
```

### Output types (allowlist-enforced)

```rust
// Claude — one row per assistant message
struct ClaudeMessageRow {
    session_id: String,
    timestamp: f64,          // ISO → epoch ms (f64 for IPC, no i64)
    cwd: String,             // repo path
    git_branch: Option<String>,
    model: String,
    input_tokens: f64,
    output_tokens: f64,
    cache_creation_tokens: f64,
    cache_read_tokens: f64,
    // NO content field — structurally impossible to leak
}

// Codex — one row per session (aggregated from events)
struct CodexSessionRow {
    session_id: String,
    cwd: String,
    git_branch: Option<String>,
    repo_url: Option<String>,    // from git.repository_url
    started_at: f64,
    time_used_seconds: f64,      // from goal.timeUsedSeconds (0 if unknown)
    tokens_used: f64,            // from goal.tokensUsed
    task_name: Option<String>,   // from thread_name (local only; opt-in for sync)
    source: String,              // vscode | cli
    originator: String,
}
```

Note: `f64` for all counts/timestamps crossing the IPC boundary (specta forbids `u64`/`i64`/`usize` — BigInt precision loss in JS).

### SQLite schema (metadata only)

```sql
CREATE TABLE claude_messages (
  session_id TEXT, ts_ms REAL, cwd TEXT, git_branch TEXT,
  model TEXT, input_tokens REAL, output_tokens REAL,
  cache_creation REAL, cache_read REAL
);
CREATE TABLE codex_sessions (
  session_id TEXT PRIMARY KEY, cwd TEXT, git_branch TEXT,
  repo_url TEXT, started_at REAL, time_used_seconds REAL,
  tokens_used REAL, task_name TEXT, source TEXT, originator TEXT
);
CREATE TABLE sync_state (
  source TEXT, file_path TEXT, file_mtime_ms REAL, PRIMARY KEY (source, file_path)
);
```

Incremental sync: on refresh, walk transcript dirs, compare file mtime against `sync_state`, parse only changed/new files, upsert rows.

### IPC commands (specta-generated)

New commands registered in `src-tauri/src/lib.rs` `run()`:
- `get_work_summary(period: WorkPeriod) -> WorkSummary` — per-repo aggregates (today / week / month / all-time)
- `get_repo_breakdown(period) -> Vec<RepoBreakdown>` — per-repo hours/tokens/sessions
- `get_session_list(repo_path, period) -> Vec<SessionRow>` — per-session detail
- `refresh_work_tracking()` — re-scan transcripts (incremental)

New event: `work-tracking-updated` — emitted when refresh completes.

### Frontend

New UI surface — either:
- **Lighter:** new `lines` on existing Claude/Codex plugin cards ("Hours this week", "Sessions per repo").
- **Bigger (recommended):** a new "Work" / "Projects" view aggregating both agents, showing per-repo breakdowns with hours, tokens, sessions, last active, and (Codex) task names. This is the version that delivers the "you worked on this repo for X hours using X tokens" framing.

---

## Build phases

### Phase 1 — Claude transcript parser + store
- `work_tracking/claude.rs`: walk `~/.claude/projects/`, parse allowlisted fields per line
- `work_tracking/store.rs`: SQLite schema, upsert, incremental mtime sync
- Unit tests with fixture JSONL lines (use the field shapes above, not real transcripts)
- Verify: parse all local Claude transcripts, assert token total is in the right ballpark vs ccusage

### Phase 2 — Codex transcript parser + store
- `work_tracking/codex.rs`: walk `~/.codex/sessions/`, parse `session_meta` + `token_count` + `thread_goal_updated` + `task_complete`
- Handle `timeUsedSeconds=0` fallback (derive from first→last timestamp)
- Unit tests with fixture rollout lines
- Verify: parse all local Codex rollouts, assert session count matches `session_index.jsonl` line count

### Phase 3 — Aggregation queries + IPC
- `work_tracking/aggregate.rs`: per-repo, per-session, per-day, all-time
- `#[tauri::command]` + `#[specta::specta]` commands, register in `lib.rs` `run()` and `export_bindings` test
- Regenerate bindings: `cd src-tauri && cargo test test_export_bindings`
- Verify: `cargo test` passes, bindings regenerate cleanly

### Phase 4 — Frontend UI
- The "Work" / "Projects" view (recommended) — per-repo breakdown, hours, tokens, sessions, task names
- Wire to IPC commands, handle `null` (not `undefined`) for `Option<T>` fields
- Verify: manual — shows real data from both agents, correct per-repo grouping

### Phase 5 — All-time + caching
- Drop the 30-day cutoff (pass no `--since` equivalent — we own the parser)
- Incremental mtime-based refresh (only re-parse changed files)
- Verify: first run parses full history (~2-4 s), second run is near-instant

### Phase 6 (future, separate) — Cloud sync + leaderboard
- Not in this handoff. Depends on Phase 1-5 producing the aggregated daily rows.
- Follows the "Leaderboards & Social Profiles" roadmap entry.

---

## Deferred / out of scope for v1

- **Cursor** — chat data in VS Code-style SQLite/IndexedDB (`globalStorage/state.vscdb`) with undocumented schema that changes between versions. No reliable per-message token counts locally (Cursor's usage is credit-based on their backend). Reverse-engineered and fragile. Defer until Claude+Codex are shipped.
- **Cost in USD** — ccusage owns the per-model pricing table (maintenance burden). For v1, show tokens and time, not cost. Cost can be added later by either reusing ccusage's pricing data or maintaining our own table.
- **Live "agent running" indicator** — requires process monitoring. Small future feature on top of the transcript parser, not part of v1.
- **Cloud sync / leaderboard** — Phase 6, separate handoff. This doc is the foundation.

---

## Open questions

1. **Idle-gap threshold for Claude "active time"** — 10 min? 15 min? Should be configurable, default to a value validated against `away_summary` events (Claude already detects away gaps — calibrate against those).
2. **Repo display name** — show full `cwd` path, or just the last folder name (e.g. `usagepal` not `/Users/halloweed/Coding/Projects/usagepal`)? Last folder is cleaner but can collide (two repos named `app`). Codex `repository_url` disambiguates when available.
3. **Task name cloud-sync default** — opt-in confirmed, but what's the right toggle granularity? Per-session, per-repo, or global?
4. **SQLite location** — alongside existing app data dir? Needs to survive app updates. Check `app-state-architecture.md` for the established pattern.
