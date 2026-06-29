# AGENTS.md

Version: 0.31 (2026-06-10)

> OpenUsage is a public-facing Tauri desktop app for tracking AI provider usage across plugins.

## Rollout: Tauri to Swift (read first)

OpenUsage is being rewritten as a native Swift app. During the transition, two editions ship from this one repo and stay fully independent:
- Identity: Tauri is `com.sunstory.openusage`; Swift is `com.robinebers.openusage` (macOS treats them as different apps).
- Updates: Tauri reads `latest.json` from GitHub's "Latest" release; Swift uses a Sparkle appcast on the `gh-pages` branch. They never cross.
- Pipelines: `main` + `.github/workflows/publish.yml` (Tauri); `swift` + `.github/workflows/release.yml` (Swift). Active development now happens on `swift`.

### Guardrails (do not break)
- Version lanes: Tauri stays on `0.6.x`; the Swift rewrite owns `0.7.x` and up. One `vX.Y.Z` tag namespace is shared, so never reuse a number across editions.
- Keep every Swift release marked as a GitHub pre-release until the owner explicitly approves going public. A non-prerelease Swift release becomes GitHub "Latest" and silently breaks the Tauri auto-updater (it fetches `releases/latest/download/latest.json`).
- Cut Tauri tags from a `main` commit (runs `publish.yml`); cut Swift tags from a `swift` commit (runs `release.yml`). A tag only triggers the workflow present in the commit it points at.
- Never leave a release in Draft. After every release, verify it is published with its assets (use the release-tauri skill here; the swift branch has its own release-swift skill).
- The Tauri edition stays in this repo forever (frozen, never deleted).

### Phases
1. Now - private Swift testing. Testers install the Swift DMG by hand, then enable Settings > Updates > Early Access to get `v0.7.0-beta.N` builds via Sparkle. Tauri users are untouched.
2. Goodbye Tauri release. Cut the final Tauri build (retirement banner) with the release-tauri skill, e.g. `v0.6.28`. It becomes "Latest", auto-updates all Tauri users, and shows the "OpenUsage Has Moved" banner. Ship this BEFORE Phase 3.
3. Flip Swift public. When the owner approves, cut a Swift stable release for everyone with the swift branch's release-swift skill. Only here may a Swift release drop the pre-release flag.
4. Preserve Tauri. Make `swift` the default branch (the new `main`); rename today's Tauri `main` to `tauri-legacy` and freeze it. Tauri code and tags stay in the repo permanently.

## Documentation

- Logic changes must update any docs in `docs/` that describe the affected behavior.
- Plans must list the doc files that need updating as part of the work.
- Exclude design from docs, and keep them simple, less-technical, easy to skim.

## Guardrails

- Use `trash` for deletes
- Use `mv` / `cp` to move and copy files
- Bugs: add regression test when it fits
- Keep files <~500 LOC; split/refactor as needed
- Before writing code, strictly follow the below research rules

## Research

- Check for and prefer available skills over web research.
- Prefer researched knowledge over your own knowledge when skills are unavailable.
- Research: Exa to general search, Context7 for official docs, GitHits for open source examples
- Best results: Quote exact errors; prefer late-2025/2026+ sources.

## Error Handling

Always fail loudly into error logging (e.g., Sentry) and but show friendly errors to the user. Do not add silent fallbacks that hide real problems.

## UI

Always use titlecase any hardcoded copy for titles.

Strictly use `@hugeicons-pro/core-solid-rounded`. Nothing else. If you come across `lucide-react` or similar, replace it. Pattern: `<HugeiconsIcon icon={FooIcon} className="size-4" />`. Never pass `strokeWidth` (paints an unwanted outline on filled glyphs).

## Automated Testing

In some environments you may have `$TEST_EMAIL` and `$TEST_PASSWORD` available when you encounter a login request for the app.

## Agent Guidance

When you have enough information to act, act. Do not re-derive facts already established in the conversation, re-litigate a decision the user has already made, or narrate options you will not pursue in user-facing messages. If you are weighing a choice, give a recommendation, not an exhaustive survey. This does not apply to thinking blocks.

