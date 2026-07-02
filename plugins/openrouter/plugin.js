(function () {
  const BASE_URL = "https://openrouter.ai/api/v1"
  const CREDITS_URL = BASE_URL + "/credits"
  const KEY_URL = BASE_URL + "/key"
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000

  // OpenRouter has no companion CLI that stashes a credential, so the key comes from a config file or
  // an environment variable. Config is checked first so a file the user edits wins over a stale env var.
  const CONFIG_PATHS = ["~/.config/usagepal/openrouter.json", "~/.config/openrouter/key.json"]
  const ENV_NAMES = ["OPENROUTER_API_KEY", "OPENROUTER_KEY"]

  function keyFromConfigText(text) {
    if (typeof text !== "string") return null
    const trimmed = text.trim()
    if (!trimmed) return null
    if (trimmed.indexOf("{") === 0) {
      let obj = null
      try {
        obj = JSON.parse(trimmed)
      } catch (e) {
        return null
      }
      if (!obj || typeof obj !== "object") return null
      const fields = ["apiKey", "api_key", "key"]
      for (let i = 0; i < fields.length; i++) {
        const value = obj[fields[i]]
        if (typeof value === "string" && value.trim()) return value.trim()
      }
      return null
    }
    // Not JSON: treat as a plain-text key file.
    return trimmed
  }

  function keyFromConfigFile(ctx) {
    for (let i = 0; i < CONFIG_PATHS.length; i++) {
      const path = CONFIG_PATHS[i]
      try {
        if (!ctx.host.fs.exists(path)) continue
        const key = keyFromConfigText(ctx.host.fs.readText(path))
        if (key) return key
      } catch (e) {
        ctx.host.log.warn("openrouter config read failed for " + path + ": " + String(e))
      }
    }
    return null
  }

  function keyFromEnvironment(ctx) {
    for (let i = 0; i < ENV_NAMES.length; i++) {
      const value = ctx.host.env.get(ENV_NAMES[i])
      if (typeof value === "string" && value.trim()) return value.trim()
    }
    return null
  }

  function loadApiKey(ctx) {
    return keyFromConfigFile(ctx) || keyFromEnvironment(ctx)
  }

  // OpenRouter wraps every payload in `{ "data": { ... } }`.
  function dataObject(ctx, bodyText) {
    const parsed = ctx.util.tryParseJson(bodyText)
    if (!parsed || typeof parsed !== "object") return null
    const data = parsed.data
    return data && typeof data === "object" ? data : null
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }

  function formatDollars(amount) {
    return "$" + (Math.round(amount * 100) / 100).toFixed(2)
  }

  function fetchCredits(ctx, apiKey) {
    let resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: CREDITS_URL,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        timeoutMs: 15000,
      })
    } catch (e) {
      ctx.host.log.error("credits request exception: " + String(e))
      throw "Couldn't reach OpenRouter. Check your connection."
    }
    if (ctx.util.isAuthStatus(resp.status)) {
      throw "API key invalid. Check your key at openrouter.ai/keys."
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "OpenRouter request failed (HTTP " + String(resp.status) + ")."
    }
    return dataObject(ctx, resp.bodyText)
  }

  // Best-effort key metadata: tier, optional per-key cap, and daily/weekly/monthly spend. A failure
  // here still leaves the balance from /credits usable, so it never throws.
  function fetchKey(ctx, apiKey) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: KEY_URL,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        timeoutMs: 15000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("key request failed: HTTP " + resp.status)
        return null
      }
      return dataObject(ctx, resp.bodyText)
    } catch (e) {
      ctx.host.log.warn("key request exception: " + String(e))
      return null
    }
  }

  function creditsLines(ctx, data) {
    const lines = []
    const totalUsage = num(data.total_usage)
    if (totalUsage === null) return lines

    const used = Math.max(0, totalUsage)
    // `total_credits` is the lifetime amount added to the account; balance is what's left of it.
    const totalCredits = Math.max(0, num(data.total_credits) || 0)

    // Credits meter: spend against the credits purchased. Only a positive ceiling is a meaningful meter
    // (a free/never-topped-up account reports 0 here) — those accounts still get Balance below.
    if (totalCredits > 0) {
      lines.push(ctx.line.progress({
        label: "Credits",
        used: used,
        limit: totalCredits,
        format: { kind: "dollars" },
      }))
    }
    // Balance: prepaid credits remaining. A real zero is shown ("$0.00"), never "No data".
    lines.push(ctx.line.text({ label: "Balance", value: formatDollars(Math.max(0, totalCredits - used)) }))
    return lines
  }

  function keyMetrics(ctx, data) {
    const lines = []

    // Period spend straight from the API (not a local log scan), so a real zero is a measured zero.
    appendSpend(ctx, lines, "Today", data.usage_daily)
    appendSpend(ctx, lines, "This Week", data.usage_weekly)
    appendSpend(ctx, lines, "This Month", data.usage_monthly)

    // Per-key spend cap, when this key is configured with one.
    const limit = num(data.limit)
    if (limit !== null && limit > 0) {
      lines.push(ctx.line.progress({
        label: "Key Limit",
        used: Math.max(0, num(data.usage) || 0),
        limit: limit,
        format: { kind: "dollars" },
        periodDurationMs: MONTH_MS,
      }))
    }

    const plan = typeof data.is_free_tier === "boolean"
      ? (data.is_free_tier ? "Free tier" : "Pay as you go")
      : null
    return { plan, lines }
  }

  function appendSpend(ctx, lines, label, value) {
    const amount = num(value)
    if (amount === null) return
    lines.push(ctx.line.text({ label: label, value: formatDollars(Math.max(0, amount)) }))
  }

  function probe(ctx) {
    const apiKey = loadApiKey(ctx)
    if (!apiKey) {
      throw "No API key. Add one in Settings."
    }

    // /credits is required for a usable snapshot; /key is best-effort and merges independently.
    const credits = fetchCredits(ctx, apiKey)
    const key = fetchKey(ctx, apiKey)

    let lines = credits ? creditsLines(ctx, credits) : []
    let plan = null
    if (key) {
      const metrics = keyMetrics(ctx, key)
      plan = metrics.plan
      lines = lines.concat(metrics.lines)
    }

    if (lines.length === 0) {
      lines.push(ctx.line.badge({ label: "Balance", text: "No usage data", color: "#a3a3a3" }))
    }

    return { plan, lines }
  }

  globalThis.__openusage_plugin = { id: "openrouter", probe }
})()
