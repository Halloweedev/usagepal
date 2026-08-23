# UsagePal — Multi-Account Work Handoff

**Date:** 2026-08-16
**Branch:** `beta/v0.7.69` (tip `v0.7.69-beta.6`)
**Main branch:** `main` (nothing here merged to main yet)
**Scope of this handoff:** multi-account UX refinements, a stats regression + its
proper fix, and per-account local-spend attribution for Codex & Claude.

---

## TL;DR — current state

- All work is on `beta/v0.7.69`, shipped as betas **v0.7.69-beta.3 → beta.6**
  (each is a signed macOS build published by CI on tag push).
- Latest published: **v0.7.69-beta.6**. Both arm64 + x86_64 built green.
- Tests all green: **Rust 190**, **frontend 1887**, `tsc` clean.
- The broader multi-account feature also exists on `feat/multi-account-card-ui`
  (older base — the beta.3–beta.6 refinements below live only on `beta/v0.7.69`).
- **Not yet merged to `main`.** Deciding when to promote `0.7.69` from beta to
  stable is an open item (see below).

---

## What shipped, by beta

| Beta | Summary |
|------|---------|
| **beta.3** | Per-account notification dedup fix; drag-follow swipe; "＋" add-account on the card; account dots moved beside the plan badge; "·" separator removed; first (diffing-based) auto-refresh-on-add. |
| **beta.4** | Fix for Codex showing **0 for all stats** — a startup-restore regression from beta.3's auto-probe. (Patch, kept a startup timer.) |
| **beta.5** | Proper **event-driven** rewrite of auto-refresh-on-add (replaced the fragile state-diffing hook + timer). |
| **beta.6** | **Per-account local-spend attribution** for Codex & Claude, with an honest "no local data" state. |

---

## Key architecture decisions

### 1. Auto-refresh on account add is **event-driven** (beta.5)
`src/hooks/app/use-probe-on-account-added.ts`

- Do **not** infer "an account was added" by diffing `accountsByProvider` over
  time. `useAccounts` loads async, so at startup a normal launch looks identical
  to a burst of adds — that inference caused beta.3's blank-Codex bug.
- Instead, listen for the explicit add signals and probe **only** the added key:
  - Claude/Cursor → same-window `ACCOUNTS_CHANGED_EVENT` (carries
    `{added, providerId, accountId}`), emitted by `emitAccountsChanged(...)`.
  - Codex → native `codex:login-complete` event.
- ⚠️ **Do not reintroduce state-diffing for on-add side effects.** It cannot run
  at startup and can only touch the one added account — that's the invariant that
  keeps the stats-blank bug from returning.

### 2. Local-spend attribution (beta.6)
`src-tauri/src/accounts.rs`, `plugins/{codex,claude}/plugin.js`

- **Problem:** spend rows (Today/Yesterday/30d) come from local CLI logs via
  `ccusage`. Registered accounts probe a managed profile that has no logs →
  Codex showed **$0**; Claude read the shared `~/.claude` → **mis-attributed**
  the default login's spend to every account.
- **Hard constraint:** local session logs are **not account-tagged**, so spend
  can only ever belong to the account that is the **current local CLI login**.
- **Mechanism** (in `resolve_env_overrides`):
  - **Codex** — match the account's ChatGPT `account_id` against the real
    `~/.codex/auth.json`. Matched → set `CODEX_CCUSAGE_HOME` to the real home for
    ccusage (auth stays on the managed profile); unmatched → set
    `USAGEPAL_LOCAL_LOGS_UNAVAILABLE=1`.
  - **Claude** — setup-tokens are opaque, so capture the local identity
    (`~/.claude.json` → `oauthAccount.accountUuid`/`emailAddress`) **at
    registration** (`save_claude_account`). Matched → return empty env so it
    probes exactly like the default account (local creds → full usage + real
    spend); unmatched → setup-token + `USAGEPAL_LOCAL_LOGS_UNAVAILABLE=1`.
  - New whitelisted env vars in `host_api.rs`: `CODEX_CCUSAGE_HOME`,
    `USAGEPAL_LOCAL_LOGS_UNAVAILABLE`.
