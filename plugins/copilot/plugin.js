(function () {
  const KEYCHAIN_SERVICE = "UsagePal-copilot";
  const GH_KEYCHAIN_SERVICE = "gh:github.com";
  const USAGE_URL = "https://api.github.com/copilot_internal/user";

  function readJson(ctx, path) {
    try {
      if (!ctx.host.fs.exists(path)) return null;
      const text = ctx.host.fs.readText(path);
      return ctx.util.tryParseJson(text);
    } catch (e) {
      ctx.host.log.warn("readJson failed for " + path + ": " + String(e));
      return null;
    }
  }

  function writeJson(ctx, path, value) {
    try {
      ctx.host.fs.writeText(path, JSON.stringify(value));
    } catch (e) {
      ctx.host.log.warn("writeJson failed for " + path + ": " + String(e));
    }
  }

  function saveToken(ctx, token) {
    try {
      ctx.host.keychain.writeGenericPassword(
        KEYCHAIN_SERVICE,
        JSON.stringify({ token: token }),
      );
    } catch (e) {
      ctx.host.log.warn("keychain write failed: " + String(e));
    }
    writeJson(ctx, ctx.app.pluginDataDir + "/auth.json", { token: token });
  }

  function clearCachedToken(ctx) {
    try {
      ctx.host.keychain.deleteGenericPassword(KEYCHAIN_SERVICE);
    } catch (e) {
      ctx.host.log.info("keychain delete failed: " + String(e));
    }
    writeJson(ctx, ctx.app.pluginDataDir + "/auth.json", null);
  }

  function loadTokenFromKeychain(ctx) {
    try {
      const raw = ctx.host.keychain.readGenericPassword(KEYCHAIN_SERVICE);
      if (raw) {
        const parsed = ctx.util.tryParseJson(raw);
        if (parsed && parsed.token) {
          ctx.host.log.info("token loaded from UsagePal keychain");
          return { token: parsed.token, source: "keychain" };
        }
      }
    } catch (e) {
      ctx.host.log.info("UsagePal keychain read failed: " + String(e));
    }
    return null;
  }

  function loadTokenFromGhCli(ctx) {
    try {
      const raw = ctx.host.keychain.readGenericPassword(GH_KEYCHAIN_SERVICE);
      if (raw) {
        let token = raw;
        if (
          typeof token === "string" &&
          token.indexOf("go-keyring-base64:") === 0
        ) {
          token = ctx.base64.decode(token.slice("go-keyring-base64:".length));
        }
        if (token) {
          ctx.host.log.info("token loaded from gh CLI keychain");
          return { token: token, source: "gh-cli" };
        }
      }
    } catch (e) {
      ctx.host.log.info("gh CLI keychain read failed: " + String(e));
    }
    return null;
  }

  function loadTokenFromStateFile(ctx) {
    const data = readJson(ctx, ctx.app.pluginDataDir + "/auth.json");
    if (data && data.token) {
      ctx.host.log.info("token loaded from state file");
      return { token: data.token, source: "state" };
    }
    return null;
  }

  function loadToken(ctx) {
    return (
      loadTokenFromKeychain(ctx) ||
      loadTokenFromGhCli(ctx) ||
      loadTokenFromStateFile(ctx)
    );
  }

  function fetchUsage(ctx, token) {
    return ctx.util.request({
      method: "GET",
      url: USAGE_URL,
      headers: {
        Authorization: "token " + token,
        Accept: "application/json",
        "Editor-Version": "vscode/1.96.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
      },
      timeoutMs: 10000,
    });
  }

  function numOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function clampPercent(value) {
    return Math.min(100, Math.max(0, value));
  }

  // A `quota_snapshots` bucket -> percent-used meter, or null to suppress. Suppressed for: a missing
  // bucket; an `unlimited` bucket or the `-1` entitlement/remaining sentinel (paid Chat & Completions
  // under usage-based billing carry no real meter, so they're hidden rather than shown as a misleading
  // 0%); and a zero-entitlement placeholder (e.g. Credits on a free account, which has no allotment).
  function snapshotLine(ctx, label, snapshot, resetDate) {
    if (!snapshot || typeof snapshot !== "object") return null;

    const entitlement = numOrNull(snapshot.entitlement);
    const remaining = numOrNull(snapshot.remaining);

    if (snapshot.unlimited === true || entitlement === -1 || remaining === -1) return null;
    if (entitlement === 0) return null;

    let usedPercent;
    const percentRemaining = numOrNull(snapshot.percent_remaining);
    if (percentRemaining !== null) {
      usedPercent = clampPercent(100 - percentRemaining);
    } else if (entitlement !== null && entitlement > 0 && remaining !== null) {
      usedPercent = clampPercent(100 - (remaining / entitlement) * 100);
    } else {
      return null;
    }

    return ctx.line.progress({
      label: label,
      used: usedPercent,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: ctx.util.toIso(resetDate),
      periodDurationMs: 30 * 24 * 60 * 60 * 1000,
    });
  }

  // "Extra Usage" — premium interactions consumed beyond the included Credits pool. Surfaced only once
  // the user has enabled additional (overage) spend (`overage_permitted`); a real zero is then shown.
  // No spending cap is exposed here, so this is an unbounded count, not a meter.
  function overageLine(ctx, snapshot) {
    if (!snapshot || typeof snapshot !== "object" || snapshot.overage_permitted !== true) return null;
    const overage = Math.max(0, numOrNull(snapshot.overage_count) || 0);
    return ctx.line.text({ label: "Extra Usage", value: String(overage) });
  }

  function makeLimitedProgressLine(ctx, label, remaining, total, resetDate) {
    if (typeof remaining !== "number" || typeof total !== "number" || total <= 0)
      return null;
    const used = total - remaining;
    const usedPercent = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
    return ctx.line.progress({
      label: label,
      used: usedPercent,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: ctx.util.toIso(resetDate),
      periodDurationMs: 30 * 24 * 60 * 60 * 1000,
    });
  }

  function probe(ctx) {
    const cred = loadToken(ctx);
    if (!cred) {
      throw "Not logged in. Run `gh auth login` first.";
    }

    let token = cred.token;
    let source = cred.source;

    let resp;
    try {
      resp = fetchUsage(ctx, token);
    } catch (e) {
      ctx.host.log.error("usage request exception: " + String(e));
      throw "Usage request failed. Check your connection.";
    }

    if (resp.status === 401 || resp.status === 403) {
      // If cached token is stale, clear it and try fallback sources
      if (source === "keychain") {
        ctx.host.log.info("cached token invalid, trying fallback sources");
        clearCachedToken(ctx);
        const fallback = loadTokenFromGhCli(ctx);
        if (fallback) {
          try {
            resp = fetchUsage(ctx, fallback.token);
          } catch (e) {
            ctx.host.log.error("fallback usage request exception: " + String(e));
            throw "Usage request failed. Check your connection.";
          }
          if (resp.status >= 200 && resp.status < 300) {
            // Fallback worked, persist the new token
            saveToken(ctx, fallback.token);
            token = fallback.token;
            source = fallback.source;
          }
        }
      }
      // Still failing after retry
      if (resp.status === 401 || resp.status === 403) {
        throw "Token invalid. Run `gh auth login` to re-authenticate.";
      }
    }

    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.error("usage returned error: status=" + resp.status);
      throw (
        "Usage request failed (HTTP " +
        String(resp.status) +
        "). Try again later."
      );
    }

    // Persist gh-cli token to UsagePal keychain for future use
    if (source === "gh-cli") {
      saveToken(ctx, token);
    }

    const data = ctx.util.tryParseJson(resp.bodyText);
    if (data === null) {
      throw "Usage response invalid. Try again later.";
    }

    ctx.host.log.info("usage fetch succeeded");

    const lines = [];
    let plan = null;
    if (data.copilot_plan) {
      plan = ctx.fmt.planLabel(data.copilot_plan);
    }

    // Since usage-based billing (AI Credits), the metered premium pool is surfaced as "Credits", with
    // "Extra Usage" carrying overage beyond it. Paid plans report Chat/Completions as the `-1`
    // "unlimited" sentinel (suppressed); free plans carry real counts inside quota_snapshots (current)
    // or, on older responses, as limited_user_quotas against monthly_quotas below.
    const snapshots = data.quota_snapshots;
    const resetDate = data.quota_reset_date || data.limited_user_reset_date;
    if (snapshots) {
      const premium = snapshots.premium_interactions;
      const creditsLine = snapshotLine(ctx, "Credits", premium, resetDate);
      if (creditsLine) lines.push(creditsLine);

      const extraLine = overageLine(ctx, premium);
      if (extraLine) lines.push(extraLine);

      const chatLine = snapshotLine(ctx, "Chat", snapshots.chat, resetDate);
      if (chatLine) lines.push(chatLine);

      const completionsLine = snapshotLine(ctx, "Completions", snapshots.completions, resetDate);
      if (completionsLine) lines.push(completionsLine);
    }

    // Legacy free-tier shape (predates quota_snapshots): remaining counts against monthly limits. Gated
    // on nothing else having been produced — otherwise a paid account (Credits present, Chat/Completions
    // suppressed as unlimited) that still carried limited_user_quotas would wrongly show free-tier meters.
    if (lines.length === 0 && data.limited_user_quotas && data.monthly_quotas) {
      const lq = data.limited_user_quotas;
      const mq = data.monthly_quotas;
      const freeResetDate = data.limited_user_reset_date;

      const chatLine = makeLimitedProgressLine(ctx, "Chat", lq.chat, mq.chat, freeResetDate);
      if (chatLine) lines.push(chatLine);

      const completionsLine = makeLimitedProgressLine(ctx, "Completions", lq.completions, mq.completions, freeResetDate);
      if (completionsLine) lines.push(completionsLine);
    }

    if (lines.length === 0) {
      lines.push(
        ctx.line.badge({
          label: "Status",
          text: "No usage data",
          color: "#a3a3a3",
        }),
      );
    }

    return { plan: plan, lines: lines };
  }

  globalThis.__openusage_plugin = { id: "copilot", probe };
})();
