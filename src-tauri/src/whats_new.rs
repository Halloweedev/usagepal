//! Release-notes extraction for the "What's New" window. The changelog is embedded
//! at compile time via `include_str!` and parsed by `parse_release_notes` into typed
//! blocks. The window shows when the persisted `lastSeenVersion` differs from the
//! running version; dismissal saves the current version and opens the tray panel.

use serde::Serialize;
use specta::Type;

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct ReleaseNotesSection {
    pub title: String,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct ReleaseNotes {
    pub version: String,
    pub summary: String,
    pub sections: Vec<ReleaseNotesSection>,
}

pub const LAST_SEEN_VERSION_KEY: &str = "lastSeenVersion";

/// Parse all version blocks from the changelog, in file order (newest-first).
fn parse_all_versions(changelog: &str) -> Vec<ReleaseNotes> {
    let mut versions: Vec<ReleaseNotes> = Vec::new();
    let mut current_block: Option<ReleaseNotes> = None;
    let mut current_section: Option<ReleaseNotesSection> = None;

    for line in changelog.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("## v") {
            // Finalize the previous section and block.
            if let Some(section) = current_section.take() {
                if let Some(block) = &mut current_block {
                    block.sections.push(section);
                }
            }
            if let Some(block) = current_block.take() {
                versions.push(block);
            }

            let version = trimmed
                .strip_prefix("## v")
                .unwrap_or("")
                .trim()
                .to_string();
            current_block = Some(ReleaseNotes {
                version,
                summary: String::new(),
                sections: Vec::new(),
            });
            current_section = None;
            continue;
        }

        let Some(block) = &mut current_block else { continue };

        if trimmed.starts_with("### ") {
            if let Some(section) = current_section.take() {
                block.sections.push(section);
            }
            let title = trimmed
                .strip_prefix("### ")
                .unwrap_or("")
                .trim()
                .to_string();
            // Skip the "### Changelog" section (Full Changelog links).
            current_section = if title == "Changelog" {
                None
            } else {
                Some(ReleaseNotesSection {
                    title,
                    items: Vec::new(),
                })
            };
        } else if trimmed.starts_with("- ") {
            if let Some(section) = &mut current_section {
                let item = trimmed
                    .strip_prefix("- ")
                    .unwrap_or("")
                    .trim()
                    .to_string();
                section.items.push(item);
            }
        } else if !trimmed.is_empty() && trimmed != "---" {
            // The first non-empty, non-separator line before any section is the summary.
            if block.summary.is_empty() && current_section.is_none() {
                if !trimmed.starts_with("**Full Changelog**") {
                    block.summary = trimmed.to_string();
                }
            }
        }
    }

    // Finalize the last section and block.
    if let Some(section) = current_section.take() {
        if let Some(block) = &mut current_block {
            block.sections.push(section);
        }
    }
    if let Some(block) = current_block {
        versions.push(block);
    }

    versions
}

