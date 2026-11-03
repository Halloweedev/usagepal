(function () {
  const AUTH_FILE = "auth.json"
  const CONFIG_AUTH_PATHS = ["~/.config/codex", "~/.codex"]
  const KEYCHAIN_SERVICE = "Codex Auth"
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
  const REFRESH_URL = "https://auth.openai.com/oauth/token"
  const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
  const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
  const CREDIT_USD_RATE = 0.04
  const REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000
  const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
  const ERR_NOT_LOGGED_IN = "Not logged in. Run `codex` to authenticate."
  const ERR_SESSION_EXPIRED = "Session expired. Run `codex` to log in again."
  const ERR_TOKEN_CONFLICT = "Token conflict. Run `codex` to log in again."
  const ERR_TOKEN_REVOKED = "Token revoked. Run `codex` to log in again."
  const ERR_TOKEN_EXPIRED = "Token expired. Run `codex` to log in again."
  const ERR_USAGE_API_KEY = "Usage not available for API key."
  const ERR_USAGE_CONNECTION = "Usage request failed. Check your connection."
  const ERR_USAGE_AFTER_REFRESH = "Usage request failed after refresh. Try again."

  function joinPath(base, leaf) {
    return base.replace(/[\\/]+$/, "") + "/" + leaf
  }

  function readCodexHome(ctx) {
    if (!ctx.host.env || typeof ctx.host.env.get !== "function") {
      return null
    }

    try {
      const value = ctx.host.env.get("CODEX_HOME")
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.warn("CODEX_HOME read failed: " + String(e))
      return null
    }
  }

  function decodeHexUtf8(hex) {
    try {
      const bytes = []
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16))
      }

      if (typeof TextDecoder !== "undefined") {
        try {
          return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes))
        } catch {}
      }

      let escaped = ""
      for (const b of bytes) {
        const h = b.toString(16)
        escaped += "%" + (h.length === 1 ? "0" + h : h)
      }
      return decodeURIComponent(escaped)
    } catch {
      return null
    }
  }

  function tryParseAuthJson(ctx, text) {
    if (!text) return null
    const parsed = ctx.util.tryParseJson(text)
    if (parsed) return parsed

    // Some keychain payloads can be returned as hex-encoded UTF-8 bytes.
    let hex = String(text).trim()
    if (hex.startsWith("0x") || hex.startsWith("0X")) hex = hex.slice(2)
    if (!hex || hex.length % 2 !== 0) return null
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null

    const decoded = decodeHexUtf8(hex)
    if (!decoded) return null
    return ctx.util.tryParseJson(decoded)
  }

  function resolveAuthPaths(ctx) {
    const codexHome = readCodexHome(ctx)

    // If CODEX_HOME is set, use it
    if (codexHome) {
      return [joinPath(codexHome, AUTH_FILE)]
    }

    return CONFIG_AUTH_PATHS.map((basePath) => joinPath(basePath, AUTH_FILE))
  }

  function hasTokenLikeAuth(auth) {
    if (!auth || typeof auth !== "object") return false
    if (auth.tokens && auth.tokens.access_token) return true
    if (auth.OPENAI_API_KEY) return true
    return false
  }

  function hasAccessTokenAuth(auth) {
    return !!(auth && auth.tokens && auth.tokens.access_token)
  }

  // Registered (multi-account) probes run with USAGEPAL_MANAGED_ACCOUNT=1 and
  // CODEX_HOME pointed at their own profile dir. The macOS keychain entry is
  // machine-wide — it holds the local CLI login's credentials — so a managed
  // probe must never fall back to it: a stale profile would silently render
  // another account's usage instead of its own auth error.
  function isManagedAccount(ctx) {
    return readEnvString(ctx, "USAGEPAL_MANAGED_ACCOUNT") === "1"
  }

  function isAuthFallbackError(e) {
    if (typeof e !== "string") return false
    return (
      e === ERR_SESSION_EXPIRED ||
      e === ERR_TOKEN_CONFLICT ||
      e === ERR_TOKEN_REVOKED ||
      e === ERR_TOKEN_EXPIRED
    )
  }

  function loadAuthFromKeychain(ctx) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }

    try {
      const value = ctx.host.keychain.readGenericPassword(KEYCHAIN_SERVICE)
      if (!value) return null
      const auth = tryParseAuthJson(ctx, value)
      if (!hasTokenLikeAuth(auth)) {
        ctx.host.log.warn("keychain has data but no codex auth payload")
        return null
      }
      ctx.host.log.info("auth loaded from keychain: " + KEYCHAIN_SERVICE)
      return { auth, authPath: null, source: "keychain" }
    } catch (e) {
      ctx.host.log.info("keychain read failed (may not exist): " + String(e))
      return null
    }
  }

  function saveAuth(ctx, authState) {
    const auth = authState && authState.auth ? authState.auth : null
    if (!auth) return false

    if (authState.source === "file" && authState.authPath) {
      ctx.host.fs.writeText(authState.authPath, JSON.stringify(auth, null, 2))
      return true
    }

    if (authState.source === "keychain") {
      if (!ctx.host.keychain || typeof ctx.host.keychain.writeGenericPassword !== "function") {
        ctx.host.log.warn("keychain write unsupported in this host")
        return false
      }
      // Use compact JSON to avoid newline-induced keychain encoding issues.
      ctx.host.keychain.writeGenericPassword(KEYCHAIN_SERVICE, JSON.stringify(auth))
      return true
    }

    return false
  }

  function loadFileAuthCandidates(ctx) {
    const authPaths = resolveAuthPaths(ctx)
    const candidates = []
    const missingPaths = []
    for (const authPath of authPaths) {
      if (!ctx.host.fs.exists(authPath)) {
        missingPaths.push(authPath)
        continue
      }
      try {
        const text = ctx.host.fs.readText(authPath)
        const auth = tryParseAuthJson(ctx, text)
        if (!hasTokenLikeAuth(auth)) {
          ctx.host.log.warn("auth file exists but no valid codex auth payload: " + authPath)
          continue
        }
        ctx.host.log.info("auth loaded from file: " + authPath)
        candidates.push({ auth, authPath, source: "file" })
      } catch (e) {
        ctx.host.log.warn("auth file read failed: " + authPath + ": " + String(e))
      }
    }

    return { candidates, missingPaths }
  }

  function needsRefresh(ctx, auth, nowMs) {
    const accessToken = auth.tokens && auth.tokens.access_token
    if (accessToken && ctx.jwt && typeof ctx.jwt.decodePayload === "function") {
      const payload = ctx.jwt.decodePayload(accessToken)
      const expiresAtSeconds = payload && payload.exp
      if (typeof expiresAtSeconds === "number" && Number.isFinite(expiresAtSeconds)) {
        const expiresAtMs = expiresAtSeconds * 1000
        return expiresAtMs <= nowMs + ACCESS_TOKEN_REFRESH_WINDOW_MS
      }
    }

    if (!auth.last_refresh) return false
    const lastMs = ctx.util.parseDateMs(auth.last_refresh)
    if (lastMs === null) return false
    return nowMs - lastMs > REFRESH_AGE_MS
  }

  function reloadAuthState(ctx, authState) {
    let reloaded = null
    if (authState.source === "file" && authState.authPath) {
      try {
        const auth = tryParseAuthJson(ctx, ctx.host.fs.readText(authState.authPath))
        if (hasTokenLikeAuth(auth)) {
          reloaded = { auth, authPath: authState.authPath, source: "file" }
        }
      } catch (e) {
        ctx.host.log.warn("auth reload failed for file " + authState.authPath + ": " + String(e))
      }
    } else if (authState.source === "keychain") {
      reloaded = loadAuthFromKeychain(ctx)
    }

    if (!reloaded) return { status: "unchanged", authState }
    if (!hasAccessTokenAuth(reloaded.auth)) {
      return { status: "error", error: ERR_TOKEN_CONFLICT }
    }

    const expectedAccountId = authState.auth.tokens && authState.auth.tokens.account_id
    const reloadedAccountId = reloaded.auth.tokens && reloaded.auth.tokens.account_id
    if (expectedAccountId && reloadedAccountId !== expectedAccountId) {
      return { status: "error", error: ERR_TOKEN_CONFLICT }
    }

    if (JSON.stringify(reloaded.auth) !== JSON.stringify(authState.auth)) {
      ctx.host.log.info("auth changed during guarded reload, using updated credentials")
      return { status: "changed", authState: reloaded }
    }
    return { status: "unchanged", authState }
  }

  function refreshToken(ctx, authState) {
    const auth = authState.auth
    if (!auth.tokens || !auth.tokens.refresh_token) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting token refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "grant_type=refresh_token" +
          "&client_id=" + encodeURIComponent(CLIENT_ID) +
          "&refresh_token=" + encodeURIComponent(auth.tokens.refresh_token),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401) {
        let code = null
        const body = ctx.util.tryParseJson(resp.bodyText)
        if (body) {
          code = body.error?.code || body.error || body.code
        }
        ctx.host.log.error("refresh failed: status=" + resp.status + " code=" + String(code))
        if (code === "refresh_token_expired") {
          throw ERR_SESSION_EXPIRED
        }
        if (code === "refresh_token_reused") {
          throw ERR_TOKEN_CONFLICT
        }
        if (code === "refresh_token_invalidated") {
          throw ERR_TOKEN_REVOKED
        }
        throw ERR_TOKEN_EXPIRED
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
      const newAccessToken = body.access_token
      if (!newAccessToken) {
        ctx.host.log.warn("refresh response missing access_token")
        return null
      }

      auth.tokens.access_token = newAccessToken
      if (body.refresh_token) auth.tokens.refresh_token = body.refresh_token
      if (body.id_token) auth.tokens.id_token = body.id_token
      auth.last_refresh = new Date().toISOString()

      try {
        const saved = saveAuth(ctx, authState)
        if (saved) {
          ctx.host.log.info("refresh succeeded, auth persisted to " + authState.source)
        } else {
          ctx.host.log.warn("refresh succeeded but auth persistence was not possible")
        }
      } catch (e) {
        ctx.host.log.warn("refresh succeeded but failed to save auth: " + String(e))
      }

      return newAccessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("refresh exception: " + String(e))
      return null
    }
  }

  function chatgptHeaders(accessToken, accountId) {
    const headers = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
      "User-Agent": "UsagePal",
    }
    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId
    }
    return headers
  }

  function fetchUsage(ctx, accessToken, accountId) {
    return ctx.util.request({
      method: "GET",
      url: USAGE_URL,
      headers: chatgptHeaders(accessToken, accountId),
      timeoutMs: 10000,
    })
  }

  function fetchRateLimitResetCredits(ctx, accessToken, accountId) {
    return ctx.util.request({
      method: "GET",
      url: RESET_CREDITS_URL,
      headers: chatgptHeaders(accessToken, accountId),
      timeoutMs: 10000,
    })
  }

  function parseRateLimitResetCredits(data) {
    if (!data || typeof data !== "object") return null

    const credits = Array.isArray(data.credits) ? data.credits : []
    const availableCredits = []
    for (let i = 0; i < credits.length; i++) {
      const credit = credits[i]
      if (!credit || typeof credit !== "object") continue
      const status = typeof credit.status === "string" ? credit.status : "available"
      if (status !== "available") continue
      availableCredits.push(credit)
    }

    const reported = data.available_count == null ? null : readNumber(data.available_count)
    const availableCount = reported !== null
      ? Math.max(0, Math.floor(reported))
      : availableCredits.length

    // Only treat an explicit available_count or a credits list as a valid payload.
    if (reported === null && !Array.isArray(data.credits)) return null

    const expiryIsos = []
    for (let i = 0; i < availableCredits.length; i++) {
      const expiresAt = availableCredits[i].expires_at
      if (typeof expiresAt === "string" && expiresAt) {
        expiryIsos.push(expiresAt)
      }
    }
    expiryIsos.sort(function (a, b) {
      return new Date(a).getTime() - new Date(b).getTime()
    })

    return { availableCount: availableCount, expiryIsos: expiryIsos }
  }

  function loadRateLimitResetCredits(ctx, accessToken, accountId, usageData) {
    try {
      const resp = fetchRateLimitResetCredits(ctx, accessToken, accountId)
      if (resp.status >= 200 && resp.status < 300) {
        const data = ctx.util.tryParseJson(resp.bodyText)
        const parsed = parseRateLimitResetCredits(data)
        if (parsed) return parsed
        ctx.host.log.warn("rate limit reset credits response invalid")
      } else {
        ctx.host.log.warn("rate limit reset credits returned status=" + resp.status)
      }
    } catch (e) {
      ctx.host.log.warn("rate limit reset credits request failed: " + String(e))
    }

    const nestedRaw =
      usageData &&
      usageData.rate_limit_reset_credits &&
      typeof usageData.rate_limit_reset_credits === "object"
        ? usageData.rate_limit_reset_credits.available_count
        : null
    const nested = nestedRaw == null ? null : readNumber(nestedRaw)
    if (nested !== null && nested >= 0) {
      return { availableCount: Math.floor(nested), expiryIsos: [] }
    }
    return null
  }

  function readPercent(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function readNumber(value) {
    if (value == null || (typeof value === "string" && !value.trim())) return null
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function readMonthlyCreditLimit(data) {
    const individualLimit = data?.spend_control?.individual_limit
    if (!individualLimit || typeof individualLimit !== "object") return null

    const limit = readNumber(individualLimit.limit)
    const used = readNumber(individualLimit.used)
    if (limit === null || limit <= 0 || used === null || used < 0) return null

    return { limit: Math.round(limit), used: Math.round(used), window: individualLimit }
  }

  function readCreditsRemaining(resp, data) {
    const credits = data && data.credits && typeof data.credits === "object" ? data.credits : null
    if (credits) {
      const bodyBalance = readNumber(credits.balance)
      if (bodyBalance !== null) return bodyBalance
      if (credits.has_credits === false) return 0
    }

    return readNumber(resp.headers["x-codex-credits-balance"])
  }

  function formatCodexPlan(ctx, planType) {
    const rawPlan = typeof planType === "string" ? planType.trim() : ""
    if (!rawPlan) return null
    if (rawPlan.toLowerCase() === "prolite") return "Pro 5x"
    if (rawPlan.toLowerCase() === "pro") return "Pro 20x"
    return ctx.fmt.planLabel(rawPlan) || null
  }

  function getResetsAtIso(ctx, nowSec, window) {
    if (!window) return null
    if (typeof window.reset_at === "number") {
      return ctx.util.toIso(window.reset_at)
    }
    if (typeof window.reset_after_seconds === "number") {
      return ctx.util.toIso(nowSec + window.reset_after_seconds)
    }
    return null
  }

  // Period durations in milliseconds
  var PERIOD_SESSION_MS = 5 * 60 * 60 * 1000    // 5 hours
  var PERIOD_WEEKLY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  function readEnvString(ctx, name) {
    try {
      if (!ctx.host.env || typeof ctx.host.env.get !== "function") return null
      const value = ctx.host.env.get(name)
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      return null
    }
  }

  // This account isn't the one signed in to the local Codex CLI, so its spend
  // logs live under another login we can't read — the host flags it here.

  // Where ccusage reads session logs: the real local home for the matched
  // account (CODEX_CCUSAGE_HOME), else the auth home (default/unregistered case).











  // Models with no published price are costed at $0 by ccusage and must be
  // held out of the day-cost split below — otherwise they siphon dollars off
  // the models that actually earned them. `codex-auto-review` is the approval
  // reviewer's own model; `gpt-reserve` is the backend identifier for turns
  // that ran on the user-facing Luna Reserve fallback allowance (a separate
  // quota pool once regular quota is exhausted).



  // `gpt-reserve` is the backend identifier for the user-facing Luna Reserve
  // fallback allowance (separate pool once regular quota is exhausted).
  function formatBucketLabel(shortName) {
    if (typeof shortName !== "string" || !shortName) return "Model"
    const key = shortName.trim().toLowerCase().replace(/_/g, "-")
    if (key === "gpt-reserve") return "Luna Reserve"
    return shortName
  }




  // Records a $0 entry for a period the model was actually used in, so the line
  // renders "$0.00" instead of dropping the segment — a missing segment reads as
  // "unknown" downstream and gets back-filled from the provider total × percent.

  // Marks every zero-price model on a day with a $0 presence, before the
  // dollar split below. Days whose total is $0 (or missing) are skipped by
  // the split, but without this their lines would render percent-only and
  // downstream would back-fill them with borrowed dollars.

  // Per-model $ for Today/7d/30d. Prefers Claude-style modelBreakdowns[].cost;
  // Codex days only expose costUSD + a models token map, so split the day total
  // by that day's token share when breakdowns are absent.





  // Spend rows for an account that isn't the local CLI login: show a clear
  // "no local data" state instead of a misleading $0 or another login's spend.


  function probeWithAuthState(ctx, initialAuthState) {
    let authState = initialAuthState
    let auth = authState.auth

    if (auth.tokens && auth.tokens.access_token) {
      const nowMs = Date.now()
      let accessToken = auth.tokens.access_token
      let accountId = auth.tokens.account_id
      let proactiveRefreshAuthError = null

      if (needsRefresh(ctx, auth, nowMs)) {
        ctx.host.log.info("token needs refresh")
        const reload = reloadAuthState(ctx, authState)
        if (reload.status === "error") throw reload.error
        authState = reload.authState
        auth = authState.auth
        accessToken = auth.tokens.access_token
        accountId = auth.tokens.account_id
        let refreshed = null
        if (needsRefresh(ctx, auth, nowMs)) {
          try {
            refreshed = refreshToken(ctx, authState)
          } catch (e) {
            if (!isAuthFallbackError(e)) throw e
            proactiveRefreshAuthError = e
            ctx.host.log.warn("proactive refresh failed, trying existing token: " + String(e))
          }
        }
        if (refreshed) {
          accessToken = refreshed
        } else if (!proactiveRefreshAuthError) {
          ctx.host.log.warn("proactive refresh failed, trying with existing token")
        }
      }

      let resp
      let didRefresh = false
      let didReloadAuth = false
      try {
        resp = ctx.util.retryOnceOnAuth({
          request: (token) => {
            try {
              return fetchUsage(ctx, token || accessToken, accountId)
            } catch (e) {
              ctx.host.log.error("usage request exception: " + String(e))
              if (didRefresh) {
                throw ERR_USAGE_AFTER_REFRESH
              }
              throw ERR_USAGE_CONNECTION
            }
          },
          refresh: () => {
            const reload = reloadAuthState(ctx, authState)
            if (reload.status === "error") throw reload.error
            if (reload.status === "changed") {
              authState = reload.authState
              auth = authState.auth
              accessToken = auth.tokens.access_token
              accountId = auth.tokens.account_id
              proactiveRefreshAuthError = null
              didReloadAuth = true
              ctx.host.log.info("usage returned 401, retrying with reloaded auth")
              return accessToken
            }
            if (proactiveRefreshAuthError) throw proactiveRefreshAuthError
            ctx.host.log.info("usage returned 401, attempting refresh")
            didRefresh = true
            return refreshToken(ctx, authState)
          },
        })
      } catch (e) {
        if (typeof e === "string") throw e
        ctx.host.log.error("usage request failed: " + String(e))
        throw ERR_USAGE_CONNECTION
      }

      if (didReloadAuth && ctx.util.isAuthStatus(resp.status)) {
        ctx.host.log.info("reloaded auth returned 401, attempting refresh")
        didRefresh = true
        const refreshed = refreshToken(ctx, authState)
        if (refreshed) {
          try {
            resp = fetchUsage(ctx, refreshed, accountId)
          } catch (e) {
            ctx.host.log.error("usage request exception after reloaded auth refresh: " + String(e))
            throw ERR_USAGE_AFTER_REFRESH
          }
        }
      }

      if (ctx.util.isAuthStatus(resp.status)) {
        ctx.host.log.error("usage returned auth error after all retries: status=" + resp.status)
        throw ERR_TOKEN_EXPIRED
      }

      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.error("usage returned error: status=" + resp.status)
        throw "Usage request failed (HTTP " + String(resp.status) + "). Try again later."
      }

      ctx.host.log.info("usage fetch succeeded")

      const data = ctx.util.tryParseJson(resp.bodyText)
      if (data === null) {
        throw "Usage response invalid. Try again later."
      }

      const lines = []
      const nowSec = Math.floor(Date.now() / 1000)
      const rateLimit = data.rate_limit || null
      const primaryWindow = rateLimit && rateLimit.primary_window ? rateLimit.primary_window : null
      const secondaryWindow = rateLimit && rateLimit.secondary_window ? rateLimit.secondary_window : null
      const reviewWindow =
        data.code_review_rate_limit && data.code_review_rate_limit.primary_window
          ? data.code_review_rate_limit.primary_window
          : null

      const headerPrimary = readPercent(resp.headers["x-codex-primary-used-percent"])
      const headerSecondary = readPercent(resp.headers["x-codex-secondary-used-percent"])

      if (headerPrimary !== null) {
        lines.push(ctx.line.progress({
          label: "Session",
          used: headerPrimary,
          limit: 100,
          format: { kind: "percent" },
          resetsAt: getResetsAtIso(ctx, nowSec, primaryWindow),
          periodDurationMs: PERIOD_SESSION_MS
        }))
      }
      if (headerSecondary !== null) {
        lines.push(ctx.line.progress({
          label: "Weekly",
          used: headerSecondary,
          limit: 100,
          format: { kind: "percent" },
          resetsAt: getResetsAtIso(ctx, nowSec, secondaryWindow),
          periodDurationMs: PERIOD_WEEKLY_MS
        }))
      }

      if (lines.length === 0 && data.rate_limit) {
        if (data.rate_limit.primary_window && typeof data.rate_limit.primary_window.used_percent === "number") {
          lines.push(ctx.line.progress({
            label: "Session",
            used: data.rate_limit.primary_window.used_percent,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: getResetsAtIso(ctx, nowSec, primaryWindow),
            periodDurationMs: PERIOD_SESSION_MS
          }))
        }
        if (data.rate_limit.secondary_window && typeof data.rate_limit.secondary_window.used_percent === "number") {
          lines.push(ctx.line.progress({
            label: "Weekly",
            used: data.rate_limit.secondary_window.used_percent,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: getResetsAtIso(ctx, nowSec, secondaryWindow),
            periodDurationMs: PERIOD_WEEKLY_MS
          }))
        }
      }

      if (Array.isArray(data.additional_rate_limits)) {
        for (const entry of data.additional_rate_limits) {
          if (!entry || !entry.rate_limit) continue
          const name = typeof entry.limit_name === "string" ? entry.limit_name : ""
          let shortName = name.replace(/^GPT-[\d.]+-Codex-/, "")
          if (!shortName) shortName = name || "Model"
          shortName = formatBucketLabel(shortName)
          const rl = entry.rate_limit
          if (rl.primary_window && typeof rl.primary_window.used_percent === "number") {
            lines.push(ctx.line.progress({
              label: shortName,
              used: rl.primary_window.used_percent,
              limit: 100,
              format: { kind: "percent" },
              resetsAt: getResetsAtIso(ctx, nowSec, rl.primary_window),
              periodDurationMs: typeof rl.primary_window.limit_window_seconds === "number"
                ? rl.primary_window.limit_window_seconds * 1000
                : PERIOD_SESSION_MS
            }))
          }
          if (rl.secondary_window && typeof rl.secondary_window.used_percent === "number") {
            lines.push(ctx.line.progress({
              label: shortName + " Weekly",
              used: rl.secondary_window.used_percent,
              limit: 100,
              format: { kind: "percent" },
              resetsAt: getResetsAtIso(ctx, nowSec, rl.secondary_window),
              periodDurationMs: typeof rl.secondary_window.limit_window_seconds === "number"
                ? rl.secondary_window.limit_window_seconds * 1000
                : PERIOD_WEEKLY_MS
            }))
          }
        }
      }

      if (reviewWindow) {
        const used = reviewWindow.used_percent
        if (typeof used === "number") {
          lines.push(ctx.line.progress({
            label: "Reviews",
            used: used,
            limit: 100,
            format: { kind: "percent" },
            resetsAt: getResetsAtIso(ctx, nowSec, reviewWindow),
            periodDurationMs: PERIOD_WEEKLY_MS // code_review_rate_limit is a 7-day window
          }))
        }
      }

      const resetCreditsInfo = loadRateLimitResetCredits(
        ctx,
        auth.tokens.access_token || accessToken,
        accountId,
        data
      )
      if (resetCreditsInfo) {
        lines.push(ctx.line.text({
          label: "Rate Limit Resets",
          value: resetCreditsInfo.availableCount + " available",
          resetExpiry: resetCreditsInfo.expiryIsos.length > 0
            ? resetCreditsInfo.expiryIsos
            : null,
        }))
      }

      const creditsRemaining = readCreditsRemaining(resp, data)
      if (creditsRemaining !== null) {
        const remaining = Math.max(0, Math.floor(creditsRemaining))
        const usdValue = (remaining * CREDIT_USD_RATE).toFixed(2)
        lines.push(ctx.line.text({
          label: "Credits",
          value: "$" + usdValue + " · " + remaining + " credits",
        }))
      }

      const monthlyCreditLimit = readMonthlyCreditLimit(data)
      if (monthlyCreditLimit) {
        lines.push(ctx.line.progress({
          label: "Monthly Credit Limit",
          used: monthlyCreditLimit.used,
          limit: monthlyCreditLimit.limit,
          format: { kind: "count", suffix: "credits" },
          resetsAt: getResetsAtIso(ctx, nowSec, monthlyCreditLimit.window),
        }))
      }

      let plan = null
      if (data.plan_type) {
        const planLabel = formatCodexPlan(ctx, data.plan_type)
        if (planLabel) {
          plan = planLabel
        }
      }

      if (lines.length === 0) {
        lines.push(ctx.line.badge({ label: "Status", text: "No usage data", color: "#a3a3a3" }))
      }

      return { plan: plan, lines: lines }
    }

    if (auth.OPENAI_API_KEY) {
      throw ERR_USAGE_API_KEY
    }

    throw ERR_NOT_LOGGED_IN
  }

  function probe(ctx) {
    const fileAuth = loadFileAuthCandidates(ctx)
    let lastAuthFallbackError = null
    for (let i = 0; i < fileAuth.candidates.length; i++) {
      const authState = fileAuth.candidates[i]
      try {
        return probeWithAuthState(ctx, authState)
      } catch (e) {
        if (!isAuthFallbackError(e)) {
          throw e
        }
        lastAuthFallbackError = e
        ctx.host.log.warn("auth failed for file " + authState.authPath + ", trying next auth source: " + String(e))
      }
    }

    const keychainAuth = isManagedAccount(ctx) ? null : loadAuthFromKeychain(ctx)
    if (keychainAuth) {
      try {
        return probeWithAuthState(ctx, keychainAuth)
      } catch (e) {
        if (!isAuthFallbackError(e)) throw e
        lastAuthFallbackError = e
        ctx.host.log.warn("keychain auth failed: " + String(e))
      }
    }

    if (lastAuthFallbackError) throw lastAuthFallbackError

    for (const authPath of fileAuth.missingPaths) {
      ctx.host.log.warn("auth file not found: " + authPath)
    }

    ctx.host.log.error("probe failed: not logged in")
    throw ERR_NOT_LOGGED_IN
  }

  globalThis.__usagepal_plugin = { id: "codex", probe }
})()
