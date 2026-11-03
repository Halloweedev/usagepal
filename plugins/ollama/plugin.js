(function () {
  const BASE_URL = "https://ollama.com"
  const BALANCE_URL = BASE_URL + "/api/balance"
  const CONFIG_PATHS = ["~/.config/usagepal/ollama.json", "~/.config/ollama/key.json"]
  const ENV_NAMES = ["OLLAMA_API_KEY"]

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
      const fields = ["apiKey", "api_key", "key", "token"]
      for (let i = 0; i < fields.length; i++) {
        const value = obj[fields[i]]
        if (typeof value === "string" && value.trim()) return value.trim()
      }
      return null
    }
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
        ctx.host.log.warn("ollama config read failed for " + path + ": " + String(e))
      }
    }
    return null
  }

  function loadApiKey(ctx) {
    for (let i = 0; i < ENV_NAMES.length; i++) {
      const value = ctx.host.env.get(ENV_NAMES[i])
      if (typeof value === "string" && value.trim()) return value.trim()
    }
    return keyFromConfigFile(ctx)
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }

  function formatDollars(amount) {
    return "$" + (Math.round(amount * 100) / 100).toFixed(2)
  }

  function fetchBalance(ctx, apiKey) {
    let resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: BALANCE_URL,
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        timeoutMs: 15000,
      })
    } catch (e) {
      ctx.host.log.error("balance request exception: " + String(e))
      throw "Couldn't reach Ollama. Check your connection."
    }
    if (ctx.util.isAuthStatus(resp.status)) {
      throw "API key invalid. Check your Ollama API key."
    }
    if (resp.status === 429) {
      throw "Ollama rate limited. Try again later."
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Ollama request failed (HTTP " + String(resp.status) + ")."
    }
    const data = ctx.util.tryParseJson(resp.bodyText)
    if (!data || typeof data !== "object") {
      throw "Ollama response invalid. Try again later."
    }
    return data
  }

  function probe(ctx) {
    const apiKey = loadApiKey(ctx)
    if (!apiKey) {
      throw "No OLLAMA_API_KEY found. Set the environment variable or add a key file."
    }

    const data = fetchBalance(ctx, apiKey)
    const lines = []

    const included = data.included && typeof data.included === "object" ? data.included : {}
    const purchased = data.purchased && typeof data.purchased === "object" ? data.purchased : {}

    // Legacy plans: session/weekly remaining percents.
    const session = included.session && typeof included.session === "object" ? included.session : null
    const weekly = included.weekly && typeof included.weekly === "object" ? included.weekly : null

    if (session && typeof session.remaining_percent === "number") {
      const remaining = Math.max(0, Math.min(100, session.remaining_percent))
      const used = 100 - remaining
      const resetsAt = session.resets_at ? ctx.util.toIso(session.resets_at) : undefined
      const opts = {
        label: "Session",
        used: used,
        limit: 100,
        format: { kind: "percent" },
      }
      if (resetsAt) opts.resetsAt = resetsAt
      lines.push(ctx.line.progress(opts))
    }

    if (weekly && typeof weekly.remaining_percent === "number") {
      const remaining = Math.max(0, Math.min(100, weekly.remaining_percent))
      const used = 100 - remaining
      const resetsAt = weekly.resets_at ? ctx.util.toIso(weekly.resets_at) : undefined
      const opts = {
        label: "Weekly",
        used: used,
        limit: 100,
        format: { kind: "percent" },
      }
      if (resetsAt) opts.resetsAt = resetsAt
      lines.push(ctx.line.progress(opts))
    }

    // Credit plans: included balance/allowance in USD.
    const balance = num(included.balance_usd)
    const allowance = num(included.allowance_usd)
    if (allowance !== null && allowance > 0) {
      const used = Math.max(0, allowance - (balance !== null ? balance : 0))
      const from = included.period && typeof included.period === "object" ? included.period.from : null
      const until = included.period && typeof included.period === "object" ? included.period.until : null
      const periodMs = from && until ? (Date.parse(until) - Date.parse(from)) : null
      const opts = {
        label: "Included Credits",
        used: used,
        limit: allowance,
        format: { kind: "dollars" },
      }
      if (until) opts.resetsAt = ctx.util.toIso(until)
      if (periodMs && Number.isFinite(periodMs) && periodMs > 0) opts.periodDurationMs = periodMs
      lines.push(ctx.line.progress(opts))
    }

    const purchasedBalance = num(purchased.balance_usd)
    if (purchasedBalance !== null) {
      lines.push(ctx.line.text({ label: "Purchased Credits", value: formatDollars(Math.max(0, purchasedBalance)) }))
    }

    if (lines.length === 0) {
      lines.push(ctx.line.badge({ label: "Balance", text: "No usage data", color: "#a3a3a3" }))
    }

    return { plan: null, lines }
  }

  globalThis.__usagepal_plugin = { id: "ollama", probe }
})()
