# Agents

The Agents page shows which AI coding sessions have been active on this Mac — one list across Claude Code, Codex, Cursor, OpenCode, and OpenCode2, most recent first. Working sessions stay visible; idle ones fade into the Recent list.

## What you see

- **Project** — the folder the session works in (e.g. `usagepal`).
- **Title** — the session's own title when it has a meaningful one (OpenCode titles show here; generic `New session - …` placeholders are hidden).
- **Provider and session** — which tool it belongs to, plus a short session id.
- **Last active** — how long ago the session last did something (`just now`, `5m ago`, `3h ago`).
- **Status** — Active (the session's process tree is burning CPU, was seen running, or wrote output in the last minute), Idle (alive but quiet — e.g. waiting on an approval), or Closed (no running process; for Claude this is exact, since every session runs as its own process).

Each provider header shows its count on the right (`6 active`, `3 idle`, `2 closed`).

The page refreshes when you open it and every minute while it stays open. Results are cached for 15 seconds so reopening the tab is instant; the refresh button always recomputes from scratch.

## Filters

The status filter shows All, Active, Idle — each with its count — plus a button for any other status that shows up in your data. Pick one to narrow the list; the empty result offers a Show All reset.

## Hiding a provider

Click a provider's header (e.g. Claude Code) to hide its sessions; click again to bring them back. The chevron points at the current state. This only affects the Agents page and resets when you reopen it — your usage tracking settings are untouched.

## Subagents

Claude Code sessions that spawned Task subagents show them nested underneath (`↳ 2 subagents (1 active) · Explore, general-purpose`, hover for task descriptions). A subagent counts as running when its transcript was just written under a live parent session. Codex and OpenCode subagents aren't listed yet.

## Privacy

Everything is 100% local. The app only reads file metadata:

- Claude Code: the names and modification times of files in `~/.claude/projects/`, plus each subagent's tiny `agent-*.meta.json` sidecar (agent type, task label, model — never message content).
- Codex: the names and modification times of rollout files in `~/.codex/sessions/`, plus the working directory from each file's first-line `session_meta` record.
- Cursor: the modification times of workspace folders plus the folder path in each `workspace.json`.
- OpenCode / OpenCode2: session id, working directory, title, and timestamps from the `session` / `session_v2` tables in the local `opencode.db` (read-only query via the `sqlite3` CLI — a missing binary or locked database simply shows no sessions).

Message content and code are never read, and nothing leaves your machine.

## Limitations

- **Status is observed, not reported.** Active means the process tree burned CPU past a calibrated threshold across two samples 500ms apart, was seen running, or wrote output in the last minute (streaming tokens). A hard-thinking agent paused between tool calls can read as Idle for one poll. Closed for Claude is exact (no process, no session).
- **Sessions older than 30 days are hidden** to keep the list relevant.
- **Claude project names are best-effort.** Folder names containing dashes decode ambiguously from the on-disk slug.
- **Approvals are not here yet.** Approving or denying a waiting permission request from UsagePal needs a new action channel (plugins are read-only today) and is planned separately.
