(function () {
  const STATE_DB =
    "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
  const KEYCHAIN_ACCESS_TOKEN_SERVICE = "cursor-access-token"
  const KEYCHAIN_REFRESH_TOKEN_SERVICE = "cursor-refresh-token"
  const BASE_URL = "https://api2.cursor.sh"
  const USAGE_URL = BASE_URL + "/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
  const PLAN_URL = BASE_URL + "/aiserver.v1.DashboardService/GetPlanInfo"
  const REFRESH_URL = BASE_URL + "/oauth/token"
  const CREDITS_URL = BASE_URL + "/aiserver.v1.DashboardService/GetCreditGrantsBalance"
  const REST_USAGE_URL = "https://cursor.com/api/usage"
  const STRIPE_URL = "https://cursor.com/api/auth/stripe"
  const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"
  const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 minutes before expiration
  const LOGIN_HINT = "Sign in via Cursor app or run `agent login`."

  const MAX_MODE_UPLIFT = 1.2

  // Per-million USD token rates, synced from https://cursor.com/docs/models-and-pricing.md.
  // cache_write === null means Cursor lists no separate cache-write rate ("—");
  // cache-write tokens are then priced at the input rate.
  const CURSOR_PRICING = {
    retrieved_at: "2026-07-01",
    models: {
      "claude-4-sonnet":      { input: 3.0,  cache_write: 3.75,  cache_read: 0.3,   output: 15.0,  apply_max_mode_uplift: true },
      "claude-4-sonnet-1m":   { input: 6.0,  cache_write: 7.5,   cache_read: 0.6,   output: 22.5,  apply_max_mode_uplift: true },
      "claude-4.5-haiku":     { input: 1.0,  cache_write: 1.25,  cache_read: 0.1,   output: 5.0,   apply_max_mode_uplift: true },
      "claude-4.5-opus":      { input: 5.0,  cache_write: 6.25,  cache_read: 0.5,   output: 25.0,  apply_max_mode_uplift: true },
      "claude-4.5-sonnet":    { input: 3.0,  cache_write: 3.75,  cache_read: 0.3,   output: 15.0,  apply_max_mode_uplift: true },
      "claude-4.6-opus":      { input: 5.0,  cache_write: 6.25,  cache_read: 0.5,   output: 25.0,  apply_max_mode_uplift: true },
      "claude-4.6-sonnet":    { input: 3.0,  cache_write: 3.75,  cache_read: 0.3,   output: 15.0,  apply_max_mode_uplift: true },
      "claude-4.7-opus":      { input: 5.0,  cache_write: 6.25,  cache_read: 0.5,   output: 25.0,  apply_max_mode_uplift: true },
      "claude-fable-5":       { input: 10.0, cache_write: 12.5,  cache_read: 1.0,   output: 50.0,  apply_max_mode_uplift: true },
      "claude-opus-4.7-fast": { input: 30.0, cache_write: 37.5,  cache_read: 3.0,   output: 150.0, apply_max_mode_uplift: true },
      "claude-opus-4.8":      { input: 5.0,  cache_write: 6.25,  cache_read: 0.5,   output: 25.0,  apply_max_mode_uplift: true },
      "claude-sonnet-5":      { input: 3.0,  cache_write: 3.75,  cache_read: 0.3,   output: 15.0,  apply_max_mode_uplift: true },
      "composer-1":           { input: 1.25, cache_write: null,  cache_read: 0.125, output: 10.0,  apply_max_mode_uplift: true },
      "composer-1.5":         { input: 3.5,  cache_write: null,  cache_read: 0.35,  output: 17.5,  apply_max_mode_uplift: true },
      "composer-2":           { input: 0.5,  cache_write: null,  cache_read: 0.2,   output: 2.5,   apply_max_mode_uplift: true },
      "composer-2.5":         { input: 0.5,  cache_write: null,  cache_read: 0.2,   output: 2.5,   apply_max_mode_uplift: true },
      "gemini-2.5-flash":     { input: 0.3,  cache_write: null,  cache_read: 0.03,  output: 2.5,   apply_max_mode_uplift: true },
      "gemini-3-flash":       { input: 0.5,  cache_write: null,  cache_read: 0.05,  output: 3.0,   apply_max_mode_uplift: true },
      "gemini-3-pro":         { input: 2.0,  cache_write: null,  cache_read: 0.2,   output: 12.0,  apply_max_mode_uplift: true },
      "gemini-3.1-pro":       { input: 2.0,  cache_write: null,  cache_read: 0.2,   output: 12.0,  apply_max_mode_uplift: true },
      "gemini-3.5-flash":     { input: 1.5,  cache_write: null,  cache_read: 0.15,  output: 9.0,   apply_max_mode_uplift: true },
      "gpt-5":                { input: 1.25, cache_write: null,  cache_read: 0.125, output: 10.0,  apply_max_mode_uplift: true },
      "gpt-5-fast":           { input: 2.5,  cache_write: null,  cache_read: 0.25,  output: 20.0,  apply_max_mode_uplift: true },
      "gpt-5-mini":           { input: 0.25, cache_write: null,  cache_read: 0.025, output: 2.0,   apply_max_mode_uplift: true },
      "gpt-5-codex":          { input: 1.25, cache_write: null,  cache_read: 0.125, output: 10.0,  apply_max_mode_uplift: true },
      "gpt-5.1-codex":        { input: 1.25, cache_write: null,  cache_read: 0.125, output: 10.0,  apply_max_mode_uplift: true },
      "gpt-5.4":              { input: 2.5,  cache_write: null,  cache_read: 0.25,  output: 15.0,  apply_max_mode_uplift: true },
      "gpt-5.4-mini":         { input: 0.75, cache_write: null,  cache_read: 0.075, output: 4.5,   apply_max_mode_uplift: true },
      "gpt-5.4-nano":         { input: 0.2,  cache_write: null,  cache_read: 0.02,  output: 1.25,  apply_max_mode_uplift: true },
      "gpt-5.5":              { input: 5.0,  cache_write: null,  cache_read: 0.5,   output: 30.0,  apply_max_mode_uplift: true },
      // GPT-5.6 (Sol/Terra/Luna) bills cache writes at 1.25x input and cache reads at 10% of input.
      "gpt-5.6-luna":         { input: 1.0,  cache_write: 1.25,  cache_read: 0.1,   output: 6.0,   apply_max_mode_uplift: true },
      "gpt-5.6-sol":          { input: 5.0,  cache_write: 6.25,  cache_read: 0.5,   output: 30.0,  apply_max_mode_uplift: true },
      "gpt-5.6-terra":        { input: 2.5,  cache_write: 3.125, cache_read: 0.25,  output: 15.0,  apply_max_mode_uplift: true },
      "grok-4.20":            { input: 2.0,  cache_write: null,  cache_read: 0.2,   output: 6.0,   apply_max_mode_uplift: true },
      "grok-4.3":             { input: 1.25, cache_write: null,  cache_read: 0.2,   output: 2.5,   apply_max_mode_uplift: true },
      // Grok 4.5, per https://cursor.com/blog/grok-4-5 (2026-07-09). Cursor's "doubling usage
      // for the first week" launch promo is an included-quota bonus, not a per-token discount —
      // these are the standing list rates and don't need adjusting for it.
      "grok-4.5":             { input: 2.0,  cache_write: null,  cache_read: 0.2,   output: 6.0,   apply_max_mode_uplift: true },
      "grok-4.5-fast":        { input: 4.0,  cache_write: null,  cache_read: 0.4,   output: 18.0,  apply_max_mode_uplift: true },
      "grok-build-0.1":       { input: 1.0,  cache_write: null,  cache_read: 0.2,   output: 2.0,   apply_max_mode_uplift: true },
      "kimi-k2.5":            { input: 0.6,  cache_write: null,  cache_read: 0.1,   output: 3.0,   apply_max_mode_uplift: true },
    },
    // Ordered regex rules mapping CSV model slugs -> canonical id. First match wins;
    // put more specific patterns first. Extend as new slugs are observed in the CSV.
    alias_rules: [
      { pattern: "^composer-2\\.5", canonical: "composer-2.5" },
      { pattern: "^composer-2\\b", canonical: "composer-2" },
      { pattern: "^composer-1\\.5", canonical: "composer-1.5" },
      { pattern: "^composer-1\\b", canonical: "composer-1" },
      { pattern: "^claude-sonnet-5", canonical: "claude-sonnet-5" },
      { pattern: "^claude-opus-4\\.8", canonical: "claude-opus-4.8" },
      { pattern: "^claude-opus-4\\.7.*fast", canonical: "claude-opus-4.7-fast" },
      { pattern: "^claude-4\\.7-opus", canonical: "claude-4.7-opus" },
      { pattern: "^claude-4\\.6-opus", canonical: "claude-4.6-opus" },
      { pattern: "^claude-4\\.6-sonnet", canonical: "claude-4.6-sonnet" },
      { pattern: "^claude-4\\.5-opus", canonical: "claude-4.5-opus" },
      { pattern: "^claude-4\\.5-haiku", canonical: "claude-4.5-haiku" },
      { pattern: "^claude-4\\.5-sonnet", canonical: "claude-4.5-sonnet" },
      { pattern: "^claude-4-sonnet-1m", canonical: "claude-4-sonnet-1m" },
      { pattern: "^claude-4-sonnet", canonical: "claude-4-sonnet" },
      { pattern: "^claude-fable-5", canonical: "claude-fable-5" },
      { pattern: "^gpt-5\\.6-sol", canonical: "gpt-5.6-sol" },
      { pattern: "^gpt-5\\.6-terra", canonical: "gpt-5.6-terra" },
      { pattern: "^gpt-5\\.6-luna", canonical: "gpt-5.6-luna" },
      { pattern: "^gpt-5\\.5", canonical: "gpt-5.5" },
      { pattern: "^gpt-5\\.4-nano", canonical: "gpt-5.4-nano" },
      { pattern: "^gpt-5\\.4-mini", canonical: "gpt-5.4-mini" },
      { pattern: "^gpt-5\\.4", canonical: "gpt-5.4" },
      { pattern: "^gpt-5\\.1-codex", canonical: "gpt-5.1-codex" },
      { pattern: "^gpt-5-codex", canonical: "gpt-5-codex" },
      { pattern: "^gpt-5-mini", canonical: "gpt-5-mini" },
      { pattern: "^gpt-5-fast", canonical: "gpt-5-fast" },
      { pattern: "^gpt-5\\b", canonical: "gpt-5" },
      { pattern: "^gemini-3\\.5-flash", canonical: "gemini-3.5-flash" },
      { pattern: "^gemini-3\\.1-pro", canonical: "gemini-3.1-pro" },
      { pattern: "^gemini-3-pro", canonical: "gemini-3-pro" },
      { pattern: "^gemini-3-flash", canonical: "gemini-3-flash" },
      { pattern: "^gemini-2\\.5-flash", canonical: "gemini-2.5-flash" },
      { pattern: "^grok-4\\.20", canonical: "grok-4.20" },
      { pattern: "^grok-4\\.3", canonical: "grok-4.3" },
      { pattern: "^grok-4\\.5-fast", canonical: "grok-4.5-fast" },
      { pattern: "^grok-4\\.5", canonical: "grok-4.5" },
      { pattern: "^grok-build-0\\.1", canonical: "grok-build-0.1" },
      { pattern: "^kimi-k2\\.5", canonical: "kimi-k2.5" },
    ],
  }

  function resolveModelRates(slug) {
    const s = String(slug || "").trim().toLowerCase()
    if (!s) return null
    for (let i = 0; i < CURSOR_PRICING.alias_rules.length; i++) {
      const rule = CURSOR_PRICING.alias_rules[i]
      var re
      try {
        re = new RegExp(rule.pattern)
      } catch (e) {
        continue
      }
      if (re.test(s)) {
        return CURSOR_PRICING.models[rule.canonical] || null
      }
    }
    return null
  }

  function parseCsvLine(line) {
    const out = []
    var cur = ""
    var inQuotes = false
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i)
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            cur += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          cur += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        out.push(cur)
        cur = ""
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out
  }

  function parseUsageEventsCsv(text) {
    var rows = []
    if (typeof text !== "string" || !text.trim()) return rows
    var lines = text.split(/\r?\n/)
    if (lines.length < 2) return rows
    var header = parseCsvLine(lines[0]).map(function (h) {
      return h.trim()
    })
    function col(name) {
      return header.indexOf(name)
    }
    var iDate = col("Date")
    var iKind = col("Kind")
    var iModel = col("Model")
    var iMax = col("Max Mode")
    var iCW = col("Input (w/ Cache Write)")
    var iIn = col("Input (w/o Cache Write)")
    var iCR = col("Cache Read")
    var iOut = col("Output Tokens")
    var iTot = col("Total Tokens")
    if (iDate < 0 || iModel < 0) return rows
    function num(v) {
      var n = Number(String(v == null ? "" : v).trim())
      return Number.isFinite(n) ? n : 0
    }
    function str(v) {
      return String(v == null ? "" : v).trim()
    }
    for (var i = 1; i < lines.length; i++) {
      var raw = lines[i]
      if (!raw || !raw.trim()) continue
      var c = parseCsvLine(raw)
      var date = str(c[iDate])
      if (!date) continue
      var cacheWrite = iCW >= 0 ? num(c[iCW]) : 0
      var input = iIn >= 0 ? num(c[iIn]) : 0
      var cacheRead = iCR >= 0 ? num(c[iCR]) : 0
      var output = iOut >= 0 ? num(c[iOut]) : 0
      rows.push({
        date: date,
        kind: iKind >= 0 ? str(c[iKind]) : "",
        model: str(c[iModel]),
        maxMode: iMax >= 0 ? str(c[iMax]) : "",
        cacheWrite: cacheWrite,
        input: input,
        cacheRead: cacheRead,
        output: output,
        totalTokens: iTot >= 0 ? num(c[iTot]) : cacheWrite + input + cacheRead + output,
      })
    }
    return rows
  }

  function dayKeyFromDate(date) {
    var year = date.getFullYear()
    var month = date.getMonth() + 1
    var day = date.getDate()
    return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day
  }

  function dayKeyFromUsageDate(rawDate) {
    if (typeof rawDate !== "string") return null
    var value = rawDate.trim()
    if (!value) return null
    var isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3]
    }
    var ms = Date.parse(value)
    if (!Number.isFinite(ms)) return null
    return dayKeyFromDate(new Date(ms))
  }

  function imputeRowCostUsd(row, rates, isRequestBasedPlan) {
    if (!rates) return 0
    var cwRate = rates.cache_write == null ? rates.input : rates.cache_write
    var base =
      (row.input * rates.input +
        row.cacheWrite * cwRate +
        row.cacheRead * rates.cache_read +
        row.output * rates.output) /
      1e6
    var uplift =
      row.maxMode === "Yes" && isRequestBasedPlan && rates.apply_max_mode_uplift
        ? MAX_MODE_UPLIFT
        : 1
    return base * uplift
  }

  function aggregateDailyFromCsvRows(ctx, rows, nowMs, isRequestBasedPlan) {
    var cutoffMs = nowMs - 31 * 24 * 60 * 60 * 1000
    var byDay = {}
    var warned = {}
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      var ms = Date.parse(row.date)
      if (!Number.isFinite(ms) || ms < cutoffMs) continue
      var key = dayKeyFromUsageDate(row.date)
      if (!key) continue
      var rates = resolveModelRates(row.model)
      if (!rates && row.model && !warned[row.model]) {
        warned[row.model] = true
        ctx.host.log.info("cursor pricing: unknown model " + row.model)
      }
      var cost = imputeRowCostUsd(row, rates, isRequestBasedPlan)
      if (!byDay[key]) byDay[key] = { date: key, costUSD: 0, totalTokens: 0 }
      byDay[key].costUSD += cost
      var t = Number(row.totalTokens)
      if (Number.isFinite(t)) byDay[key].totalTokens += t
    }
    return Object.keys(byDay)
      .sort()
      .map(function (k) {
        return byDay[k]
      })
  }

  function fmtTokens(n) {
    var abs = Math.abs(n)
    var sign = n < 0 ? "-" : ""
    var units = [
      { threshold: 1e9, divisor: 1e9, suffix: "B" },
      { threshold: 1e6, divisor: 1e6, suffix: "M" },
      { threshold: 1e3, divisor: 1e3, suffix: "K" },
    ]
    for (var i = 0; i < units.length; i++) {
      var unit = units[i]
      if (abs >= unit.threshold) {
        var scaled = abs / unit.divisor
        var formatted = scaled >= 10 ? Math.round(scaled).toString() : scaled.toFixed(1).replace(/\.0$/, "")
        return sign + formatted + unit.suffix
      }
    }
    return sign + Math.round(abs).toString()
  }

  function costAndTokensLabel(data, opts) {
    var includeZeroTokens = !!(opts && opts.includeZeroTokens)
    var parts = []
    if (data.costUSD != null) parts.push("$" + data.costUSD.toFixed(2))
    if (data.tokens > 0 || (includeZeroTokens && data.tokens === 0)) {
      parts.push(fmtTokens(data.tokens))
    }
    return parts.join(" · ")
  }

  function usageCostUsd(day) {
    if (!day || typeof day !== "object") return null
    if (day.costUSD != null) {
      var costUSD = Number(day.costUSD)
      if (Number.isFinite(costUSD)) return costUSD
    }
    return null
  }

  function usageDayLabel(rawDate) {
    var key = dayKeyFromUsageDate(rawDate)
    if (!key) return String(rawDate || "").slice(0, 10) || "Usage"
    var month = Number(key.slice(5, 7))
    var day = Number(key.slice(8, 10))
    return month + "/" + day
  }

  function collectUsageChartPoints(daily) {
    var points = []
    for (var i = 0; i < daily.length; i++) {
      var day = daily[i]
      var tokens = Number(day && day.totalTokens)
      if (!Number.isFinite(tokens) || tokens < 0) continue
      var key = dayKeyFromUsageDate(day.date)
      if (!key) continue
      points.push({
        key: key,
        label: usageDayLabel(day.date),
        value: tokens,
        valueLabel: fmtTokens(tokens),
      })
    }
    return points
      .sort(function (a, b) {
        return a.key.localeCompare(b.key)
      })
      .slice(-31)
      .map(function (point) {
        return { label: point.label, value: point.value, valueLabel: point.valueLabel }
      })
  }

  function pushUsageChartLine(lines, ctx, daily) {
    var points = collectUsageChartPoints(daily)
    if (points.length === 0) return
    lines.push(
      ctx.line.barChart({
        label: "Usage Trend",
        points: points,
        note: "Estimated at API rates.",
        color: "#000000",
      })
    )
  }

  function pushDayUsageLine(lines, ctx, label, dayEntry) {
    var tokens = Number(dayEntry && dayEntry.totalTokens) || 0
    var cost = usageCostUsd(dayEntry)
    if (tokens > 0) {
      lines.push(ctx.line.text({ label: label, value: costAndTokensLabel({ tokens: tokens, costUSD: cost }) }))
      return
    }
    lines.push(
      ctx.line.text({ label: label, value: costAndTokensLabel({ tokens: 0, costUSD: 0 }, { includeZeroTokens: true }) })
    )
  }

  var USAGE_CSV_URL = "https://cursor.com/api/dashboard/export-usage-events-csv"

  function fetchUsageEventsCsv(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) return null
    try {
      var resp = ctx.util.request({
        method: "GET",
        url: USAGE_CSV_URL,
        headers: { Cookie: "WorkosCursorSessionToken=" + session.sessionToken },
        timeoutMs: 10000,
      })
      if (!resp || resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("usage events csv returned status=" + (resp && resp.status))
        return null
      }
      return typeof resp.bodyText === "string" ? resp.bodyText : null
    } catch (e) {
      ctx.host.log.warn("usage events csv fetch failed: " + String(e))
      return null
    }
  }

  function appendSpendHistory(ctx, lines, accessToken, isRequestBasedPlan) {
    var csv = fetchUsageEventsCsv(ctx, accessToken)
    if (!csv) return
    var rows = parseUsageEventsCsv(csv)
    if (!rows.length) return
    var nowMs = Date.now()
    var daily = aggregateDailyFromCsvRows(ctx, rows, nowMs, isRequestBasedPlan)
    if (!daily.length) return

    // Buckets are keyed by UTC day (dayKeyFromUsageDate reads the ISO Z prefix),
    // so derive today/yesterday in UTC too — otherwise users far from UTC get
    // their current-day spend mislabeled or dropped from Today/Yesterday.
    var todayKey = new Date(nowMs).toISOString().slice(0, 10)
    var yesterdayKey = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    var todayEntry = null
    var yesterdayEntry = null
    for (var i = 0; i < daily.length; i++) {
      var k = dayKeyFromUsageDate(daily[i].date)
      if (k === todayKey) todayEntry = daily[i]
      else if (k === yesterdayKey) yesterdayEntry = daily[i]
    }
    pushDayUsageLine(lines, ctx, "Today", todayEntry)
    pushDayUsageLine(lines, ctx, "Yesterday", yesterdayEntry)

    var totalTokens = 0
    var totalCostNanos = 0
    var hasCost = false
    for (var j = 0; j < daily.length; j++) {
      var day = daily[j]
      var t = Number(day.totalTokens)
      if (Number.isFinite(t)) totalTokens += t
      var c = usageCostUsd(day)
      if (c != null) {
        totalCostNanos += Math.round(c * 1e9)
        hasCost = true
      }
    }
    if (totalTokens > 0) {
      lines.push(
        ctx.line.text({
          label: "Last 30 Days",
          value: costAndTokensLabel({ tokens: totalTokens, costUSD: hasCost ? totalCostNanos / 1e9 : null }),
        })
      )
    }
    pushUsageChartLine(lines, ctx, daily)
  }

  function readStateValue(ctx, key) {
    try {
      const sql =
        "SELECT value FROM ItemTable WHERE key = '" + key + "' LIMIT 1;"
      const json = ctx.host.sqlite.query(STATE_DB, sql)
      const rows = ctx.util.tryParseJson(json)
      if (!Array.isArray(rows)) {
        throw new Error("sqlite returned invalid json")
      }
      if (rows.length > 0 && rows[0].value) {
        return rows[0].value
      }
    } catch (e) {
      ctx.host.log.warn("sqlite read failed for " + key + ": " + String(e))
    }
    return null
  }

  function writeStateValue(ctx, key, value) {
    try {
      // Escape single quotes in value for SQL
      const escaped = String(value).replace(/'/g, "''")
      const sql =
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('" +
        key +
        "', '" +
        escaped +
        "');"
      ctx.host.sqlite.exec(STATE_DB, sql)
      return true
    } catch (e) {
      ctx.host.log.warn("sqlite write failed for " + key + ": " + String(e))
      return false
    }
  }

  function readKeychainValue(ctx, service) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }
    try {
      const value = ctx.host.keychain.readGenericPassword(service)
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.info("keychain read failed for " + service + ": " + String(e))
      return null
    }
  }

  function writeKeychainValue(ctx, service, value) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.writeGenericPassword !== "function") {
      ctx.host.log.warn("keychain write unsupported")
      return false
    }
    try {
      ctx.host.keychain.writeGenericPassword(service, String(value))
      return true
    } catch (e) {
      ctx.host.log.warn("keychain write failed for " + service + ": " + String(e))
      return false
    }
  }

  function loadAuthState(ctx) {
    const sqliteAccessToken = readStateValue(ctx, "cursorAuth/accessToken")
    const sqliteRefreshToken = readStateValue(ctx, "cursorAuth/refreshToken")
    const sqliteMembershipTypeRaw = readStateValue(ctx, "cursorAuth/stripeMembershipType")
    const sqliteMembershipType = typeof sqliteMembershipTypeRaw === "string"
      ? sqliteMembershipTypeRaw.trim().toLowerCase()
      : null

    const keychainAccessToken = readKeychainValue(ctx, KEYCHAIN_ACCESS_TOKEN_SERVICE)
    const keychainRefreshToken = readKeychainValue(ctx, KEYCHAIN_REFRESH_TOKEN_SERVICE)

    const sqliteSubject = getTokenSubject(ctx, sqliteAccessToken)
    const keychainSubject = getTokenSubject(ctx, keychainAccessToken)
    const hasDifferentSubjects = !!sqliteSubject && !!keychainSubject && sqliteSubject !== keychainSubject
    const sqliteLooksFree = sqliteMembershipType === "free"

    if (sqliteAccessToken || sqliteRefreshToken) {
      if ((keychainAccessToken || keychainRefreshToken) && sqliteLooksFree && hasDifferentSubjects) {
        ctx.host.log.info("sqlite auth looks free and differs from keychain account; preferring keychain token")
        return {
          accessToken: keychainAccessToken,
          refreshToken: keychainRefreshToken,
          source: "keychain",
        }
      }

      return {
        accessToken: sqliteAccessToken,
        refreshToken: sqliteRefreshToken,
        source: "sqlite",
      }
    }

    if (keychainAccessToken || keychainRefreshToken) {
      return {
        accessToken: keychainAccessToken,
        refreshToken: keychainRefreshToken,
        source: "keychain",
      }
    }

    return {
      accessToken: null,
      refreshToken: null,
      source: null,
    }
  }

  function getTokenSubject(ctx, token) {
    if (!token) return null
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.sub !== "string") return null
    const subject = payload.sub.trim()
    return subject || null
  }

  function persistAccessToken(ctx, source, accessToken) {
    if (source === "keychain") {
      return writeKeychainValue(ctx, KEYCHAIN_ACCESS_TOKEN_SERVICE, accessToken)
    }
    return writeStateValue(ctx, "cursorAuth/accessToken", accessToken)
  }

  function getTokenExpiration(ctx, token) {
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number") return null
    return payload.exp * 1000 // Convert to milliseconds
  }

  function needsRefresh(ctx, accessToken, nowMs) {
    if (!accessToken) return true
    const expiresAt = getTokenExpiration(ctx, accessToken)
    return ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: expiresAt,
      bufferMs: REFRESH_BUFFER_MS,
    })
  }

  function refreshToken(ctx, refreshTokenValue, source) {
    if (!refreshTokenValue) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting token refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/json" },
        bodyText: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: refreshTokenValue,
        }),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401) {
        let errorInfo = null
        errorInfo = ctx.util.tryParseJson(resp.bodyText)
        const shouldLogout = errorInfo && errorInfo.shouldLogout === true
        ctx.host.log.error("refresh failed: status=" + resp.status + " shouldLogout=" + shouldLogout)
        if (shouldLogout) {
          throw "Session expired. " + LOGIN_HINT
        }
        throw "Token expired. " + LOGIN_HINT
      }

      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("refresh returned unexpected status: " + resp.status)
        return null
      }

      const body = ctx.util.tryParseJson(resp.bodyText)
      if (!body) {
        ctx.host.log.warn("refresh response not valid JSON")
        return null
      }

      // Check if server wants us to logout
      if (body.shouldLogout === true) {
        ctx.host.log.error("refresh response indicates shouldLogout=true")
        throw "Session expired. " + LOGIN_HINT
      }

      const newAccessToken = body.access_token
      if (!newAccessToken) {
        ctx.host.log.warn("refresh response missing access_token")
        return null
      }

      // Persist updated access token to source where auth was loaded from.
      persistAccessToken(ctx, source, newAccessToken)
      ctx.host.log.info("refresh succeeded, token persisted")

      // Note: Cursor refresh returns access_token which is used as both
      // access and refresh token in some flows
      return newAccessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("refresh exception: " + String(e))
      return null
    }
  }

  function connectPost(ctx, url, token) {
    return ctx.util.request({
      method: "POST",
      url: url,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      bodyText: "{}",
      timeoutMs: 10000,
    })
  }

  function buildSessionToken(ctx, accessToken) {
    var payload = ctx.jwt.decodePayload(accessToken)
    if (!payload || !payload.sub) return null
    var parts = String(payload.sub).split("|")
    var userId = parts.length > 1 ? parts[1] : parts[0]
    if (!userId) return null
    return { userId: userId, sessionToken: userId + "%3A%3A" + accessToken }
  }

  function fetchRequestBasedUsage(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("request-based: cannot build session token")
      return null
    }
    try {
      var resp = ctx.util.request({
        method: "GET",
        url: REST_USAGE_URL + "?user=" + encodeURIComponent(session.userId),
        headers: {
          Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("request-based usage returned status=" + resp.status)
        return null
      }
      return ctx.util.tryParseJson(resp.bodyText)
    } catch (e) {
      ctx.host.log.warn("request-based usage fetch failed: " + String(e))
      return null
    }
  }

  function fetchStripeBalance(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("stripe: cannot build session token")
      return null
    }
    try {
      var resp = ctx.util.request({
        method: "GET",
        url: STRIPE_URL,
        headers: {
          Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("stripe balance returned status=" + resp.status)
        return null
      }
      var stripe = ctx.util.tryParseJson(resp.bodyText)
      if (!stripe) return null
      var customerBalanceCents = Number(stripe.customerBalance)
      if (!Number.isFinite(customerBalanceCents)) return null
      // Stripe stores customer credits as a negative balance.
      return customerBalanceCents < 0 ? Math.abs(customerBalanceCents) : 0
    } catch (e) {
      ctx.host.log.warn("stripe balance fetch failed: " + String(e))
      return null
    }
  }

  function buildRequestBasedResult(ctx, accessToken, planName, unavailableMessage) {
    var requestUsage = fetchRequestBasedUsage(ctx, accessToken)
    var lines = []

    if (requestUsage) {
      var gpt4 = requestUsage["gpt-4"]
      if (gpt4 && typeof gpt4.maxRequestUsage === "number" && gpt4.maxRequestUsage > 0) {
        var used = gpt4.numRequests || 0
        var limit = gpt4.maxRequestUsage

        var billingPeriodMs = 30 * 24 * 60 * 60 * 1000
        var cycleStart = requestUsage.startOfMonth
          ? ctx.util.parseDateMs(requestUsage.startOfMonth)
          : null
        var cycleEndMs = cycleStart ? cycleStart + billingPeriodMs : null

        lines.push(ctx.line.progress({
          label: "Requests",
          used: used,
          limit: limit,
          format: { kind: "count", suffix: "requests" },
          resetsAt: ctx.util.toIso(cycleEndMs),
          periodDurationMs: billingPeriodMs,
        }))
      }
    }

    if (lines.length === 0) {
      ctx.host.log.warn("request-based: no usage data available")
      throw unavailableMessage
    }

    var plan = null
    if (planName) {
      var planLabel = ctx.fmt.planLabel(planName)
      if (planLabel) plan = planLabel
    }

    appendSpendHistory(ctx, lines, accessToken, true)

    return { plan: plan, lines: lines }
  }

  function buildEnterpriseResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Enterprise usage data unavailable. Try again later."
    )
  }

  function buildTeamRequestBasedResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Team request-based usage data unavailable. Try again later."
    )
  }

  function buildUnknownRequestBasedResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Cursor request-based usage data unavailable. Try again later."
    )
  }

  function probe(ctx) {
    const authState = loadAuthState(ctx)
    let accessToken = authState.accessToken
    const refreshTokenValue = authState.refreshToken
    const authSource = authState.source

    if (!accessToken && !refreshTokenValue) {
      ctx.host.log.error("probe failed: no access or refresh token in sqlite/keychain")
      throw "Not logged in. " + LOGIN_HINT
    }

    ctx.host.log.info("tokens loaded from " + authSource + ": accessToken=" + (accessToken ? "yes" : "no") + " refreshToken=" + (refreshTokenValue ? "yes" : "no"))

    const nowMs = Date.now()

    // Proactively refresh if token is expired or about to expire
    if (needsRefresh(ctx, accessToken, nowMs)) {
      ctx.host.log.info("token needs refresh (expired or expiring soon)")
      let refreshed = null
      try {
        refreshed = refreshToken(ctx, refreshTokenValue, authSource)
      } catch (e) {
        // If refresh fails but we have an access token, try it anyway
        ctx.host.log.warn("refresh failed but have access token, will try: " + String(e))
        if (!accessToken) throw e
      }
      if (refreshed) {
        accessToken = refreshed
      } else if (!accessToken) {
        ctx.host.log.error("refresh failed and no access token available")
        throw "Not logged in. " + LOGIN_HINT
      }
    }

    let usageResp
    let didRefresh = false
    try {
      usageResp = ctx.util.retryOnceOnAuth({
        request: (token) => {
          try {
            return connectPost(ctx, USAGE_URL, token || accessToken)
          } catch (e) {
            ctx.host.log.error("usage request exception: " + String(e))
            if (didRefresh) {
              throw "Usage request failed after refresh. Try again."
            }
            throw "Usage request failed. Check your connection."
          }
        },
        refresh: () => {
          ctx.host.log.info("usage returned 401, attempting refresh")
          didRefresh = true
          const refreshed = refreshToken(ctx, refreshTokenValue, authSource)
          if (refreshed) accessToken = refreshed
          return refreshed
        },
      })
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("usage request failed: " + String(e))
      throw "Usage request failed. Check your connection."
    }

    if (ctx.util.isAuthStatus(usageResp.status)) {
      ctx.host.log.error("usage returned auth error after all retries: status=" + usageResp.status)
      throw "Token expired. " + LOGIN_HINT
    }

    if (usageResp.status < 200 || usageResp.status >= 300) {
      ctx.host.log.error("usage returned error: status=" + usageResp.status)
      throw "Usage request failed (HTTP " + String(usageResp.status) + "). Try again later."
    }

    ctx.host.log.info("usage fetch succeeded")

    const usage = ctx.util.tryParseJson(usageResp.bodyText)
    if (usage === null) {
      throw "Usage response invalid. Try again later."
    }

    // Fetch plan info early (needed for request-based fallback detection)
    let planName = ""
    let planInfoUnavailable = false
    try {
      const planResp = connectPost(ctx, PLAN_URL, accessToken)
      if (planResp.status >= 200 && planResp.status < 300) {
        const plan = ctx.util.tryParseJson(planResp.bodyText)
        if (plan && plan.planInfo && plan.planInfo.planName) {
          planName = plan.planInfo.planName
        }
      } else {
        planInfoUnavailable = true
        ctx.host.log.warn("plan info returned error: status=" + planResp.status)
      }
    } catch (e) {
      planInfoUnavailable = true
      ctx.host.log.warn("plan info fetch failed: " + String(e))
    }

    const normalizedPlanName = typeof planName === "string"
      ? planName.toLowerCase()
      : ""

    const hasPlanUsage = !!usage.planUsage
    const hasPlanUsageLimit = hasPlanUsage &&
      typeof usage.planUsage.limit === "number" &&
      Number.isFinite(usage.planUsage.limit)
    const planUsageLimitMissing = hasPlanUsage && !hasPlanUsageLimit
    const hasTotalUsagePercent = hasPlanUsage &&
      typeof usage.planUsage.totalPercentUsed === "number" &&
      Number.isFinite(usage.planUsage.totalPercentUsed)

    // Enterprise and some Team request-based accounts can return no planUsage
    // or a planUsage object without limit from the Connect API.
    const needsRequestBasedFallback = usage.enabled !== false && (!hasPlanUsage || planUsageLimitMissing) && (
      normalizedPlanName === "enterprise" ||
      normalizedPlanName === "team"
    )
    if (needsRequestBasedFallback) {
      if (normalizedPlanName === "enterprise") {
        ctx.host.log.info("detected enterprise account, using REST usage API")
        return buildEnterpriseResult(ctx, accessToken, planName)
      }
      ctx.host.log.info("detected team request-based account, using REST usage API")
      return buildTeamRequestBasedResult(ctx, accessToken, planName)
    }

    const needsFallbackWithoutPlanInfo = usage.enabled !== false &&
      (!hasPlanUsage || planUsageLimitMissing) &&
      !hasTotalUsagePercent &&
      !normalizedPlanName &&
      planInfoUnavailable
    if (needsFallbackWithoutPlanInfo) {
      ctx.host.log.info("plan info unavailable with missing planUsage, attempting REST usage API fallback")
      return buildUnknownRequestBasedResult(ctx, accessToken, planName)
    }

    if (usage.enabled !== false && planUsageLimitMissing && !hasTotalUsagePercent) {
      ctx.host.log.warn("planUsage.limit missing, attempting REST usage API fallback")
      try {
        return buildUnknownRequestBasedResult(ctx, accessToken, planName)
      } catch (e) {
        ctx.host.log.warn("REST usage fallback unavailable: " + String(e))
      }
    }

    // Team plans may omit `enabled` even with valid plan usage data.
    if (usage.enabled === false || !usage.planUsage) {
      throw "No active Cursor subscription."
    }

    let creditGrants = null
    try {
      const creditsResp = connectPost(ctx, CREDITS_URL, accessToken)
      if (creditsResp.status >= 200 && creditsResp.status < 300) {
        creditGrants = ctx.util.tryParseJson(creditsResp.bodyText)
      }
    } catch (e) {
      ctx.host.log.warn("credit grants fetch failed: " + String(e))
    }

    const stripeBalanceCents = fetchStripeBalance(ctx, accessToken) || 0

    let plan = null
    if (planName) {
      const planLabel = ctx.fmt.planLabel(planName)
      if (planLabel) {
        plan = planLabel
      }
    }

    const lines = []
    const pu = usage.planUsage

    // Credits first (if available) - highest priority primary metric
    const hasCreditGrants = creditGrants && creditGrants.hasCreditGrants === true
    const grantTotalCents = hasCreditGrants ? parseInt(creditGrants.totalCents, 10) : 0
    const grantUsedCents = hasCreditGrants ? parseInt(creditGrants.usedCents, 10) : 0
    const hasValidGrantData = hasCreditGrants &&
      grantTotalCents > 0 &&
      !isNaN(grantTotalCents) &&
      !isNaN(grantUsedCents)
    const combinedTotalCents = (hasValidGrantData ? grantTotalCents : 0) + stripeBalanceCents

    if (combinedTotalCents > 0) {
      lines.push(ctx.line.progress({
        label: "Credits",
        used: ctx.fmt.dollars(hasValidGrantData ? grantUsedCents : 0),
        limit: ctx.fmt.dollars(combinedTotalCents),
        format: { kind: "dollars" },
      }))
    }

    // Total usage (always present) - fallback primary metric
    if (!hasPlanUsageLimit && !hasTotalUsagePercent) {
      throw "Total usage limit missing from API response."
    }
    const planUsed = hasPlanUsageLimit
      ? (typeof pu.totalSpend === "number"
        ? pu.totalSpend
        : pu.limit - (pu.remaining ?? 0))
      : 0
    const computedPercentUsed = hasPlanUsageLimit && pu.limit > 0
      ? (planUsed / pu.limit) * 100
      : 0
    const totalUsagePercent = hasTotalUsagePercent
      ? pu.totalPercentUsed
      : computedPercentUsed

    // Calculate billing cycle period duration
    var billingPeriodMs = 30 * 24 * 60 * 60 * 1000 // 30 days default
    var cycleStart = Number(usage.billingCycleStart)
    var cycleEnd = Number(usage.billingCycleEnd)
    if (Number.isFinite(cycleStart) && Number.isFinite(cycleEnd) && cycleEnd > cycleStart) {
      billingPeriodMs = cycleEnd - cycleStart // already in ms
    }

    const su = usage.spendLimitUsage
    const isTeamAccount = (
      normalizedPlanName === "team" ||
      (su && su.limitType === "team") ||
      (su && typeof su.pooledLimit === "number" && su.pooledLimit > 0)
    )

    if (isTeamAccount) {
      if (!hasPlanUsageLimit) {
        ctx.host.log.warn("team-inferred account missing planUsage.limit, attempting REST usage API fallback")
        return buildUnknownRequestBasedResult(ctx, accessToken, planName)
      }
      lines.push(ctx.line.progress({
        label: "Total usage",
        used: ctx.fmt.dollars(planUsed),
        limit: ctx.fmt.dollars(pu.limit),
        format: { kind: "dollars" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))

      if (typeof pu.bonusSpend === "number" && pu.bonusSpend > 0) {
        lines.push(ctx.line.text({ label: "Bonus spend", value: "$" + String(ctx.fmt.dollars(pu.bonusSpend)) }))
      }
    } else {
      lines.push(ctx.line.progress({
        label: "Total usage",
        used: totalUsagePercent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))
    }

    if (typeof pu.autoPercentUsed === "number" && Number.isFinite(pu.autoPercentUsed)) {
      lines.push(ctx.line.progress({
        label: "Auto usage",
        used: pu.autoPercentUsed,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))
    }

    if (typeof pu.apiPercentUsed === "number" && Number.isFinite(pu.apiPercentUsed)) {
      lines.push(ctx.line.progress({
        label: "API usage",
        used: pu.apiPercentUsed,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs
      }))
    }

    // On-demand (if available) - not a primary candidate
    if (su) {
      const limit = su.individualLimit ?? su.pooledLimit ?? 0
      const remaining = su.individualRemaining ?? su.pooledRemaining ?? 0
      if (limit > 0) {
        const used = limit - remaining
        lines.push(ctx.line.progress({
          label: "On-demand",
          used: ctx.fmt.dollars(used),
          limit: ctx.fmt.dollars(limit),
          format: { kind: "dollars" },
        }))
      }
    }

    appendSpendHistory(ctx, lines, accessToken, false)

    return { plan: plan, lines: lines }
  }

  globalThis.__openusage_plugin = {
    id: "cursor",
    probe,
    __test: {
      resolveModelRates,
      parseUsageEventsCsv,
      imputeRowCostUsd,
      aggregateDailyFromCsvRows,
      dayKeyFromDate,
      dayKeyFromUsageDate,
      appendSpendHistory,
    },
  }
})()
