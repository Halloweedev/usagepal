//! Not byte-identical to upstream. Upstream's `adapter/mod.rs` declares 15
//! `pub(crate) mod` provider lines (`all`, `amp`, `codebuff`, `codex`,
//! `copilot`, `droid`, `gemini`, `goose`, `hermes`, `kilo`, `kimi`,
//! `openclaw`, `opencode`, `pi`, `qwen`). We vendor only `codex.rs` (see
//! `VENDORING.md`, "The cut line" and "Files taken"), so the other 14 `mod`
//! lines are pruned here — this is the brief's explicitly permitted edit
//! ("deleting a `mod x;` line ... must be recorded" in VENDORING.md).
//!
//! No other change: the one line that remains is copied verbatim.

pub(crate) mod codex;
