(function () {
  const PROVIDER_ID = "opencode-go";
  const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
  const AUTH_PATH = "~/.local/share/opencode/auth.json";
  const CONFIG_PATH = "~/.config/usagepal/opencode-go.json";
  const ENV_NAME = "OPENCODE_API_KEY";
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

  function loadApiKey(ctx) {
    const configured = keyFromJsonFile(ctx, CONFIG_PATH, null);
    if (configured) return configured;

    const openCodeAuth = keyFromJsonFile(ctx, AUTH_PATH, PROVIDER_ID);
    if (openCodeAuth) return openCodeAuth;

    const envValue = ctx.host.env.get(ENV_NAME);
    return typeof envValue === "string" && envValue.trim() ? envValue.trim() : null;
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

  function probe(ctx) {
    const apiKey = loadApiKey(ctx);
    if (!apiKey) {
      throw "No OpenCode API key. Log in to OpenCode, add one in Settings, or set OPENCODE_API_KEY.";
    }
    return { plan: "Go", lines: buildLines(ctx, fetchUsage(ctx, apiKey)) };
  }

  globalThis.__openusage_plugin = {
    id: PROVIDER_ID,
    probe,
    __test: { keyFromObject, loadApiKey, parseUsage, buildLines },
  };
})();
