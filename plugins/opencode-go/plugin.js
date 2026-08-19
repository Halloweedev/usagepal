(function () {
  const PROVIDER_ID = "opencode-go";
  const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
  const AUTH_PATH = "~/.local/share/opencode/auth.json";
  const CONFIG_PATH = "~/.config/usagepal/opencode-go.json";
  const ENV_NAME = "OPENCODE_API_KEY";
  // Per-account key injected by the host for registered accounts. It wins over
  // every shared source so a registered account always probes with its own key.
  const ACCOUNT_KEY_ENV = "USAGEPAL_OPENCODE_GO_API_KEY";
  const LOCAL_LOGS_ENV = "USAGEPAL_LOCAL_LOGS_UNAVAILABLE";
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const OPENCODE_DB_PATH = "~/.local/share/opencode/opencode.db";
  const NO_LOCAL_DATA_COLOR = "#a3a3a3";
  const NO_LOCAL_DATA_HINT = "No local OpenCode CLI usage for this account";

  // OpenCode Go assistant rows only — never broaden to other providers.
  const OPENCODE_GO_ASSISTANT_FILTER = `
    json_valid(data)
      AND json_extract(data, '$.providerID') = 'opencode-go'
      AND json_extract(data, '$.role') = 'assistant'
  `;

  const OPENCODE_GO_TOKEN_SUM = `
    (
      COALESCE(CAST(json_extract(data, '$.tokens.input') AS INTEGER), 0) +
      COALESCE(CAST(json_extract(data, '$.tokens.output') AS INTEGER), 0) +
      COALESCE(CAST(json_extract(data, '$.tokens.reasoning') AS INTEGER), 0) +
      COALESCE(CAST(json_extract(data, '$.tokens.cacheRead') AS INTEGER), 0) +
      COALESCE(CAST(json_extract(data, '$.tokens.cacheWrite') AS INTEGER), 0) +
      COALESCE(CAST(json_extract(data, '$.tokens.cache_read') AS INTEGER), 0) +
      COALESCE(CAST(json_extract(data, '$.tokens.cache_write') AS INTEGER), 0)
    )
  `;

  // Rows carry the CLI's own stored cost, so no pricing table is needed.
  function localRowsSql(cutoffMs) {
    return (
      "SELECT " +
      "CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs, " +
      "CAST(json_extract(data, '$.cost') AS REAL) AS cost, " +
      "COALESCE(json_extract(data, '$.modelID'), json_extract(data, '$.model'), json_extract(data, '$.modelName')) AS modelID, " +
      OPENCODE_GO_TOKEN_SUM + " AS tokensTotal " +
      "FROM message " +
      "WHERE " + OPENCODE_GO_ASSISTANT_FILTER +
      "AND CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) >= " + cutoffMs
    );
  }

  function keyFromObject(value) {
    if (!value || typeof value !== "object") return null;
    const fields = ["apiKey", "api_key", "key"];
    for (let i = 0; i < fields.length; i += 1) {
      const found = value[fields[i]];
      if (typeof found === "string" && found.trim()) return found.trim();
    }
    return null;
  }

  function keyFromJsonFile(ctx, path, entryName) {
    if (!ctx.host.fs.exists(path)) return null;
    try {
      const parsed = ctx.util.tryParseJson(ctx.host.fs.readText(path));
      const value = entryName && parsed && typeof parsed === "object"
        ? parsed[entryName]
        : parsed;
      return keyFromObject(value);
    } catch (e) {
      ctx.host.log.warn("opencode-go credential read failed for " + path + ": " + String(e));
      return null;
    }
  }

  function readEnvString(ctx, name) {
    const value = ctx.host.env.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function loadApiKey(ctx) {
    const accountKey = readEnvString(ctx, ACCOUNT_KEY_ENV);
    if (accountKey) return accountKey;

    const configured = keyFromJsonFile(ctx, CONFIG_PATH, null);
    if (configured) return configured;

    const openCodeAuth = keyFromJsonFile(ctx, AUTH_PATH, PROVIDER_ID);
    if (openCodeAuth) return openCodeAuth;

    return readEnvString(ctx, ENV_NAME);
  }

  function readPeriod(ctx, usage, name) {
    const value = usage && usage[name];
    const percent = value && typeof value.percent === "number" ? value.percent : NaN;
    const resetsAt = ctx.util.toIso(value && value.resetsAt);
    if (!Number.isFinite(percent) || percent < 0 || !resetsAt) return null;
    return { percent, resetsAt };
  }

  function parseUsage(ctx, bodyText) {
    const parsed = ctx.util.tryParseJson(bodyText);
    const usage = parsed && typeof parsed === "object" ? parsed.usage : null;
    const rolling = readPeriod(ctx, usage, "rolling");
    const weekly = readPeriod(ctx, usage, "weekly");
    const monthly = readPeriod(ctx, usage, "monthly");
    return rolling && weekly && monthly ? { rolling, weekly, monthly } : null;
  }

  function fetchUsage(ctx, apiKey) {
    let response;
    try {
      response = ctx.util.request({
        method: "GET",
        url: USAGE_URL,
        headers: {
          Authorization: "Bearer " + apiKey,
          Accept: "application/json",
        },
        timeoutMs: 15000,
      });
    } catch (e) {
      ctx.host.log.error("opencode-go usage request failed: " + String(e));
      throw "Couldn't reach OpenCode. Check your connection.";
    }

    if (response.status === 401) {
      throw "OpenCode API key invalid. Log in again or update the key in Settings.";
    }
    if (response.status === 403) {
      throw "An OpenCode Go subscription is required.";
    }
    if (response.status < 200 || response.status >= 300) {
      ctx.host.log.error("opencode-go usage request failed with HTTP " + String(response.status));
      throw "Couldn't update OpenCode Go usage.";
    }

    const usage = parseUsage(ctx, response.bodyText);
    if (!usage) {
      ctx.host.log.error("opencode-go usage response was malformed");
      throw "OpenCode returned invalid usage data.";
    }
    return usage;
  }

  function buildLines(ctx, usage) {
    return [
      ctx.line.progress({
        label: "Session",
        used: usage.rolling.percent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: usage.rolling.resetsAt,
        periodDurationMs: FIVE_HOURS_MS,
      }),
      ctx.line.progress({
        label: "Weekly",
        used: usage.weekly.percent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: usage.weekly.resetsAt,
        periodDurationMs: WEEK_MS,
      }),
      ctx.line.progress({
        label: "Monthly",
        used: usage.monthly.percent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: usage.monthly.resetsAt,
      }),
    ];
  }

  // This account isn't the one signed in to the local OpenCode CLI, so its
  // history lives under another login we can't read — the host flags it here.
  function localLogsUnavailable(ctx) {
    return readEnvString(ctx, LOCAL_LOGS_ENV) === "1";
  }

  function fmtTokens(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    const units = [
      { threshold: 1e9, divisor: 1e9, suffix: "B" },
      { threshold: 1e6, divisor: 1e6, suffix: "M" },
      { threshold: 1e3, divisor: 1e3, suffix: "K" },
    ];
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      if (abs >= unit.threshold) {
        const scaled = abs / unit.divisor;
        const formatted = scaled >= 10
          ? Math.round(scaled).toString()
          : scaled.toFixed(1).replace(/\.0$/, "");
        return sign + formatted + unit.suffix;
      }
    }
    return sign + Math.round(abs).toString();
  }

  function percentLabel(value) {
    if (value > 0 && value < 0.1) return "<0.1%";
    const rounded = Math.round(value * 10) / 10;
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded)) + "%";
  }

  function fmtModelCost(amount) {
    if (amount < 1000) return "$" + amount.toFixed(2);
    return "$" + Math.round(amount).toLocaleString("en-US");
  }

  function dayKeyFromDate(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day;
  }

  function dayKeyFromMs(ms) {
    return dayKeyFromDate(new Date(ms));
  }

  function costAndTokensLabel(data) {
    const parts = [];
    if (data.costUSD != null) parts.push("$" + data.costUSD.toFixed(2));
    if (data.tokens > 0) parts.push(fmtTokens(data.tokens));
    return parts.join(" · ");
  }

  function queryLocalRows(ctx, sql) {
    try {
      const raw = ctx.host.sqlite.query(OPENCODE_DB_PATH, sql);
      const rows = Array.isArray(raw) ? raw : ctx.util.tryParseJson(raw);
      if (!Array.isArray(rows)) {
        ctx.host.log.warn("opencode-go sqlite query returned non-array result");
        return null;
      }
      return rows;
    } catch (e) {
      ctx.host.log.warn("opencode-go sqlite query failed: " + String(e));
      return null;
    }
  }

  // Buckets the 31-day row window into per-day and per-model totals. Every row
  // carries the CLI's stored cost, so no token-share splitting is needed.
  function collectLocalUsage(rows, now) {
    const todayKey = dayKeyFromDate(now);
    const yesterdayKey = dayKeyFromDate(new Date(now.getTime() - DAY_MS));
    const byDay = {};
    const byModel = {};
    let thirtyDayTokens = 0;
    let thirtyDayCost = 0;
    let thirtyDayHasCost = false;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || typeof row !== "object") continue;
      const createdMs = Number(row.createdMs);
      if (!Number.isFinite(createdMs) || createdMs <= 0) continue;
      const tokens = Number(row.tokensTotal);
      const tokensN = Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0;
      const cost = Number(row.cost);
      const hasCost = Number.isFinite(cost) && cost >= 0;
      if (tokensN <= 0 && !hasCost) continue;
      const costN = hasCost ? cost : 0;

      const key = dayKeyFromMs(createdMs);
      if (key) {
        const day = byDay[key] || (byDay[key] = { tokens: 0, cost: 0, hasCost: false });
        day.tokens += tokensN;
        day.cost += costN;
        if (hasCost) day.hasCost = true;
      }

      const model = typeof row.modelID === "string" && row.modelID.trim() ? row.modelID.trim() : null;
      if (model) {
        const m = byModel[model] || (byModel[model] = { tokens: 0, cost: 0, hasCost: false });
        m.tokens += tokensN;
        m.cost += costN;
        if (hasCost) m.hasCost = true;
      }

      thirtyDayTokens += tokensN;
      if (hasCost) {
        thirtyDayCost += costN;
        thirtyDayHasCost = true;
      }
    }

    return {
      today: byDay[todayKey] || null,
      yesterday: byDay[yesterdayKey] || null,
      thirtyDay: { tokens: thirtyDayTokens, cost: thirtyDayCost, hasCost: thirtyDayHasCost },
      byDay,
      byModel,
    };
  }

  function pushDayUsageLine(lines, ctx, label, dayEntry) {
    const tokens = dayEntry ? dayEntry.tokens : 0;
    const cost = dayEntry && dayEntry.hasCost ? dayEntry.cost : null;
    const value = costAndTokensLabel({ tokens: tokens, costUSD: cost });
    if (!value) return;
    lines.push(ctx.line.text({
      label: label,
      value: value,
    }));
  }

  function collectChartPoints(byDay) {
    return Object.keys(byDay)
      .sort()
      .slice(-31)
      .map((key) => {
        const day = byDay[key];
        const month = Number(key.slice(5, 7));
        const dayOfMonth = Number(key.slice(8, 10));
        return {
          label: month + "/" + dayOfMonth,
          value: day.tokens,
          valueLabel: fmtTokens(day.tokens),
        };
      });
  }

  function pushUsageChartLine(lines, ctx, byDay) {
    const points = collectChartPoints(byDay);
    if (points.length === 0) return;
    lines.push(ctx.line.barChart({
      label: "Usage Trend",
      points: points,
      note: "Estimated from local OpenCode history for the selected account.",
      color: "#000000",
    }));
  }

  function pushModelUsageLines(lines, ctx, byModel, totalTokens) {
    const names = Object.keys(byModel).sort(
      (a, b) => byModel[b].tokens - byModel[a].tokens || a.localeCompare(b)
    );
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      const model = byModel[name];
      let value = totalTokens > 0 ? percentLabel((model.tokens / totalTokens) * 100) : "";
      if (model.hasCost) {
        if (value) value += " · ";
        value += "30d " + fmtModelCost(model.cost);
      }
      lines.push(ctx.line.text({ label: name, value: value }));
    }
  }

  // Spend rows for an account that isn't the local CLI login: show a clear
  // "no local data" state instead of a misleading $0 or another login's spend.
  function pushNoLocalDataLines(lines, ctx) {
    const labels = ["Today", "Yesterday", "Last 30 Days"];
    for (let i = 0; i < labels.length; i += 1) {
      lines.push(ctx.line.text({
        label: labels[i],
        value: "—",
        color: NO_LOCAL_DATA_COLOR,
        subtitle: i === 0 ? NO_LOCAL_DATA_HINT : null,
      }));
    }
  }

  function pushLocalSpendLines(lines, ctx) {
    if (localLogsUnavailable(ctx)) {
      pushNoLocalDataLines(lines, ctx);
      return;
    }

    const now = ctx.nowIso ? new Date(ctx.nowIso) : new Date();
    const cutoffMs = now.getTime() - 30 * DAY_MS;
    const rows = queryLocalRows(ctx, localRowsSql(cutoffMs));
    if (!rows || rows.length === 0) return; // transient failure or no history: quota lines stay

    const usage = collectLocalUsage(rows, now);
    if (usage.today) pushDayUsageLine(lines, ctx, "Today", usage.today);
    if (usage.yesterday) pushDayUsageLine(lines, ctx, "Yesterday", usage.yesterday);
    if (usage.thirtyDay.tokens > 0) {
      lines.push(ctx.line.text({
        label: "Last 30 Days",
        value: costAndTokensLabel({
          tokens: usage.thirtyDay.tokens,
          costUSD: usage.thirtyDay.hasCost ? usage.thirtyDay.cost : null,
        }),
      }));
    }
    pushUsageChartLine(lines, ctx, usage.byDay);
    pushModelUsageLines(lines, ctx, usage.byModel, usage.thirtyDay.tokens);
  }

  function probe(ctx) {
    const apiKey = loadApiKey(ctx);
    if (!apiKey) {
      throw "No OpenCode API key. Log in to OpenCode, add one in Settings, or set OPENCODE_API_KEY.";
    }
    const lines = buildLines(ctx, fetchUsage(ctx, apiKey));
    pushLocalSpendLines(lines, ctx);
    return { plan: "Go", lines: lines };
  }

  globalThis.__usagepal_plugin = {
    id: PROVIDER_ID,
    probe,
    __test: { keyFromObject, loadApiKey, parseUsage, buildLines },
  };
})();