/// Extract release notes for versions strictly newer than `since` up to and
/// including `current`. The changelog is newest-first, so the result preserves
/// that order. If `since` is not found, returns only `current`'s block. If
/// `current` is not found, returns empty.
///
/// Beta filtering: if `current` is a stable version (no `-beta` suffix), beta
/// entries are excluded. If `current` is a prerelease, all entries are included.
pub fn parse_release_notes(
    changelog: &str,
    since: Option<&str>,
    current: &str,
) -> Vec<ReleaseNotes> {
    let all = parse_all_versions(changelog);

    let Some(current_idx) = all.iter().position(|r| r.version == current) else {
        return Vec::new();
    };

    let end = match since.and_then(|s| all.iter().position(|r| r.version == s)) {
        Some(since_idx) => since_idx,
        None => current_idx + 1,
    };

    let mut selected: Vec<ReleaseNotes> = all[current_idx..end].to_vec();

    let current_is_beta = current.contains("-beta");
    if !current_is_beta {
        selected.retain(|r| !r.version.contains("-beta"));
    }

    selected
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CHANGELOG: &str = "\
# Changelog

## v0.7.35

Stable release for feature X.

### New Features
- Feature X by @author
- Feature Y by @author

### Bug Fixes
- Fix Z by @author

---

### Changelog

**Full Changelog**: [v0.7.34...v0.7.35](https://example.com)

## v0.7.34

Stable release for the models graph.

### New Features
- Models graph by @author

### Improvements
- Polish by @author

---

### Changelog

**Full Changelog**: [v0.7.33...v0.7.34](https://example.com)

## v0.7.33

Minor fixes.

### Bug Fixes
- Small fix by @author

---

### Changelog

**Full Changelog**: [v0.7.32...v0.7.33](https://example.com)
";

    #[test]
    fn parse_single_version_range() {
        let notes = parse_release_notes(SAMPLE_CHANGELOG, Some("0.7.34"), "0.7.35");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].version, "0.7.35");
        assert_eq!(notes[0].summary, "Stable release for feature X.");
        assert_eq!(notes[0].sections.len(), 2);
        assert_eq!(notes[0].sections[0].title, "New Features");
        assert_eq!(notes[0].sections[0].items, vec!["Feature X by @author", "Feature Y by @author"]);
        assert_eq!(notes[0].sections[1].title, "Bug Fixes");
        assert_eq!(notes[0].sections[1].items, vec!["Fix Z by @author"]);
    }

    #[test]
    fn parse_multi_version_skip_updater_range() {
        let notes = parse_release_notes(SAMPLE_CHANGELOG, Some("0.7.33"), "0.7.35");
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].version, "0.7.35");
        assert_eq!(notes[1].version, "0.7.34");
    }

    #[test]
    fn parse_excludes_changelog_section() {
        let notes = parse_release_notes(SAMPLE_CHANGELOG, Some("0.7.34"), "0.7.35");
        let section_titles: Vec<&str> = notes[0].sections.iter().map(|s| s.title.as_str()).collect();
        assert!(!section_titles.contains(&"Changelog"));
    }

    #[test]
    fn parse_since_not_found_returns_current_only() {
        let notes = parse_release_notes(SAMPLE_CHANGELOG, Some("0.7.30"), "0.7.35");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].version, "0.7.35");
    }

    #[test]
    fn parse_current_not_found_returns_empty() {
        let notes = parse_release_notes(SAMPLE_CHANGELOG, Some("0.7.34"), "0.9.99");
        assert!(notes.is_empty());
    }

    #[test]
    fn parse_beta_filtering_stable_current_excludes_betas() {
        let beta_changelog = "\
# Changelog

## v0.7.35

Stable release.

### New Features
- Stable feature by @author

---

### Changelog

**Full Changelog**: [v0.7.34...v0.7.35](https://example.com)

## v0.7.35-beta.2

Beta follow-up.

### New Features
- Beta feature by @author

---

### Changelog

**Full Changelog**: [v0.7.35-beta.1...v0.7.35-beta.2](https://example.com)

## v0.7.35-beta.1

Beta release.

### New Features
- Beta feature by @author

---

### Changelog

**Full Changelog**: [v0.7.34...v0.7.35-beta.1](https://example.com)

## v0.7.34

Previous stable.

### Bug Fixes
- Fix by @author

---

### Changelog

**Full Changelog**: [v0.7.33...v0.7.34](https://example.com)
";
        // Current is stable 0.7.35, since is 0.7.34 → should exclude beta entries.
        let notes = parse_release_notes(beta_changelog, Some("0.7.34"), "0.7.35");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].version, "0.7.35");
    }

    #[test]
    fn parse_beta_filtering_beta_current_includes_betas() {
        let beta_changelog = "\
# Changelog

## v0.7.35-beta.2

Beta follow-up.

### New Features
- Beta feature by @author

---

### Changelog

**Full Changelog**: [v0.7.35-beta.1...v0.7.35-beta.2](https://example.com)

## v0.7.35-beta.1

Beta release.

### New Features
- Beta feature by @author

---

### Changelog

**Full Changelog**: [v0.7.34...v0.7.35-beta.1](https://example.com)

## v0.7.34

Previous stable.

### Bug Fixes
- Fix by @author

---

### Changelog

**Full Changelog**: [v0.7.33...v0.7.34](https://example.com)
";
        // Current is beta 0.7.35-beta.2, since is 0.7.34 → should include beta entries.
        let notes = parse_release_notes(beta_changelog, Some("0.7.34"), "0.7.35-beta.2");
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].version, "0.7.35-beta.2");
        assert_eq!(notes[1].version, "0.7.35-beta.1");
    }
}
