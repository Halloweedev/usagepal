(function () {
  const PROVIDER_ID = "opencode-go";
  const PROVIDER_NAME = "OpenCode Go";
  const AUTH_PATH = "~/.local/share/opencode/auth.json";
  const DB_PATH = "~/.local/share/opencode/opencode.db";
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const LIMITS = {
    session: 12,
    weekly: 30,
    monthly: 60,
  };

  // Shared monthly pool size. Models with a lower "Usage" allowance in the
  // OpenCode Go docs burn this pool faster: multiplier = BASELINE / allowance.
  const QUOTA_BASELINE_USD = 60;

  // Per-model usage allowance (USD) from https://opencode.ai/docs/go/.
  // kimi-k3 is $15 base; temporary "2× usage limits" promo → $30 effective.
  const USAGE_ALLOWANCE_USD = {
    "grok-4.5": 15,
    "glm-5.2": 60,
    "glm-5.1": 60,
    "kimi-k3": 30,
    "kimi-k2.7-code": 60,
    "kimi-k2.6": 60,
    "mimo-v2.5": 60,
    "mimo-v2.5-pro": 15,
    "minimax-m3": 60,
    "minimax-m2.7": 60,
    "minimax-m2.5": 60,
    "qwen3.7-max": 60,
    "qwen3.7-plus": 60,
    "qwen3.6-plus": 60,
    "deepseek-v4-pro": 15,
    "deepseek-v4-flash": 60,
  };

  // Per-million USD token rates from https://opencode.ai/docs/go/
  const OPENCODE_GO_PRICING = {
    retrieved_at: "2026-07-01",
    models: {
      "glm-5.2": { input: 1.4, cache_write: null, cache_read: 0.26, output: 4.4 },
      "glm-5.1": { input: 1.4, cache_write: null, cache_read: 0.26, output: 4.4 },
      "kimi-k2.7-code": { input: 0.95, cache_write: null, cache_read: 0.19, output: 4.0 },
      "kimi-k2.6": { input: 0.95, cache_write: null, cache_read: 0.16, output: 4.0 },
      "mimo-v2.5": { input: 0.14, cache_write: null, cache_read: 0.0028, output: 0.28 },
      "mimo-v2.5-pro": { input: 1.74, cache_write: null, cache_read: 0.0145, output: 3.48 },
      "minimax-m3": { input: 0.3, cache_write: null, cache_read: 0.06, output: 1.2 },
      "minimax-m2.7": { input: 0.3, cache_write: 0.375, cache_read: 0.06, output: 1.2 },
      "minimax-m2.5": { input: 0.3, cache_write: 0.375, cache_read: 0.06, output: 1.2 },
      "qwen3.7-max": { input: 2.5, cache_write: 3.125, cache_read: 0.5, output: 7.5 },
      "qwen3.7-plus": { input: 0.4, cache_write: 0.5, cache_read: 0.04, output: 1.6 },
      "qwen3.6-plus": { input: 0.5, cache_write: 0.625, cache_read: 0.05, output: 3.0 },
      "deepseek-v4-pro": { input: 1.74, cache_write: null, cache_read: 0.0145, output: 3.48 },
      "deepseek-v4-flash": { input: 0.14, cache_write: null, cache_read: 0.0028, output: 0.28 },
    },
    alias_rules: [
      { pattern: "^glm-5\\.2", canonical: "glm-5.2" },
      { pattern: "^glm-5\\.1", canonical: "glm-5.1" },
      { pattern: "^kimi-k3", canonical: "kimi-k3" },
      { pattern: "^kimi-k2\\.7", canonical: "kimi-k2.7-code" },
      { pattern: "^kimi-k2\\.6", canonical: "kimi-k2.6" },
      { pattern: "^grok-4\\.5", canonical: "grok-4.5" },
      { pattern: "^mimo-v2\\.5-pro", canonical: "mimo-v2.5-pro" },
      { pattern: "^mimo-v2\\.5", canonical: "mimo-v2.5" },
      { pattern: "^minimax-m3(?![\\d.])", canonical: "minimax-m3" },
      { pattern: "^minimax-m2\\.7", canonical: "minimax-m2.7" },
      { pattern: "^minimax-m2\\.5", canonical: "minimax-m2.5" },
      { pattern: "^qwen3\\.7-max", canonical: "qwen3.7-max" },
      { pattern: "^qwen3\\.7-plus", canonical: "qwen3.7-plus" },
      { pattern: "^qwen3\\.6-plus", canonical: "qwen3.6-plus" },
      { pattern: "^deepseek-v4-pro", canonical: "deepseek-v4-pro" },
      { pattern: "^deepseek-v4-flash", canonical: "deepseek-v4-flash" },
    ],
  };

  const HISTORY_ASSISTANT_FILTER = `
    json_valid(data)
      AND json_extract(data, '$.providerID') = 'opencode-go'
      AND json_extract(data, '$.role') = 'assistant'
  `;

  const HISTORY_TOKEN_SUM = `
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

  const HISTORY_EXISTS_SQL = `
    SELECT 1 AS present
    FROM message
    WHERE ${HISTORY_ASSISTANT_FILTER}
      AND (
        json_type(data, '$.cost') IN ('integer', 'real')
        OR ${HISTORY_TOKEN_SUM} > 0
      )
    LIMIT 1
  `;

  const HISTORY_ROWS_SQL = `
    SELECT
      CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
      CAST(json_extract(data, '$.cost') AS REAL) AS cost,
      COALESCE(
        json_extract(data, '$.modelID'),
        json_extract(data, '$.model'),
        json_extract(data, '$.modelName')
      ) AS modelID,
      COALESCE(CAST(json_extract(data, '$.tokens.input') AS INTEGER), 0) AS tokensInput,
      COALESCE(CAST(json_extract(data, '$.tokens.output') AS INTEGER), 0) AS tokensOutput,
      COALESCE(CAST(json_extract(data, '$.tokens.reasoning') AS INTEGER), 0) AS tokensReasoning,
      COALESCE(CAST(json_extract(data, '$.tokens.cacheRead') AS INTEGER), 0) +
        COALESCE(CAST(json_extract(data, '$.tokens.cache_read') AS INTEGER), 0) AS tokensCacheRead,
      COALESCE(CAST(json_extract(data, '$.tokens.cacheWrite') AS INTEGER), 0) +
        COALESCE(CAST(json_extract(data, '$.tokens.cache_write') AS INTEGER), 0) AS tokensCacheWrite,
      ${HISTORY_TOKEN_SUM} AS tokensTotal
    FROM message
    WHERE ${HISTORY_ASSISTANT_FILTER}
      AND (
        json_type(data, '$.cost') IN ('integer', 'real')
        OR ${HISTORY_TOKEN_SUM} > 0
      )
  `;

  function readNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function readNowMs() {
    return Date.now();
  }

  function clampPercent(used, limit) {
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0)
      return 0;
    const percent = (used / limit) * 100;
    if (!Number.isFinite(percent)) return 0;
    return Math.round(Math.max(0, Math.min(100, percent)) * 10) / 10;
  }

  function toIso(ms) {
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
  }

  function dayKeyFromMs(ms) {
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10);
  }

  function recentUtcDayKeys(nowMs, count) {
    const keys = [];
    for (let i = 0; i < count; i += 1) {
      keys.push(new Date(nowMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    return keys;
  }

  function startOfUtcWeek(nowMs) {
    const date = new Date(nowMs);
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  function startOfUtcMonth(nowMs) {
    const date = new Date(nowMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
  }

  function startOfNextUtcMonth(nowMs) {
    const date = new Date(nowMs);
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    );
  }

  function shiftMonth(year, month, delta) {
    const total = year * 12 + month + delta;
    return [Math.floor(total / 12), ((total % 12) + 12) % 12];
  }

  function anchorMonth(year, month, anchorDate) {
    const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(
      year,
      month,
      Math.min(anchorDate.getUTCDate(), maxDay),
      anchorDate.getUTCHours(),
      anchorDate.getUTCMinutes(),
      anchorDate.getUTCSeconds(),
      anchorDate.getUTCMilliseconds(),
    );
  }

  function anchoredMonthBounds(nowMs, anchorMs) {
    if (!Number.isFinite(anchorMs)) {
      const startMs = startOfUtcMonth(nowMs);
      return { startMs, endMs: startOfNextUtcMonth(nowMs) };
    }

    const nowDate = new Date(nowMs);
    const anchorDate = new Date(anchorMs);
    let year = nowDate.getUTCFullYear();
    let month = nowDate.getUTCMonth();
    let startMs = anchorMonth(year, month, anchorDate);

    if (startMs > nowMs) {
      const previous = shiftMonth(year, month, -1);
      year = previous[0];
      month = previous[1];
      startMs = anchorMonth(year, month, anchorDate);
    }

    const next = shiftMonth(year, month, 1);
    return {
      startMs,
      endMs: anchorMonth(next[0], next[1], anchorDate),
    };
  }

  function sumRange(rows, startMs, endMs, options) {
    const useQuota = !!(options && options.quota);
    let total = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.createdMs < startMs || row.createdMs >= endMs) continue;
      total += useQuota ? row.quotaCost : row.cost;
    }
    return Math.round(total * 10000) / 10000;
  }

  function nextRollingReset(rows, nowMs) {
    const startMs = nowMs - FIVE_HOURS_MS;
    let oldest = null;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.createdMs < startMs || row.createdMs >= nowMs) continue;
      if (oldest === null || row.createdMs < oldest) oldest = row.createdMs;
    }
    return toIso((oldest === null ? nowMs : oldest) + FIVE_HOURS_MS);
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
        const formatted =
          scaled >= 10
            ? Math.round(scaled).toString()
            : scaled.toFixed(1).replace(/\.0$/, "");
        return sign + formatted + unit.suffix;
      }
    }
    return sign + Math.round(abs).toString();
  }

  function costAndTokensLabel(data, opts) {
    const includeZeroTokens = !!(opts && opts.includeZeroTokens);
    const parts = [];
    if (data.costUSD != null) parts.push("$" + data.costUSD.toFixed(2));
    if (data.tokens > 0 || (includeZeroTokens && data.tokens === 0)) {
      parts.push(fmtTokens(data.tokens));
    }
    return parts.join(" · ");
  }

  function usageCostUsd(day) {
    if (!day || typeof day !== "object") return null;
    if (day.costUSD != null) {
      const costUSD = Number(day.costUSD);
      if (Number.isFinite(costUSD)) return costUSD;
    }
    return null;
  }

  function prettifyModelName(rawId) {
    const s = String(rawId || "").trim();
    if (!s) return s;
    return s
      .split("-")
      .map(function (part) {
        if (part === "glm") return "GLM";
        if (part === "gpt") return "GPT";
        if (/^\d/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function resolveCanonicalModel(slug) {
    const s = String(slug || "").trim().toLowerCase();
    if (!s) return null;
    for (let i = 0; i < OPENCODE_GO_PRICING.alias_rules.length; i += 1) {
      const rule = OPENCODE_GO_PRICING.alias_rules[i];
      try {
        if (new RegExp(rule.pattern).test(s)) return rule.canonical;
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  function resolveModelRates(slug) {
    const canonical = resolveCanonicalModel(slug);
    if (!canonical) return null;
    return OPENCODE_GO_PRICING.models[canonical] || null;
  }

  function quotaMultiplier(slug) {
    const canonical = resolveCanonicalModel(slug);
    if (!canonical) return 1;
    const allowance = USAGE_ALLOWANCE_USD[canonical];
    if (!Number.isFinite(allowance) || allowance <= 0) return 1;
    return QUOTA_BASELINE_USD / allowance;
  }

  function estimatedCostDollars(modelID, input, cacheRead, cacheWrite, output, reasoning) {
    const rates = resolveModelRates(modelID);
    if (!rates) return null;
    const cwRate = rates.cache_write == null ? rates.input : rates.cache_write;
    return (
      (input * rates.input +
        cacheWrite * cwRate +
        cacheRead * rates.cache_read +
        (output + reasoning) * rates.output) /
      1e6
    );
  }

  function rowCostUsd(row, ctx) {
    const stored = readNumber(row.cost);
    if (stored !== null && stored > 0) return stored;

    const input = Math.max(0, readNumber(row.tokensInput) || 0);
    const output = Math.max(0, readNumber(row.tokensOutput) || 0);
    const reasoning = Math.max(0, readNumber(row.tokensReasoning) || 0);
    const cacheRead = Math.max(0, readNumber(row.tokensCacheRead) || 0);
    const cacheWrite = Math.max(0, readNumber(row.tokensCacheWrite) || 0);
    const tokensTotal = Math.max(0, readNumber(row.tokensTotal) || 0);
    if (tokensTotal <= 0) return stored !== null && stored >= 0 ? stored : null;

    const modelID =
      typeof row.modelID === "string" && row.modelID.trim()
        ? row.modelID.trim()
        : null;
    const estimated = estimatedCostDollars(
      modelID,
      input,
      cacheRead,
      cacheWrite,
      output,
      reasoning,
    );
    if (estimated === null) {
      if (modelID) {
        ctx.host.log.info("opencode-go pricing: unknown model " + modelID);
      }
      return stored !== null && stored >= 0 ? stored : 0;
    }
    return estimated;
  }

  function aggregateDailyFromRows(rows, nowMs) {
    const cutoffMs = nowMs - 31 * 24 * 60 * 60 * 1000;
    const byDay = {};
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.createdMs < cutoffMs) continue;
      const key = dayKeyFromMs(row.createdMs);
      if (!key) continue;
      if (!byDay[key]) byDay[key] = { date: key, costUSD: 0, totalTokens: 0 };
      byDay[key].costUSD += row.cost;
      byDay[key].totalTokens += row.tokens || 0;
    }
    return Object.keys(byDay)
      .sort()
      .map(function (k) {
        return byDay[k];
      });
  }

  function aggregateModelUsageFromRows(rows, nowMs) {
    const todayKey = new Date(nowMs).toISOString().slice(0, 10);
    const yesterdayKey = new Date(nowMs - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const recentKeys = recentUtcDayKeys(nowMs, 7);
    const recentSet = {};
    for (let i = 0; i < recentKeys.length; i += 1) recentSet[recentKeys[i]] = true;

    const cutoffMs = nowMs - 31 * 24 * 60 * 60 * 1000;
    const hasModelIds = rows.some(function (row) {
      return typeof row.modelID === "string" && row.modelID.trim().length > 0;
    });

    const byModel = {};
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      if (row.createdMs < cutoffMs) continue;
      const dayKey = dayKeyFromMs(row.createdMs);
      if (!dayKey) continue;

      const name = hasModelIds
        ? String(row.modelID || "").trim()
        : PROVIDER_NAME;
      if (!name) continue;

      const cost = row.cost;
      const tokens = Number(row.tokens);
      const tokenCount = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;

      if (!byModel[name]) {
        byModel[name] = {
          name: name,
          tokens: { Today: 0, Yesterday: 0, "7d": 0, "30d": 0 },
          costUSD: { Today: 0, Yesterday: 0, "7d": 0, "30d": 0 },
        };
      }
      const bucket = byModel[name];
      bucket.tokens["30d"] += tokenCount;
      bucket.costUSD["30d"] += cost;
      if (recentSet[dayKey]) {
        bucket.tokens["7d"] += tokenCount;
        bucket.costUSD["7d"] += cost;
      }
      if (dayKey === todayKey) {
        bucket.tokens.Today += tokenCount;
        bucket.costUSD.Today += cost;
      } else if (dayKey === yesterdayKey) {
        bucket.tokens.Yesterday += tokenCount;
        bucket.costUSD.Yesterday += cost;
      }
    }

    const models = Object.keys(byModel).map(function (k) {
      return byModel[k];
    });
    let totalTokens30d = 0;
    for (let m = 0; m < models.length; m += 1) {
      totalTokens30d += models[m].tokens["30d"];
    }
    for (let n = 0; n < models.length; n += 1) {
      models[n].percent =
        totalTokens30d > 0
          ? (models[n].tokens["30d"] / totalTokens30d) * 100
          : hasModelIds
            ? 0
            : 100;
    }
    models.sort(function (a, b) {
      return b.tokens["30d"] - a.tokens["30d"] || a.name.localeCompare(b.name);
    });
    return { models: models, totalTokens30d: totalTokens30d, hasModelIds: hasModelIds };
  }

  function usageDayLabel(rawDate) {
    const key =
      typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : dayKeyFromMs(rawDate);
    if (!key) return String(rawDate || "").slice(0, 10) || "Usage";
    const month = Number(key.slice(5, 7));
    const day = Number(key.slice(8, 10));
    return month + "/" + day;
  }

  function collectUsageChartPoints(daily) {
    const points = [];
    for (let i = 0; i < daily.length; i += 1) {
      const day = daily[i];
      const tokens = Number(day && day.totalTokens);
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      const key = day.date;
      if (!key) continue;
      points.push({
        key: key,
        label: usageDayLabel(day.date),
        value: tokens,
        valueLabel: fmtTokens(tokens),
      });
    }
    return points
      .sort(function (a, b) {
        return a.key.localeCompare(b.key);
      })
      .slice(-31)
      .map(function (point) {
        return {
          label: point.label,
          value: point.value,
          valueLabel: point.valueLabel,
        };
      });
  }

  function pushUsageChartLine(lines, ctx, daily) {
    const points = collectUsageChartPoints(daily);
    if (points.length === 0) return;
    lines.push(
      ctx.line.barChart({
        label: "Usage Trend",
        points: points,
        note: "From local OpenCode history.",
        color: "#000000",
      }),
    );
  }

  function pushDayUsageLine(lines, ctx, label, dayEntry) {
    const tokens = Number(dayEntry && dayEntry.totalTokens) || 0;
    const cost = usageCostUsd(dayEntry);
    if (tokens > 0) {
      lines.push(
        ctx.line.text({
          label: label,
          value: costAndTokensLabel({ tokens: tokens, costUSD: cost }),
        }),
      );
      return;
    }
    lines.push(
      ctx.line.text({
        label: label,
        value: costAndTokensLabel(
          { tokens: 0, costUSD: cost != null ? cost : 0 },
          { includeZeroTokens: true },
        ),
      }),
    );
  }

  function pushModelUsageLines(lines, ctx, modelUsage) {
    const models = modelUsage.models;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      let value = percentLabel(model.percent);
      const segments = [];
      if (model.costUSD.Today > 0) {
        segments.push("Today " + fmtModelCost(model.costUSD.Today));
      }
      if (model.costUSD.Yesterday > 0) {
        segments.push("Yesterday " + fmtModelCost(model.costUSD.Yesterday));
      }
      if (model.costUSD["7d"] > 0) {
        segments.push("7d " + fmtModelCost(model.costUSD["7d"]));
      }
      if (model.costUSD["30d"] > 0) {
        segments.push("30d " + fmtModelCost(model.costUSD["30d"]));
      }
      if (segments.length > 0) value += " · " + segments.join(" · ");
      const label = modelUsage.hasModelIds
        ? prettifyModelName(model.name)
        : model.name;
      lines.push(
        ctx.line.text({
          label: label,
          value: value,
        }),
      );
    }
  }

  function appendSpendHistory(ctx, lines, rows, nowMs) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const daily = aggregateDailyFromRows(rows, nowMs);
    if (daily.length === 0) return;

    const todayKey = new Date(nowMs).toISOString().slice(0, 10);
    const yesterdayKey = new Date(nowMs - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    let todayEntry = null;
    let yesterdayEntry = null;
    for (let i = 0; i < daily.length; i += 1) {
      const k = daily[i].date;
      if (k === todayKey) todayEntry = daily[i];
      else if (k === yesterdayKey) yesterdayEntry = daily[i];
    }
    pushDayUsageLine(lines, ctx, "Today", todayEntry);
    pushDayUsageLine(lines, ctx, "Yesterday", yesterdayEntry);

    let totalTokens = 0;
    let totalCostNanos = 0;
    let hasCost = false;
    for (let j = 0; j < daily.length; j += 1) {
      const day = daily[j];
      const t = Number(day.totalTokens);
      if (Number.isFinite(t)) totalTokens += t;
      const c = usageCostUsd(day);
      if (c != null) {
        totalCostNanos += Math.round(c * 1e9);
        hasCost = true;
      }
    }
    if (totalTokens > 0 || hasCost) {
      lines.push(
        ctx.line.text({
          label: "Last 30 Days",
          value: costAndTokensLabel({
            tokens: totalTokens,
            costUSD: hasCost ? totalCostNanos / 1e9 : null,
          }),
        }),
      );
    }

    if (totalTokens > 0) {
      pushUsageChartLine(lines, ctx, daily);
    }

    const modelUsage = aggregateModelUsageFromRows(rows, nowMs);
    if (modelUsage.models.length > 0) {
      pushModelUsageLines(lines, ctx, modelUsage);
    }
  }

  function queryRows(ctx, sql) {
    try {
      const raw = ctx.host.sqlite.query(DB_PATH, sql);
      const rows = Array.isArray(raw) ? raw : ctx.util.tryParseJson(raw);
      if (!Array.isArray(rows)) {
        ctx.host.log.warn("sqlite query returned non-array result");
        return { ok: false, rows: [] };
      }
      return { ok: true, rows };
    } catch (e) {
      ctx.host.log.warn("sqlite query failed: " + String(e));
      return { ok: false, rows: [] };
    }
  }

  function loadAuthKey(ctx) {
    if (!ctx.host.fs.exists(AUTH_PATH)) return null;

    try {
      const text = ctx.host.fs.readText(AUTH_PATH);
      const parsed = ctx.util.tryParseJson(text);
      if (!parsed || typeof parsed !== "object") {
        ctx.host.log.warn("opencode auth file is not valid json");
        return null;
      }
      const entry = parsed[PROVIDER_ID];
      if (!entry || typeof entry !== "object") return null;
      const key = typeof entry.key === "string" ? entry.key.trim() : "";
      return key || null;
    } catch (e) {
      ctx.host.log.warn("opencode auth read failed: " + String(e));
      return null;
    }
  }

  function hasHistory(ctx) {
    const result = queryRows(ctx, HISTORY_EXISTS_SQL);
    if (!result.ok) return { ok: false, present: false };
    return { ok: true, present: result.rows.length > 0 };
  }

  function loadHistory(ctx) {
    const result = queryRows(ctx, HISTORY_ROWS_SQL);
    if (!result.ok) return result;

    const rows = [];
    for (let i = 0; i < result.rows.length; i += 1) {
      const row = result.rows[i];
      if (!row || typeof row !== "object") continue;
      const createdMs = readNumber(row.createdMs);
      if (createdMs === null || createdMs <= 0) continue;
      const cost = rowCostUsd(row, ctx);
      if (cost === null || cost < 0) continue;
      const modelID =
        typeof row.modelID === "string" && row.modelID.trim()
          ? row.modelID.trim()
          : null;
      const tokensRaw = readNumber(row.tokensTotal);
      const tokens =
        tokensRaw !== null && tokensRaw > 0 ? Math.round(tokensRaw) : 0;
      if (cost <= 0 && tokens <= 0) continue;
      const quotaCost = cost * quotaMultiplier(modelID);
      rows.push({ createdMs, cost, quotaCost, modelID, tokens });
    }

    return { ok: true, rows };
  }

  function buildProgressLines(ctx, rows, nowMs) {
    const sessionStartMs = nowMs - FIVE_HOURS_MS;
    const weeklyStartMs = startOfUtcWeek(nowMs);
    const weeklyEndMs = weeklyStartMs + WEEK_MS;
    let earliestMs = null;
    for (let i = 0; i < rows.length; i += 1) {
      const createdMs = rows[i].createdMs;
      if (!Number.isFinite(createdMs)) continue;
      if (earliestMs === null || createdMs < earliestMs) earliestMs = createdMs;
    }
    const monthBounds = anchoredMonthBounds(nowMs, earliestMs);
    const monthlyStartMs = monthBounds.startMs;
    const monthlyEndMs = monthBounds.endMs;

    const sessionCost = sumRange(rows, sessionStartMs, nowMs, { quota: true });
    const weeklyCost = sumRange(rows, weeklyStartMs, weeklyEndMs, { quota: true });
    const monthlyCost = sumRange(rows, monthlyStartMs, monthlyEndMs, {
      quota: true,
    });

    const lines = [
      ctx.line.progress({
        label: "Session",
        used: clampPercent(sessionCost, LIMITS.session),
        limit: 100,
        format: { kind: "percent" },
        resetsAt: nextRollingReset(rows, nowMs),
        periodDurationMs: FIVE_HOURS_MS,
      }),
      ctx.line.progress({
        label: "Weekly",
        used: clampPercent(weeklyCost, LIMITS.weekly),
        limit: 100,
        format: { kind: "percent" },
        resetsAt: toIso(weeklyEndMs),
        periodDurationMs: WEEK_MS,
      }),
      ctx.line.progress({
        label: "Monthly",
        used: clampPercent(monthlyCost, LIMITS.monthly),
        limit: 100,
        format: { kind: "percent" },
        resetsAt: toIso(monthlyEndMs),
        periodDurationMs: monthlyEndMs - monthlyStartMs,
      }),
    ];

    appendSpendHistory(ctx, lines, rows, nowMs);
    return lines;
  }

  function buildSoftEmptyLines(ctx) {
    return [
      ctx.line.badge({
        label: "Status",
        text: "No usage data",
        color: "#a3a3a3",
      }),
    ];
  }

  function probe(ctx) {
    const authKey = loadAuthKey(ctx);
    const history = hasHistory(ctx);
    const detected = !!authKey || (history.ok && history.present);

    if (!detected) {
      throw "OpenCode Go not detected. Log in with OpenCode Go or use it locally first.";
    }

    if (!history.ok) {
      return { plan: "Go", lines: buildSoftEmptyLines(ctx) };
    }

    const rowsResult = loadHistory(ctx);
    if (!rowsResult.ok) {
      return { plan: "Go", lines: buildSoftEmptyLines(ctx) };
    }

    return {
      plan: "Go",
      lines: buildProgressLines(ctx, rowsResult.rows, readNowMs()),
    };
  }

  globalThis.__openusage_plugin = {
    id: PROVIDER_ID,
    probe,
    __test: {
      dayKeyFromMs,
      aggregateDailyFromRows,
      aggregateModelUsageFromRows,
      appendSpendHistory,
      prettifyModelName,
      percentLabel,
      fmtModelCost,
      fmtTokens,
      pushModelUsageLines,
      estimatedCostDollars,
      rowCostUsd,
      quotaMultiplier,
      OPENCODE_GO_PRICING,
      USAGE_ALLOWANCE_USD,
    },
  };
})();