Don't add features, refactor, or introduce abstractions beyond what the task requires. A bug fix doesn't need surrounding cleanup and a one-shot operation usually doesn't need a helper. Don't design for hypothetical future requirements: do the simplest thing that works well. Avoid premature abstraction and half-finished implementations. Don't add error handling, fallbacks, or validation for scenarios that cannot happen. Trust
internal code and framework guarantees. Only validate at system boundaries (user input, external APIs). Don't use feature flags or backwards-compatibility shims when you can just change the code.

Lead with the outcome. Your first sentence after finishing should answer "what happened" or "what did you find": the thing the user would ask for if they said "just give me the TLDR." Supporting detail and reasoning come after. Being readable and being concise are different things, and readability matters more.

The way to keep output short is to be selective about what you include (drop details that don't change what the reader would do next), not to compress the writing into fragments, abbreviations, arrow chains like A → B → fails, or jargon.

Pause for the user only when the work genuinely requires them: a destructive or irreversible action, a real scope change, or input that only they can provide. If you hit one of these, ask and end the turn, rather than ending on a promise.

Before reporting progress, audit each claim against a tool result from this session. Only report work you can point to evidence for; if something is not yet verified, say so explicitly. Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.

When the user is describing a problem, asking a question, or thinking out loud rather than requesting a change, the deliverable is your assessment. Report your findings and stop. Don't apply a fix until they ask for one. Before running a command that changes system state (restarts, deletes, config edits), check that the evidence actually supports that specific action. A signal that pattern-matches to a known failure may have
a different cause.

Delegate independent subtasks to subagents and keep working while they run. Intervene if a subagent goes off track or is missing relevant context.

Store one lesson per file with a one-line summary at the top. Record corrections and confirmed approaches alike, including why they mattered. Don't save what the repo or chat history already records; update an existing note rather than creating a duplicate; delete notes that turn out to be wrong.

You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking "Want me to…?" or "Shall I…?" will block the work. For reversible actions that follow from the original request, proceed without asking. Offering follow-ups after the task is done is fine; asking permission after already discussing with the user before doing the work is not. Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done ("I'll…", "let me know when…"), do that work now with tool calls. End your turn only when the task is complete or you are blocked on
input only the user can provide.

You have ample context remaining. Do not stop, summarize, or suggest a new session on account of context limits. Continue the work.

I'm working on [the larger task] for [who it's for]. They need [what the output enables]. With that in mind: [request].

Terse shorthand is fine between tool calls (that's you thinking out loud, and brevity there is good). Your final summary is different: it's for a reader who didn't see any of that.

If you've been working for a while without the user watching (overnight, across many tool calls, since they last spoke), your final message is their first look at any of it. Write it as a re-grounding, not a continuation of your working thread: the outcome first, then the one or two things you need from them, each explained as if new. The vocabulary you built up while working is yours, not theirs; leave it behind unless you re-introduce it.

When you write the summary at the end, skip the technical jargon. Write like you'd explain it to a non-engineer, without dumbing it down too much. Write complete sentences. When you mention files, commits, flags, or other identifiers, give each one its own plain-language clause. Open with the outcome: one sentence on what happened or what you found. Then the supporting detail. If you have to choose between short and clear, choose clear.

## Before Creating Pull Request

- Before creating a PR or pushing to main, ensure that `README.md` is updated with what plugins are supported.
- On any plugin change/new plugin, audit plugin-exposed request/response fields against `src-tauri/src/plugin_engine/host_api.rs` redaction lists and add/update tests for gaps. Compare with existing plugins for patterns.
- In `plugin.json`, set `brandColor` to the provider's real brand color.
- Plugin SVG logos must use `currentColor` so icon theming works correctly.
- If the PR includes visual changes, refuse to create it without providing before/after screenshots.

## Project Memories

Use below list to store and recall user notes when asked to do so.

- Use this list when asked to remember things. Keep each list item concise.
- Tauri IPC: JS must use camelCase (`{ batchId, pluginIds }`), Tauri auto-converts to Rust's snake_case. Never send snake_case from JS—params silently won't match.
- tauri-action `latest.json`: Parallel matrix builds are safe—action fetches existing `latest.json`, merges platform entries, re-uploads. No `max-parallel: 1` needed.
