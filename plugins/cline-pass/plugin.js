(function () {
  var BASE_URL = "https://api.cline.bot"
  // WorkOS token endpoint for refreshing expired OAuth access tokens.
  // The client ID is Cline's public WorkOS client (visible in the JWT `iss` claim).
  var WORKOS_TOKEN_URL = "https://api.workos.com/user_management/token"
  var WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR"
  var ONE_DAY_MS = 24 * 60 * 60 * 1000
  // Refresh tokens 5 minutes before expiry to avoid racing the server.
  var REFRESH_BUFFER_MS = 5 * 60 * 1000
  // The Cline API returns cost values in micro-USD (1/1,000,000 of a dollar).
  var MICRO_USD = 1000000

  // Cline stores OAuth tokens in ~/.cline/data/settings/providers.json.
  // An API key can also come from the CLINE_API_KEY environment variable.
  var CONFIG_PATHS = [
    "~/.cline/data/settings/providers.json",
    "~/.config/cline/providers.json",
  ]
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

  // Resolve a usable bearer token. Tries (1) OAuth from config file, refreshing
  // if expired, then (2) CLINE_API_KEY env var. Returns the raw JWT/key string
  // (prefix already stripped) or throws if no auth is available.
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

    var envKey = tokenFromEnvironment(ctx)
    if (envKey) return envKey

    throw "No Cline auth token found. Sign in to Cline or set CLINE_API_KEY."
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
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

  // Convert micro-USD to dollars.
  function microToUsd(micro) {
    return micro / MICRO_USD
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

    if (lines.length === 0) {
      lines.push(ctx.line.badge({ label: "Balance", text: "No usage data", color: "#a3a3a3" }))
    }

    return { plan: planLabel, lines: lines }
  }

  globalThis.__openusage_plugin = { id: "cline-pass", probe: probe }
})()
