(function () {
  const AUTH_PATH = "~/.grok/auth.json"
  const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing"
  const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
  const REFRESH_URL = "https://auth.x.ai/oauth2/token"
  const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
  const TOKEN_AUTH_HEADER = "xai-grok-cli"
  const AUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000
  const LOGIN_HINT = "Grok auth expired. Run `grok login` again."

  function readJson(ctx, path) {
    if (!ctx.host.fs.exists(path)) return null
    try {
      return ctx.util.tryParseJson(ctx.host.fs.readText(path))
    } catch {
      return null
    }
  }

  function entryExpiresAtMs(ctx, entry) {
    if (!entry || typeof entry !== "object") return null
    if (entry.expires_at) return ctx.util.parseDateMs(entry.expires_at)
    if (entry.expires) return ctx.util.parseDateMs(entry.expires)
    return null
  }

  function tokenExpiresAtMs(ctx, token) {
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number") return null
    return payload.exp * 1000
  }

  function needsRefresh(ctx, entry, token, nowMs) {
    const entryMs = entryExpiresAtMs(ctx, entry)
    const tokenMs = tokenExpiresAtMs(ctx, token)
    const entryNeedsRefresh = entryMs !== null && ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: entryMs,
      bufferMs: AUTH_REFRESH_BUFFER_MS,
    })
    const tokenNeedsRefresh = tokenMs !== null && ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: tokenMs,
      bufferMs: AUTH_REFRESH_BUFFER_MS,
    })
    return entryNeedsRefresh || tokenNeedsRefresh
  }

  function isExpired(ctx, entry, token, nowMs) {
    const entryMs = entryExpiresAtMs(ctx, entry)
    const tokenMs = tokenExpiresAtMs(ctx, token)
    const expiresAtMs = tokenMs !== null ? tokenMs : entryMs
    if (expiresAtMs === null) return false
    return nowMs >= expiresAtMs
  }

  function readRefreshToken(entry) {
    if (!entry || typeof entry !== "object") return ""
    const refreshToken = typeof entry.refresh_token === "string" ? entry.refresh_token.trim() : ""
    if (refreshToken) return refreshToken
    return typeof entry.refresh === "string" ? entry.refresh.trim() : ""
  }

  function readClientId(entryKey, entry) {
    if (entry && typeof entry.oidc_client_id === "string" && entry.oidc_client_id.trim()) {
      return entry.oidc_client_id.trim()
    }
    const parts = String(entryKey || "").split("::")
    const fromKey = parts.length > 1 ? parts[parts.length - 1].trim() : ""
    return fromKey || DEFAULT_CLIENT_ID
  }

  function nowMs(ctx) {
    return ctx.util.parseDateMs(ctx.nowIso) || Date.now()
  }

  function refreshAuth(ctx, auth, entryKey, entry) {
    const refreshToken = readRefreshToken(entry)
    if (!refreshToken) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting Grok auth refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "grant_type=refresh_token" +
          "&client_id=" + encodeURIComponent(readClientId(entryKey, entry)) +
          "&refresh_token=" + encodeURIComponent(refreshToken),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        const body = ctx.util.tryParseJson(resp.bodyText)
        const code = body && ((body.error && body.error.code) || body.error || body.code)
        ctx.host.log.error("Grok auth refresh failed: status=" + resp.status + " code=" + String(code))
        return null
      }
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Grok auth refresh returned status: " + resp.status)
        return null
      }

      const body = ctx.util.tryParseJson(resp.bodyText)
      if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
        ctx.host.log.warn("Grok auth refresh response missing access_token")
        return null
      }

      const accessToken = body.access_token.trim()
      entry.key = accessToken
      if (typeof body.refresh_token === "string" && body.refresh_token.trim()) {
        entry.refresh_token = body.refresh_token.trim()
      }
      if (typeof body.id_token === "string" && body.id_token.trim()) {
        entry.id_token = body.id_token.trim()
      }

      const refreshedAtMs = nowMs(ctx)
      const expiresIn = Number(body.expires_in)
      const tokenExpiryMs = tokenExpiresAtMs(ctx, accessToken)
      const expiresAtMs = Number.isFinite(expiresIn) && expiresIn > 0
        ? refreshedAtMs + expiresIn * 1000
        : tokenExpiryMs || refreshedAtMs + 3600 * 1000
      entry.expires_at = new Date(expiresAtMs).toISOString()

      try {
        ctx.host.fs.writeText(AUTH_PATH, JSON.stringify(auth, null, 2))
        ctx.host.log.info("Grok auth refresh succeeded, token persisted")
      } catch (e) {
        ctx.host.log.warn("Grok auth refresh succeeded but failed to save auth: " + String(e))
      }

      return accessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("Grok auth refresh exception: " + String(e))
      return null
    }
  }

  function loadAuth(ctx) {
    const auth = readJson(ctx, AUTH_PATH)
    if (!auth || typeof auth !== "object") {
      throw "Grok not logged in. Run `grok login`."
    }

    const currentMs = nowMs(ctx)
    let expiredCandidate = false
    const keys = Object.keys(auth)
    for (let i = 0; i < keys.length; i++) {
      const entryKey = keys[i]
      const entry = auth[entryKey]
      if (!entry || typeof entry !== "object") continue
      const token = typeof entry.key === "string" ? entry.key.trim() : ""
      if (!token) continue
      if (needsRefresh(ctx, entry, token, currentMs)) {
        const refreshed = refreshAuth(ctx, auth, entryKey, entry)
        if (refreshed) return { auth, entryKey, entry, token: refreshed }
        if (!isExpired(ctx, entry, token, currentMs)) {
          ctx.host.log.warn("Grok refresh failed, trying existing access token")
          return { auth, entryKey, entry, token }
        }
        expiredCandidate = true
        continue
      }
      return { auth, entryKey, entry, token }
    }

    if (expiredCandidate) {
      throw LOGIN_HINT
    }
    throw "Grok auth invalid. Run `grok login` again."
  }

  function unitsValue(obj) {
    if (!obj || typeof obj !== "object") return null
    const n = Number(obj.val)
    return Number.isFinite(n) ? n : null
  }

  function clampPercent(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 100) return 100
    return n
  }

  function fetchBillingResponse(ctx, token) {
    try {
      return ctx.util.request({
        method: "GET",
        url: BILLING_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
          Accept: "application/json",
          "User-Agent": "UsagePal",
        },
        timeoutMs: 10000,
      })
    } catch {
      throw "Grok billing request failed. Check your connection."
    }
  }

  function parseBilling(ctx, resp) {
    if (ctx.util.isAuthStatus(resp.status)) {
      throw LOGIN_HINT
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Grok billing request failed (HTTP " + String(resp.status) + "). Try again later."
    }

    const data = ctx.util.tryParseJson(resp.bodyText)
    if (!data) {
      throw "Grok billing response changed."
    }
    return data
  }

  function fetchPlanName(ctx, token) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: SETTINGS_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
          Accept: "application/json",
          "User-Agent": "UsagePal",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) return null
      const data = ctx.util.tryParseJson(resp.bodyText)
      const plan = data && data.subscription_tier_display
      return typeof plan === "string" && plan.trim() ? plan.trim() : null
    } catch {
      return null
    }
  }

  const LOG_RELATIVE = "/logs/unified.jsonl"

  const GROK_PRICING = {
    models: {
      "grok-4.20": { input: 2.0, cache_write: null, cache_read: 0.2, output: 6.0 },
      "grok-4.3": { input: 1.25, cache_write: null, cache_read: 0.2, output: 2.5 },
      "grok-4.5": { input: 2.0, cache_write: null, cache_read: 0.2, output: 6.0 },
      "grok-4.5-fast": { input: 4.0, cache_write: null, cache_read: 0.4, output: 18.0 },
      "grok-build-0.1": { input: 1.0, cache_write: null, cache_read: 0.2, output: 2.0 },
      "composer-2.5-fast": { input: 0.5, cache_write: null, cache_read: 0.2, output: 2.5 },
    },
    alias_rules: [
      { pattern: "^grok-build\\b", canonical: "grok-build-0.1" },
      { pattern: "^grok-composer-2\\.5-fast", canonical: "composer-2.5-fast" },
      { pattern: "^grok-4\\.20", canonical: "grok-4.20" },
      { pattern: "^grok-4\\.3", canonical: "grok-4.3" },
      { pattern: "^grok-4\\.5-fast", canonical: "grok-4.5-fast" },
      { pattern: "^grok-4\\.5", canonical: "grok-4.5" },
    ],
  }

  function logPath(ctx) {
    const grokHome = ctx.host.env.get("GROK_HOME")
    if (typeof grokHome === "string" && grokHome.trim()) {
      return grokHome.trim().replace(/\/+$/, "") + LOG_RELATIVE
    }
    return "~/.grok" + LOG_RELATIVE
  }

  function readNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function dayKeyFromMs(ms) {
    if (!Number.isFinite(ms)) return null
    return new Date(ms).toISOString().slice(0, 10)
  }

  function recentUtcDayKeys(nowMs, count) {
    const keys = []
    for (let i = 0; i < count; i += 1) {
      keys.push(new Date(nowMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
    }
    return keys
  }

  function resolveModelRates(slug) {
    const s = String(slug || "").trim().toLowerCase()
    if (!s) return null
    for (let i = 0; i < GROK_PRICING.alias_rules.length; i += 1) {
      const rule = GROK_PRICING.alias_rules[i]
      try {
        if (new RegExp(rule.pattern).test(s)) {
          return GROK_PRICING.models[rule.canonical] || null
        }
      } catch (e) {
        continue
      }
    }
    return null
  }

  function estimatedCostDollars(model, inputNoCache, cacheRead, output) {
    const rates = resolveModelRates(model)
    if (!rates) return null
    return (
      (inputNoCache * rates.input + cacheRead * rates.cache_read + output * rates.output) /
      1e6
    )
  }

  function modelIDFromEvent(msg, ctxObj) {
    let raw = null
    if (msg === "model changed") raw = ctxObj.model
    else if (msg === "model catalog: notifying clients") raw = ctxObj.current_model_id
    else if (msg === "backend_search: model switch") {
      raw = ctxObj.model || ctxObj.current_model_id || ctxObj.model_id
    } else if (msg === "subagent model resolved") {
      raw = ctxObj.model_id || ctxObj.model
    } else {
      return null
    }
    const model = typeof raw === "string" ? raw.trim() : ""
    return model || null
  }

  function parseTimestamp(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : null
  }

  function buildUsageRowsFromLog(ctx, text, sinceMs) {
    const modelByPID = {}
    const rows = []

    const lines = String(text || "").split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line) continue
      if (line.indexOf("inference_done") === -1 && line.indexOf("model") === -1) continue

      let object = null
      try {
        object = JSON.parse(line)
      } catch (e) {
        continue
      }
      if (!object || typeof object !== "object") continue

      const msg = typeof object.msg === "string" ? object.msg : ""
      const ctxObj = object.ctx && typeof object.ctx === "object" ? object.ctx : {}
      const pid = readNumber(object.pid)

      const modelFromEvent = modelIDFromEvent(msg, ctxObj)
      if (modelFromEvent) {
        if (pid !== null) modelByPID[pid] = modelFromEvent
        continue
      }

      if (msg !== "shell.turn.inference_done") continue

      const promptTokens = readNumber(ctxObj.prompt_tokens)
      if (promptTokens === null) continue

      const tsMs = parseTimestamp(object.ts)
      if (tsMs === null || tsMs < sinceMs) continue

      const completion = readNumber(ctxObj.completion_tokens) || 0
      const reasoning = readNumber(ctxObj.reasoning_tokens) || 0
      const cachedRaw = readNumber(ctxObj.cached_prompt_tokens) || 0
      const cached = Math.min(cachedRaw, promptTokens)
      const cacheRead = cached
      const inputNoCache = Math.max(0, promptTokens - cached)
      const output = completion + reasoning
      const totalTokens = promptTokens + output

      const model = pid !== null ? modelByPID[pid] : null
      if (!model) continue

      const cost = estimatedCostDollars(model, inputNoCache, cacheRead, output)

      rows.push({
        createdMs: tsMs,
        cost: cost !== null ? cost : 0,
        model: model,
        tokens: totalTokens,
      })
    }

    return rows
  }

  function aggregateDailyFromRows(rows, nowMs) {
    const cutoffMs = nowMs - 31 * 24 * 60 * 60 * 1000
    const byDay = {}
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      if (row.createdMs < cutoffMs) continue
      const key = dayKeyFromMs(row.createdMs)
      if (!key) continue
      if (!byDay[key]) byDay[key] = { date: key, costUSD: 0, totalTokens: 0 }
      byDay[key].costUSD += row.cost
      byDay[key].totalTokens += row.tokens || 0
    }
    return Object.keys(byDay)
      .sort()
      .map(function (k) {
        return byDay[k]
      })
  }

  function aggregateModelUsageFromRows(rows, nowMs) {
    const todayKey = new Date(nowMs).toISOString().slice(0, 10)
    const yesterdayKey = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const recentKeys = recentUtcDayKeys(nowMs, 7)
    const recentSet = {}
    for (let i = 0; i < recentKeys.length; i += 1) recentSet[recentKeys[i]] = true

    const cutoffMs = nowMs - 31 * 24 * 60 * 60 * 1000
    const byModel = {}

    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r]
      if (row.createdMs < cutoffMs) continue
      const dayKey = dayKeyFromMs(row.createdMs)
      if (!dayKey) continue
      const name = String(row.model || "").trim()
      if (!name) continue

      const cost = row.cost
      const tokens = Number(row.tokens)
      const tokenCount = Number.isFinite(tokens) && tokens > 0 ? tokens : 0

      if (!byModel[name]) {
        byModel[name] = {
          name: name,
          tokens: { Today: 0, Yesterday: 0, "7d": 0, "30d": 0 },
          costUSD: { Today: 0, Yesterday: 0, "7d": 0, "30d": 0 },
        }
      }
      const bucket = byModel[name]
      bucket.tokens["30d"] += tokenCount
      bucket.costUSD["30d"] += cost
      if (recentSet[dayKey]) {
        bucket.tokens["7d"] += tokenCount
        bucket.costUSD["7d"] += cost
      }
      if (dayKey === todayKey) {
        bucket.tokens.Today += tokenCount
        bucket.costUSD.Today += cost
      } else if (dayKey === yesterdayKey) {
        bucket.tokens.Yesterday += tokenCount
        bucket.costUSD.Yesterday += cost
      }
    }

    const models = Object.keys(byModel).map(function (k) {
      return byModel[k]
    })
    let totalTokens30d = 0
    for (let m = 0; m < models.length; m += 1) totalTokens30d += models[m].tokens["30d"]
    for (let n = 0; n < models.length; n += 1) {
      models[n].percent =
        totalTokens30d > 0 ? (models[n].tokens["30d"] / totalTokens30d) * 100 : 0
    }
    models.sort(function (a, b) {
      return b.tokens["30d"] - a.tokens["30d"] || a.name.localeCompare(b.name)
    })
    return { models: models, totalTokens30d: totalTokens30d }
  }

  function percentLabel(value) {
    if (value > 0 && value < 0.1) return "<0.1%"
    const rounded = Math.round(value * 10) / 10
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded)) + "%"
  }

  function fmtModelCost(amount) {
    if (amount < 1000) return "$" + amount.toFixed(2)
    return "$" + Math.round(amount).toLocaleString("en-US")
  }

  function fmtTokens(n) {
    const abs = Math.abs(n)
    const sign = n < 0 ? "-" : ""
    const units = [
      { threshold: 1e9, divisor: 1e9, suffix: "B" },
      { threshold: 1e6, divisor: 1e6, suffix: "M" },
      { threshold: 1e3, divisor: 1e3, suffix: "K" },
    ]
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i]
      if (abs >= unit.threshold) {
        const scaled = abs / unit.divisor
        const formatted =
          scaled >= 10
            ? Math.round(scaled).toString()
            : scaled.toFixed(1).replace(/\.0$/, "")
        return sign + formatted + unit.suffix
      }
    }
    return sign + Math.round(abs).toString()
  }

  function costAndTokensLabel(data, opts) {
    const includeZeroTokens = !!(opts && opts.includeZeroTokens)
    const parts = []
    if (data.costUSD != null) parts.push("$" + data.costUSD.toFixed(2))
    if (data.tokens > 0 || (includeZeroTokens && data.tokens === 0)) {
      parts.push(fmtTokens(data.tokens))
    }
    return parts.join(" · ")
  }

  function usageCostUsd(day) {
    if (!day || typeof day !== "object") return null
    if (day.costUSD != null) {
      const costUSD = Number(day.costUSD)
      if (Number.isFinite(costUSD)) return costUSD
    }
    return null
  }

  function prettifyGrokModelName(rawId) {
    const s = String(rawId || "").trim()
    if (!s) return s
    return s
      .split("-")
      .map(function (part, index) {
        if (part === "grok" && index === 0) return "Grok"
        if (/^\d/.test(part)) return part
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      })
      .join(" ")
  }

  function usageDayLabel(rawDate) {
    const key =
      typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : dayKeyFromMs(rawDate)
    if (!key) return String(rawDate || "").slice(0, 10) || "Usage"
    const month = Number(key.slice(5, 7))
    const day = Number(key.slice(8, 10))
    return month + "/" + day
  }

  function collectUsageChartPoints(daily) {
    const points = []
    for (let i = 0; i < daily.length; i += 1) {
      const day = daily[i]
      const tokens = Number(day && day.totalTokens)
      if (!Number.isFinite(tokens) || tokens <= 0) continue
      const key = day.date
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
        return {
          label: point.label,
          value: point.value,
          valueLabel: point.valueLabel,
        }
      })
  }

  function pushUsageChartLine(lines, ctx, daily) {
    const points = collectUsageChartPoints(daily)
    if (points.length === 0) return
    lines.push(
      ctx.line.barChart({
        label: "Usage Trend",
        points: points,
        note: "Estimated from local logs at API rates.",
        color: "#000000",
      }),
    )
  }

  function pushDayUsageLine(lines, ctx, label, dayEntry) {
    const tokens = Number(dayEntry && dayEntry.totalTokens) || 0
    const cost = usageCostUsd(dayEntry)
    if (tokens > 0) {
      lines.push(
        ctx.line.text({
          label: label,
          value: costAndTokensLabel({ tokens: tokens, costUSD: cost }),
        }),
      )
      return
    }
    lines.push(
      ctx.line.text({
        label: label,
        value: costAndTokensLabel(
          { tokens: 0, costUSD: cost != null ? cost : 0 },
          { includeZeroTokens: true },
        ),
      }),
    )
  }

  function pushModelUsageLines(lines, ctx, modelUsage) {
    const models = modelUsage.models
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i]
      let value = percentLabel(model.percent)
      const segments = []
      if (model.costUSD.Today > 0) segments.push("Today " + fmtModelCost(model.costUSD.Today))
      if (model.costUSD.Yesterday > 0) {
        segments.push("Yesterday " + fmtModelCost(model.costUSD.Yesterday))
      }
      if (model.costUSD["7d"] > 0) segments.push("7d " + fmtModelCost(model.costUSD["7d"]))
      if (model.costUSD["30d"] > 0) segments.push("30d " + fmtModelCost(model.costUSD["30d"]))
      if (segments.length > 0) value += " · " + segments.join(" · ")
      lines.push(
        ctx.line.text({
          label: prettifyGrokModelName(model.name),
          value: value,
        }),
      )
    }
  }

  function readLogText(ctx) {
    const path = logPath(ctx)
    if (!ctx.host.fs.exists(path)) return null
    try {
      return ctx.host.fs.readText(path)
    } catch (e) {
      ctx.host.log.warn("grok log read failed: " + String(e))
      return null
    }
  }

  function appendSpendHistory(ctx, lines, nowMs) {
    const text = readLogText(ctx)
    if (text === null) return

    const sinceMs = nowMs - 31 * 24 * 60 * 60 * 1000
    const rows = buildUsageRowsFromLog(ctx, text, sinceMs)
    if (rows.length === 0) return

    const daily = aggregateDailyFromRows(rows, nowMs)
    if (daily.length === 0) return

    const todayKey = new Date(nowMs).toISOString().slice(0, 10)
    const yesterdayKey = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    let todayEntry = null
    let yesterdayEntry = null
    for (let i = 0; i < daily.length; i += 1) {
      const k = daily[i].date
      if (k === todayKey) todayEntry = daily[i]
      else if (k === yesterdayKey) yesterdayEntry = daily[i]
    }
    pushDayUsageLine(lines, ctx, "Today", todayEntry)
    pushDayUsageLine(lines, ctx, "Yesterday", yesterdayEntry)

    let totalTokens = 0
    let totalCostNanos = 0
    let hasCost = false
    for (let j = 0; j < daily.length; j += 1) {
      const day = daily[j]
      const t = Number(day.totalTokens)
      if (Number.isFinite(t)) totalTokens += t
      const c = usageCostUsd(day)
      if (c != null) {
        totalCostNanos += Math.round(c * 1e9)
        hasCost = true
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
      )
    }

    if (totalTokens > 0) {
      pushUsageChartLine(lines, ctx, daily)
    }

    const modelUsage = aggregateModelUsageFromRows(rows, nowMs)
    if (modelUsage.models.length > 0) {
      pushModelUsageLines(lines, ctx, modelUsage)
    }
  }

  function probe(ctx) {
    const auth = loadAuth(ctx)
    const billingResp = ctx.util.retryOnceOnAuth({
      request: (token) => fetchBillingResponse(ctx, token || auth.token),
      refresh: () => {
        const refreshed = refreshAuth(ctx, auth.auth, auth.entryKey, auth.entry)
        if (refreshed) auth.token = refreshed
        return refreshed
      },
    })
    const data = parseBilling(ctx, billingResp)
    const config = data && data.config
    if (!config || typeof config !== "object") {
      throw "Grok billing response changed."
    }

    const usedUnits = unitsValue(config.used)
    const limitUnits = unitsValue(config.monthlyLimit)
    const onDemandCapUnits = unitsValue(config.onDemandCap) ?? 0
    if (usedUnits === null || limitUnits === null || limitUnits <= 0) {
      throw "Grok billing response changed."
    }

    const resetsAt = ctx.util.toIso(config.billingPeriodEnd)
    if (!resetsAt) {
      throw "Grok billing response changed."
    }

    const usedPercent = clampPercent((usedUnits / limitUnits) * 100)
    const lines = [
      ctx.line.progress({
        label: "Credits used",
        used: usedPercent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt,
      }),
      ctx.line.badge({
        label: "Pay as you go",
        text: onDemandCapUnits > 0 ? String(onDemandCapUnits) + " cap" : "Disabled",
        color: onDemandCapUnits > 0 ? "#22c55e" : "#a3a3a3",
      }),
    ]

    appendSpendHistory(ctx, lines, nowMs(ctx))

    return { plan: fetchPlanName(ctx, auth.token), lines }
  }

  globalThis.__openusage_plugin = {
    id: "grok",
    probe,
    __test: {
      logPath,
      resolveModelRates,
      estimatedCostDollars,
      modelIDFromEvent,
      buildUsageRowsFromLog,
      aggregateDailyFromRows,
      aggregateModelUsageFromRows,
      appendSpendHistory,
      prettifyGrokModelName,
      GROK_PRICING,
    },
  }
})()
