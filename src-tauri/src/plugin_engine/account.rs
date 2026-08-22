use crate::plugin_engine::manifest::LoadedPlugin;
use std::collections::HashMap;
use std::sync::Arc;

/// One account to probe for a provider. The default (single-account) case uses
/// `default_single()` — empty id, no overrides — so the pipeline behaves exactly
/// as before when no accounts are registered.
#[derive(Debug, Clone, Default)]
pub struct AccountSpec {
    /// Stable per-provider identity. Empty string = the implicit default account
    /// (keeps cache/state keys backward-compatible).
    pub account_id: String,
    /// Per-probe env var overrides injected into `ctx.host.env`
    /// (e.g. CLAUDE_CODE_OAUTH_TOKEN, CODEX_HOME).
    pub env_overrides: HashMap<String, String>,
}

impl AccountSpec {
    pub fn default_single() -> Self {
        AccountSpec::default()
    }

    /// `None` for the implicit default account (so its key stays `provider_id`),
    /// `Some(id)` for a registered account.
    pub fn output_account_id(&self) -> Option<String> {
        if self.account_id.is_empty() {
            None
        } else {
            Some(self.account_id.clone())
        }
    }
}

/// A plugin paired with the account it should probe.
pub struct ProbeUnit {
    pub plugin: Arc<LoadedPlugin>,
    pub account: AccountSpec,
}

/// Registered accounts keyed by `provider_id`. Empty = single-account behavior.
#[derive(Debug, Clone, Default)]
pub struct AccountRegistry(pub HashMap<String, Vec<AccountSpec>>);

/// Expand each plugin into its implicit default account followed by every
/// registered account. The default keeps an existing local login available when
/// managed accounts are added.
pub fn expand_probe_units(
    plugins: &[Arc<LoadedPlugin>],
    registry: &AccountRegistry,
) -> Vec<ProbeUnit> {
    let mut units = Vec::new();
    for plugin in plugins {
        units.push(ProbeUnit {
            plugin: Arc::clone(plugin),
            account: AccountSpec::default_single(),
        });
        if let Some(accounts) = registry.0.get(&plugin.manifest.id) {
            for account in accounts {
                units.push(ProbeUnit {
                    plugin: Arc::clone(plugin),
                    account: account.clone(),
                });
            }
        }
    }
    units
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_engine::manifest::{LoadedPlugin, PluginManifest};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    fn plugin(id: &str) -> Arc<LoadedPlugin> {
        Arc::new(LoadedPlugin {
            manifest: PluginManifest {
                schema_version: 1,
                id: id.to_string(),
                name: id.to_string(),
                version: "0.0.0".to_string(),
                entry: "plugin.js".to_string(),
                icon: "icon.svg".to_string(),
                brand_color: None,
                lines: vec![],
                links: vec![],
                detect: vec![],
                multi_tray_lines: vec![],
                tray_primary_label: None,
            },
            plugin_dir: PathBuf::from("."),
            entry_script: String::new(),
            icon_data_url: String::new(),
        })
    }

    #[test]
    fn output_account_id_is_none_for_default() {
        assert_eq!(AccountSpec::default_single().output_account_id(), None);
    }

    #[test]
    fn output_account_id_is_some_for_named_account() {
        let spec = AccountSpec {
            account_id: "work".to_string(),
            env_overrides: HashMap::new(),
        };
        assert_eq!(spec.output_account_id(), Some("work".to_string()));
    }

    #[test]
    fn expander_yields_one_default_unit_when_no_accounts_registered() {
        let plugins = vec![plugin("claude")];
        let registry = AccountRegistry::default();
        let units = expand_probe_units(&plugins, &registry);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].plugin.manifest.id, "claude");
        assert_eq!(units[0].account.output_account_id(), None);
    }

    #[test]
    fn expander_keeps_default_before_registered_accounts() {
        let plugins = vec![plugin("claude")];
        let mut map = HashMap::new();
        map.insert(
            "claude".to_string(),
            vec![
                AccountSpec { account_id: "work".to_string(), env_overrides: HashMap::new() },
                AccountSpec { account_id: "home".to_string(), env_overrides: HashMap::new() },
            ],
        );
        let registry = AccountRegistry(map);
        let units = expand_probe_units(&plugins, &registry);
        let ids: Vec<_> = units.iter().map(|u| u.account.account_id.clone()).collect();
        assert_eq!(ids, vec!["".to_string(), "work".to_string(), "home".to_string()]);
    }
}
