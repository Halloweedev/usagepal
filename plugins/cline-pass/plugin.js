(function () {
  var BASE_URL = "https://api.cline.bot"
  // WorkOS token endpoint for refreshing expired OAuth access tokens.
  // The client ID is Cline's public WorkOS client (visible in the JWT `iss` claim).
  var WORKOS_TOKEN_URL = "https://api.workos.com/user_management/token"
  var WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR"
  var ONE_DAY_MS = 24 * 60 * 60 * 1000
  var PROVIDER_NAME = "ClinePass"
  // Refresh tokens 5 minutes before expiry to avoid racing the server.
  var REFRESH_BUFFER_MS = 5 * 60 * 1000
  // The Cline API returns cost values in micro-USD (1/1,000,000 of a dollar).
  var MICRO_USD = 1000000

  // Cline stores OAuth tokens in ~/.cline/data/settings/providers.json.
  // UsagePal can also save a ClinePass API key for users without the Cline app.
  // An API key can also come from the CLINE_API_KEY environment variable.
  var CONFIG_PATHS = [
    "~/.cline/data/settings/providers.json",
    "~/.config/cline/providers.json",
  ]
  var USAGEPAL_KEY_PATHS = ["~/.config/usagepal/cline-pass.json"]
  var ENV_NAMES = ["CLINE_API_KEY"]

  // Cline stores the access token with a "workos:" prefix tag identifying the
  // auth provider. The API expects just the JWT in the Bearer header, so strip
  // the prefix before sending.
  function stripProviderPrefix(token) {
    if (typeof token !== "string") return token
    var idx = token.indexOf(":")
    if (idx > 0) {
      var prefix = token.slice(0, idx)
      // Only strip known auth-provider tags, not arbitrary colons in API keys.
      if (prefix === "workos" || prefix === "apikey") {
        return token.slice(idx + 1)
      }
    }
    return token
  }

  // Read OAuth credentials from the Cline providers.json config file.
  // Returns { accessToken, refreshToken, expiresAt } or null.
  function oauthFromProvidersJson(text) {
    if (typeof text !== "string") return null
    var trimmed = text.trim()
    if (!trimmed) return null
    try {
      var obj = JSON.parse(trimmed)
      if (!obj || typeof obj !== "object") return null
      var providers = obj.providers
      if (!providers || typeof providers !== "object") return null
      var entry = providers.cline
      if (!entry || typeof entry !== "object") return null
      var settings = entry.settings
      if (!settings || typeof settings !== "object") return null
      var auth = settings.auth
      if (!auth || typeof auth !== "object") return null
      var accessToken = auth.accessToken
      if (typeof accessToken !== "string" || !accessToken.trim()) {
        // Some setups store the key directly under settings.
        var apiKey = settings.apiKey
        if (typeof apiKey === "string" && apiKey.trim()) {
          return { accessToken: apiKey.trim(), refreshToken: null, expiresAt: null }
        }
        return null
      }
      return {
        accessToken: accessToken.trim(),
        refreshToken: typeof auth.refreshToken === "string" ? auth.refreshToken.trim() : null,
        expiresAt: typeof auth.expiresAt === "number" ? auth.expiresAt : null,
      }
    } catch (e) {
      return null
    }
  }

  function loadOauthFromConfig(ctx) {
    for (var i = 0; i < CONFIG_PATHS.length; i++) {
      var path = CONFIG_PATHS[i]
      try {
        if (!ctx.host.fs.exists(path)) continue
        var creds = oauthFromProvidersJson(ctx.host.fs.readText(path))
        if (creds && creds.accessToken) {
          creds.configPath = path
          return creds
        }
      } catch (e) {
        ctx.host.log.warn("cline-pass config read failed for " + path + ": " + String(e))
      }
    }
    return null
  }

  function apiKeyFromConfigText(text) {
    if (typeof text !== "string") return null
    var trimmed = text.trim()
    if (!trimmed) return null
    if (trimmed.indexOf("{") === 0) {
      var obj = null
      try {
        obj = JSON.parse(trimmed)
      } catch (e) {
        return null
      }
      if (!obj || typeof obj !== "object") return null
      var fields = ["apiKey", "api_key", "key"]
      for (var i = 0; i < fields.length; i++) {
        var value = obj[fields[i]]
        if (typeof value === "string" && value.trim()) return value.trim()
      }
      return null
    }
    return trimmed
  }

  function apiKeyFromUsagePalFile(ctx) {
    for (var i = 0; i < USAGEPAL_KEY_PATHS.length; i++) {
      var path = USAGEPAL_KEY_PATHS[i]
      try {
        if (!ctx.host.fs.exists(path)) continue
        var key = apiKeyFromConfigText(ctx.host.fs.readText(path))
        if (key) return key
      } catch (e) {
        ctx.host.log.warn("cline-pass UsagePal key read failed for " + path + ": " + String(e))
      }
    }
    return null
  }

  function tokenFromEnvironment(ctx) {
    for (var i = 0; i < ENV_NAMES.length; i++) {
      var value = ctx.host.env.get(ENV_NAMES[i])
      if (typeof value === "string" && value.trim()) return value.trim()
    }
    return null
  }

  // Refresh an expired OAuth access token via WorkOS.
  // Returns the parsed token response { access_token, refresh_token, expires_in }
  // or null on failure.
  function refreshAccessToken(ctx, refreshToken) {
    if (!refreshToken) return null
    var resp
    try {
      resp = ctx.util.request({
        method: "POST",
        url: WORKOS_TOKEN_URL,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body:
          "grant_type=refresh_token" +
          "&refresh_token=" + encodeURIComponent(refreshToken) +
          "&client_id=" + encodeURIComponent(WORKOS_CLIENT_ID),
        timeoutMs: 15000,
      })
    } catch (e) {
      ctx.host.log.warn("cline-pass token refresh request failed: " + String(e))
      return null
    }
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("cline-pass token refresh rejected (HTTP " + String(resp.status) + ")")
      return null
    }
    var parsed = ctx.util.tryParseJson(resp.bodyText)
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.access_token !== "string" || !parsed.access_token.trim()) return null
    return parsed
  }

  // Persist a refreshed access token back to the config file so Cline's own
  // extension picks it up too. Best-effort — if the write fails, the in-memory
  // token still works for this probe cycle.
  function saveRefreshedToken(ctx, configPath, tokenResponse) {
    if (!configPath) return
    try {
      var raw = ctx.host.fs.readText(configPath)
      var obj = JSON.parse(raw)
      var authObj = obj.providers.cline.settings.auth
      authObj.accessToken = "workos:" + tokenResponse.access_token
      if (typeof tokenResponse.expires_in === "number") {
        authObj.expiresAt = Date.now() + tokenResponse.expires_in * 1000
      }
      if (typeof tokenResponse.refresh_token === "string") {
        authObj.refreshToken = tokenResponse.refresh_token
      }
      ctx.host.fs.writeText(configPath, JSON.stringify(obj, null, 2))
    } catch (e) {
      ctx.host.log.warn("cline-pass could not persist refreshed token: " + String(e))
    }
  }

  // Resolve a usable bearer token. Tries (1) OAuth from Cline config, refreshing
  // if expired, then (2) UsagePal-saved API key, then (3) CLINE_API_KEY env var.
  // Returns the raw JWT/key string (prefix already stripped) or throws if no auth is available.
  function resolveToken(ctx) {
    var oauth = loadOauthFromConfig(ctx)
    if (oauth && oauth.accessToken) {
      var token = stripProviderPrefix(oauth.accessToken)
      // Check expiry and refresh if needed.
      var nowMs = Date.now()
      if (oauth.expiresAt && oauth.expiresAt - REFRESH_BUFFER_MS <= nowMs) {
        ctx.host.log.info("cline-pass access token expired, refreshing via WorkOS")
        var refreshed = refreshAccessToken(ctx, oauth.refreshToken)
        if (refreshed) {
          saveRefreshedToken(ctx, oauth.configPath, refreshed)
          return refreshed.access_token
        }
        // Refresh failed — fall through to env var if one is available,
        // rather than sending a known-expired token that will 401.
        ctx.host.log.warn("cline-pass token refresh failed, falling back to env var")
        var envKey = tokenFromEnvironment(ctx)
        if (envKey) return envKey
        // No env var either — try the stale token as a last resort.
        ctx.host.log.warn("cline-pass no env var either, trying stale token")
      }
      return token
    }

    var savedKey = apiKeyFromUsagePalFile(ctx)
    if (savedKey) return savedKey

    var envKey = tokenFromEnvironment(ctx)
    if (envKey) return envKey

    throw "No Cline auth token found. Sign in to Cline, save a ClinePass API key in UsagePal, or set CLINE_API_KEY."
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }

  function parseNumeric(value) {
    var n = num(value)
    if (n !== null) return n
    if (typeof value !== "string") return null
    var trimmed = value.trim()
    if (!trimmed) return null
    var cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "")
    n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }

  // Cline stores usage money in micro-USD (same as balance/creditsUsed in the Cline app).
  function microToUsd(micro) {
    if (micro === null || micro < 0) return null
    if (micro === 0) return 0
    return micro / MICRO_USD
  }

  // Extract per-transaction spend in USD from Cline usage API shapes.
  function transactionCostUsd(tx) {
    if (!tx || typeof tx !== "object") return null

    var directFields = ["costUsd", "costUSD", "cost_usd", "creditsUsed"]
    for (var i = 0; i < directFields.length; i += 1) {
      var raw = parseNumeric(tx[directFields[i]])
      if (raw !== null) return microToUsd(raw)
    }

    var cost = tx.cost
    if (cost && typeof cost === "object") {
      var nestedFields = ["usd", "amount", "value", "microUsd", "micro_usd"]
      for (var j = 0; j < nestedFields.length; j += 1) {
        var nestedRaw = parseNumeric(cost[nestedFields[j]])
        if (nestedRaw !== null) return microToUsd(nestedRaw)
      }
    }

    return null
  }

  function formatDollars(amount) {
    return "$" + (Math.round(amount * 100) / 100).toFixed(2)
  }

  function apiGet(ctx, path, token) {
    var resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: BASE_URL + path,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
        },
        timeoutMs: 15000,
      })
    } catch (e) {
      ctx.host.log.error("cline-pass request exception for " + path + ": " + String(e))
      throw "Couldn't reach the Cline API. Check your connection."
    }
    if (ctx.util.isAuthStatus(resp.status)) {
      throw "Cline auth token invalid. Sign in again in Cline or check your API key at app.cline.bot."
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Cline API request failed (HTTP " + String(resp.status) + ")."
    }
    var parsed = ctx.util.tryParseJson(resp.bodyText)
    if (!parsed) {
      // The API may wrap responses in an envelope: { success, data, error }.
      throw "Cline API returned an unexpected response."
    }
    // Unwrap envelope if present.
    if (typeof parsed === "object" && parsed !== null) {
      if (typeof parsed.success === "boolean") {
        if (!parsed.success) {
          throw parsed.error || "Cline API request failed."
        }
        return parsed.data
      }
    }
    return parsed
  }

  // Fetch the current user's ID (needed for balance and usages endpoints).
  function fetchUserId(ctx, token) {
    var me = apiGet(ctx, "/api/v1/users/me", token)
    if (!me || typeof me !== "object") return null
    var id = me.id
    if (typeof id === "string" && id.trim()) return id.trim()
    return null
  }

  // Fetch the prepaid balance. The API returns this in micro-USD.
  function fetchBalance(ctx, userId, token) {
    var data = apiGet(ctx, "/api/v1/users/" + encodeURIComponent(userId) + "/balance", token)
    if (!data || typeof data !== "object") return null
    var balance = num(data.balance)
    if (balance === null) return null
    return balance // micro-USD
  }

  // Fetch the subscription plan (ClinePass subscribers).
  function fetchPlan(ctx, token) {
    try {
      return apiGet(ctx, "/api/v1/users/me/plan", token)
    } catch (e) {
      ctx.host.log.warn("cline-pass plan fetch failed: " + String(e))
      return null
    }
  }

  // Fetch pre-computed usage limits. The Cline dashboard calls this same
  // endpoint to render its 5-hour / weekly / monthly progress bars.
  // Returns { limits: [{ type, percentUsed, resetsAt }] } or null.
  function fetchUsageLimits(ctx, token) {
    try {
      return apiGet(ctx, "/api/v1/users/me/plan/usage-limits", token)
    } catch (e) {
      ctx.host.log.warn("cline-pass usage-limits fetch failed: " + String(e))
      return null
    }
  }

  // Fetch usage transactions for share-graph spend history.
  function fetchUsages(ctx, userId, token) {
    try {
      return apiGet(ctx, "/api/v1/users/" + encodeURIComponent(userId) + "/usages", token)
    } catch (e) {
      ctx.host.log.warn("cline-pass usages fetch failed: " + String(e))
      return null
    }
  }

  function readNowMs(ctx) {
    return ctx.util.parseDateMs(ctx.nowIso) || Date.now()
  }

  function dayKeyFromMs(ms) {
    if (!Number.isFinite(ms)) return null
    return new Date(ms).toISOString().slice(0, 10)
  }

  function recentUtcDayKeys(nowMs, count) {
    var keys = []
    for (var i = 0; i < count; i += 1) {
      keys.push(new Date(nowMs - i * ONE_DAY_MS).toISOString().slice(0, 10))
    }
    return keys
  }

  function percentLabel(value) {
    if (value > 0 && value < 0.1) return "<0.1%"
    var rounded = Math.round(value * 10) / 10
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded)) + "%"
  }

  function fmtModelCost(amount) {
    if (amount < 1000) return "$" + amount.toFixed(2)
    return "$" + Math.round(amount).toLocaleString("en-US")
  }

  function fmtTokens(n) {
    var abs = Math.abs(n)
    var sign = n < 0 ? "-" : ""
    var units = [
      { threshold: 1e9, divisor: 1e9, suffix: "B" },
      { threshold: 1e6, divisor: 1e6, suffix: "M" },
      { threshold: 1e3, divisor: 1e3, suffix: "K" },
    ]
    for (var i = 0; i < units.length; i += 1) {
      var unit = units[i]
      if (abs >= unit.threshold) {
        var scaled = abs / unit.divisor
        var formatted =
          scaled >= 10
            ? Math.round(scaled).toString()
            : scaled.toFixed(1).replace(/\.0$/, "")
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

  function prettifyModelName(providerName, modelName) {
    var provider = String(providerName || "").trim()
    var model = String(modelName || "").trim()
    if (!model) return ""
    var raw = model
    if (provider && model.indexOf("/") < 0) {
      raw = provider + "/" + model
    }
    var slug = raw.split("/").pop() || raw
    var parts = slug.split("-")
    var out = []
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i]
      if (/^\d+$/.test(part) && i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
        out.push(part + "." + parts[i + 1])
        i += 1
        continue
      }
      if (/^\d/.test(part)) {
        out.push(part)
        continue
      }
      if (part.toLowerCase() === "glm") {
        out.push("GLM")
        continue
      }
      if (part.toLowerCase() === "gpt") {
        out.push("GPT")
        continue
      }
      out.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    }
    return out.join(" ")
  }

  function modelKeyFromTransaction(tx) {
    if (!tx || typeof tx !== "object") return PROVIDER_NAME
    var provider = typeof tx.aiInferenceProviderName === "string" ? tx.aiInferenceProviderName.trim() : ""
    var model = typeof tx.aiModelName === "string" ? tx.aiModelName.trim() : ""
    if (!model) return PROVIDER_NAME
    return provider ? provider + "/" + model : model
  }

  function normalizeUsageTransactions(ctx, raw) {
    if (!raw || typeof raw !== "object") return []
    var items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw) ? raw : []
    var rows = []
    for (var i = 0; i < items.length; i += 1) {
      var tx = items[i]
      if (!tx || typeof tx !== "object") continue
      var createdMs = ctx.util.parseDateMs(tx.createdAt)
      if (createdMs === null || createdMs <= 0) continue
      var cost = transactionCostUsd(tx)
      if (cost === null || cost < 0) continue
      var tokens = num(tx.totalTokens)
      if (tokens === null || tokens < 0) tokens = 0
      if (cost <= 0 && tokens <= 0) continue
      rows.push({
        createdMs: createdMs,
        cost: cost,
        modelKey: modelKeyFromTransaction(tx),
        providerName: typeof tx.aiInferenceProviderName === "string" ? tx.aiInferenceProviderName.trim() : "",
        modelName: typeof tx.aiModelName === "string" ? tx.aiModelName.trim() : "",
        tokens: Math.round(tokens),
      })
    }
    return rows
  }

  function aggregateDailyFromRows(rows, nowMs) {
    var cutoffMs = nowMs - 31 * ONE_DAY_MS
    var byDay = {}
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      if (row.createdMs < cutoffMs) continue
      var key = dayKeyFromMs(row.createdMs)
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
    var todayKey = new Date(nowMs).toISOString().slice(0, 10)
    var yesterdayKey = new Date(nowMs - ONE_DAY_MS).toISOString().slice(0, 10)
    var recentKeys = recentUtcDayKeys(nowMs, 7)
    var recentSet = {}
    for (var i = 0; i < recentKeys.length; i += 1) recentSet[recentKeys[i]] = true

    var cutoffMs = nowMs - 31 * ONE_DAY_MS
    var hasModelIds = rows.some(function (row) {
      return typeof row.modelKey === "string" && row.modelKey.trim().length > 0 && row.modelKey !== PROVIDER_NAME
    })

    var byModel = {}
    for (var r = 0; r < rows.length; r += 1) {
      var row = rows[r]
      if (row.createdMs < cutoffMs) continue
      var dayKey = dayKeyFromMs(row.createdMs)
      if (!dayKey) continue

      var name = hasModelIds ? row.modelKey : PROVIDER_NAME
      if (!name) continue

      var cost = row.cost
      var tokenCount = row.tokens > 0 ? row.tokens : 0

      if (!byModel[name]) {
        byModel[name] = {
          name: name,
          providerName: row.providerName,
          modelName: row.modelName,
          tokens: { Today: 0, Yesterday: 0, "7d": 0, "30d": 0 },
          costUSD: { Today: 0, Yesterday: 0, "7d": 0, "30d": 0 },
        }
      }
      var bucket = byModel[name]
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

    var models = Object.keys(byModel).map(function (k) {
      return byModel[k]
    })
    var totalTokens30d = 0
    for (var m = 0; m < models.length; m += 1) {
      totalTokens30d += models[m].tokens["30d"]
    }
    for (var n = 0; n < models.length; n += 1) {
      models[n].percent =
        totalTokens30d > 0
          ? (models[n].tokens["30d"] / totalTokens30d) * 100
          : hasModelIds
            ? 0
            : 100
    }
    models.sort(function (a, b) {
      return b.tokens["30d"] - a.tokens["30d"] || a.name.localeCompare(b.name)
    })
    return { models: models, totalTokens30d: totalTokens30d, hasModelIds: hasModelIds }
  }

  function usageDayLabel(rawDate) {
    var key =
      typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : dayKeyFromMs(rawDate)
    if (!key) return String(rawDate || "").slice(0, 10) || "Usage"
    var month = Number(key.slice(5, 7))
    var day = Number(key.slice(8, 10))
    return month + "/" + day
  }

  function collectUsageChartPoints(daily) {
    var points = []
    for (var i = 0; i < daily.length; i += 1) {
      var day = daily[i]
      var tokens = Number(day && day.totalTokens)
      if (!Number.isFinite(tokens) || tokens <= 0) continue
      var key = day.date
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
    var points = collectUsageChartPoints(daily)
    if (points.length === 0) return
    lines.push(
      ctx.line.barChart({
        label: "Usage Trend",
        points: points,
        note: "From Cline usage history.",
        color: "#000000",
      }),
    )
  }

  function pushDayUsageLine(lines, ctx, label, dayEntry) {
    var tokens = Number(dayEntry && dayEntry.totalTokens) || 0
    var cost = usageCostUsd(dayEntry)
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
    var models = modelUsage.models
    for (var i = 0; i < models.length; i += 1) {
      var model = models[i]
      var value = percentLabel(model.percent)
      var segments = []
      if (model.costUSD.Today > 0) {
        segments.push("Today " + fmtModelCost(model.costUSD.Today))
      }
      if (model.costUSD.Yesterday > 0) {
        segments.push("Yesterday " + fmtModelCost(model.costUSD.Yesterday))
      }
      if (model.costUSD["7d"] > 0) {
        segments.push("7d " + fmtModelCost(model.costUSD["7d"]))
      }
      if (model.costUSD["30d"] > 0) {
        segments.push("30d " + fmtModelCost(model.costUSD["30d"]))
      }
      if (segments.length > 0) value += " · " + segments.join(" · ")
      var label = modelUsage.hasModelIds
        ? prettifyModelName(model.providerName, model.modelName)
        : model.name
      lines.push(
        ctx.line.text({
          label: label,
          value: value,
        }),
      )
    }
  }

  function appendSpendHistory(ctx, lines, rows, nowMs) {
    if (!Array.isArray(rows) || rows.length === 0) return

    var daily = aggregateDailyFromRows(rows, nowMs)
    if (daily.length === 0) return

    var todayKey = new Date(nowMs).toISOString().slice(0, 10)
    var yesterdayKey = new Date(nowMs - ONE_DAY_MS).toISOString().slice(0, 10)

    var todayEntry = null
    var yesterdayEntry = null
    for (var i = 0; i < daily.length; i += 1) {
      var k = daily[i].date
      if (k === todayKey) todayEntry = daily[i]
      else if (k === yesterdayKey) yesterdayEntry = daily[i]
    }
    pushDayUsageLine(lines, ctx, "Today", todayEntry)
    pushDayUsageLine(lines, ctx, "Yesterday", yesterdayEntry)

    var totalTokens = 0
    var totalCostNanos = 0
    var hasCost = false
    for (var j = 0; j < daily.length; j += 1) {
      var day = daily[j]
      var t = Number(day.totalTokens)
      if (Number.isFinite(t)) totalTokens += t
      var c = usageCostUsd(day)
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

    var modelUsage = aggregateModelUsageFromRows(rows, nowMs)
    if (modelUsage.models.length > 0) {
      pushModelUsageLines(lines, ctx, modelUsage)
    }
  }

  function derivePlanLabel(plan) {
    if (!plan || typeof plan !== "object") return null
    var p = plan.plan
    if (p && typeof p === "object") {
      var name = p.displayName || p.name
      if (typeof name === "string" && name.trim()) return name.trim()
    }
    // If there's a subscription ID, it's a paid plan.
    if (typeof plan.subscriptionId === "string" && plan.subscriptionId.trim()) {
      return "ClinePass"
    }
    return null
  }

  // Find a limit by type from the usage-limits response.
  function findLimit(limits, type) {
    if (!Array.isArray(limits)) return null
    for (var i = 0; i < limits.length; i++) {
      var l = limits[i]
      if (l && l.type === type) return l
    }
    return null
  }

  function probe(ctx) {
    var token = resolveToken(ctx)

    // Fetch user ID first (needed for balance and usages).
    var userId = fetchUserId(ctx, token)
    if (!userId) {
      throw "Couldn't determine your Cline user ID."
    }

    // Fetch balance (best-effort).
    var balanceMicro = null
    try {
      balanceMicro = fetchBalance(ctx, userId, token)
    } catch (e) {
      ctx.host.log.warn("cline-pass balance fetch failed: " + String(e))
    }

    // Fetch plan (for display name).
    var plan = fetchPlan(ctx, token)
    var planLabel = derivePlanLabel(plan)

    // Fetch pre-computed usage limits — the same endpoint the Cline dashboard
    // uses to render its 5-hour / weekly / monthly progress bars.
    var limitsData = fetchUsageLimits(ctx, token)
    var limits = limitsData ? limitsData.limits : null

    var lines = []

    // Session (5-hour rolling window): percentage from the usage-limits API.
    var fiveHourLimit = findLimit(limits, "five_hour")
    if (fiveHourLimit) {
      lines.push(ctx.line.progress({
        label: "Session",
        used: Math.min(100, Math.max(0, num(fiveHourLimit.percentUsed) || 0)),
        limit: 100,
        format: { kind: "percent" },
        resetsAt: fiveHourLimit.resetsAt,
      }))
    } else {
      lines.push(ctx.line.text({
        label: "Session",
        value: "—",
      }))
    }

    // Weekly (7-day rolling window): percentage from the usage-limits API.
    var weeklyLimit = findLimit(limits, "weekly")
    if (weeklyLimit) {
      lines.push(ctx.line.progress({
        label: "Weekly",
        used: Math.min(100, Math.max(0, num(weeklyLimit.percentUsed) || 0)),
        limit: 100,
        format: { kind: "percent" },
        resetsAt: weeklyLimit.resetsAt,
      }))
    } else {
      lines.push(ctx.line.text({
        label: "Weekly",
        value: "—",
      }))
    }

    // Monthly (billing period): percentage from the usage-limits API.
    var monthlyLimit = findLimit(limits, "monthly")
    if (monthlyLimit) {
      lines.push(ctx.line.progress({
        label: "Monthly",
        used: Math.min(100, Math.max(0, num(monthlyLimit.percentUsed) || 0)),
        limit: 100,
        format: { kind: "percent" },
        resetsAt: monthlyLimit.resetsAt,
      }))
    }

    // Balance: prepaid credits remaining.
    if (balanceMicro !== null) {
      lines.push(ctx.line.text({
        label: "Balance",
        value: formatDollars(Math.max(0, microToUsd(balanceMicro))),
      }))
    }

    // Share-graph spend history from usage transactions (best-effort).
    try {
      var usages = fetchUsages(ctx, userId, token)
      if (usages) {
        var nowMs = readNowMs(ctx)
        var usageRows = normalizeUsageTransactions(ctx, usages)
        appendSpendHistory(ctx, lines, usageRows, nowMs)
      }
    } catch (e) {
      ctx.host.log.warn("cline-pass share-graph history failed: " + String(e))
    }

    if (lines.length === 0) {
      lines.push(ctx.line.badge({ label: "Balance", text: "No usage data", color: "#a3a3a3" }))
    }

    return { plan: planLabel, lines: lines }
  }

  globalThis.__openusage_plugin = {
    id: "cline-pass",
    probe: probe,
    __test: {
      normalizeUsageTransactions,
      aggregateDailyFromRows,
      aggregateModelUsageFromRows,
      appendSpendHistory,
      prettifyModelName,
      modelKeyFromTransaction,
      transactionCostUsd,
      microToUsd,
    },
  }
})()