- **Plugins**: when the flag is set, emit the spend rows as a muted **"no local
  data"** state (`value: "—"`, `color: "#a3a3a3"`, subtitle hint) instead of
  computing from logs. Rendered by the existing text-line path in
  `provider-card.tsx` (no schema change).

---

## Known limitations & gotchas

- **Claude registered accounts can't fetch live usage.** The `setup-token` is
  inference-only (an Anthropic scope limit). Matched Claude accounts get full
  data by probing with **local credentials**; unmatched ones show little + "no
  local data". Not fixable on our side.
- **Claude accounts added before beta.6** have no captured identity → they read
  as "no local data" until re-added while signed into that account locally.
- **One local home can't be split across accounts.** Only the currently
  logged-in account shows local spend; the rest are honestly "no local data".
- **Codex identity matching** uses the real `~/.codex` (or `$CODEX_HOME` if the
  app inherited one). A GUI launch usually has no `CODEX_HOME`, so it defaults to
  `~/.codex`.
- **Bundled plugins are generated at build** (`beforeBuildCommand: bun run
  bundle:plugins && …`) and are **gitignored** — never commit
  `src-tauri/resources/bundled_plugins/**`.
- **Design spec** is at
  `docs/superpowers/specs/2026-08-16-multi-account-local-spend-attribution-design.md`
  — **gitignored** (project convention), local only.

---

## Open / follow-up items

- [ ] **Promote 0.7.69 to a stable release** — roll all beta entries into one
      stable changelog *before* tagging (changelog is baked into the build).
- [ ] **Merge to `main`** — `beta/v0.7.69` carries the refinements;
      `feat/multi-account-card-ui` is the older feature branch. Decide the
      integration path (likely merge `beta/v0.7.69`).
- [ ] **Cursor** local-spend: not audited for the same class of issue — check if
      Cursor multi-account has an analogous attribution gap.
- [ ] **Claude live usage for non-local accounts** — blocked upstream
      (setup-token scope); revisit only if Anthropic exposes a scoped usage read.
- [ ] Optionally surface the "no local data" reason in a tooltip on the "—" rows.

---

## File map (changed in this work)

**Frontend**
- `src/hooks/app/use-probe-on-account-added.ts` (+ `.test.ts`) — event-driven refresh
- `src/hooks/app/use-accounts.ts` — `emitAccountsChanged(detail)`, `ACCOUNTS_CHANGED_EVENT`
- `src/components/provider-card.tsx` — dots by plan, "·" removed, "＋", swipe wiring
- `src/components/provider-card-swipe.ts` (+ `.test.ts`) — drag-follow swipe
- `src/components/add-account-dialog.tsx` — `AddAccountDialogHost`, add detail
- `src/pages/{overview,provider-detail}.tsx`, `src/components/app/{main-app,app-content}.tsx` — `onAddAccount` wiring
- `src/lib/pace-notifications.ts` (+ `.test.ts`), `src/hooks/app/use-pace-notifications.ts` — per-account dedup

**Backend (Rust)**
- `src-tauri/src/accounts.rs` — `codex_spend_env`, `claude_account_env`,
  `codex_real_home*`, `claude_local_identity`, capture-at-registration
- `src-tauri/src/plugin_engine/host_api.rs` — env whitelist

**Plugins**
- `plugins/codex/plugin.js` (+ `.test.js`) — ccusage-home preference, no-local-data
- `plugins/claude/plugin.js` (+ `.test.js`) — local-logs flag, no-local-data

---

## Build / test / release commands

```bash
# Frontend
npx tsc --noEmit
npx vitest run                     # full suite
npx vitest run plugins/codex       # a single plugin's tests (run via vitest, NOT `node --test`)

# Rust
cd src-tauri && cargo test

# Run the app locally (bundles plugins first via beforeDevCommand)
bun run dev

# Release (CI publishes on tag push — publish.yml, macOS arm64 + x86_64, signed)
bun run version:bump 0.7.69-beta.N
# update CHANGELOG.md (top), commit as `chore(release): v0.7.69-beta.N`
git tag v0.7.69-beta.N
git push origin beta/v0.7.69 && git push origin v0.7.69-beta.N
gh run watch <run-id> --exit-status   # watch the build
```

**Note:** the updater key + signing secrets live only in CI; `build-release.sh`
is for local testing and cannot produce a publishable/updatable build.
