(function () {
  const CLOUD_SERVICE = "exa.seat_management_pb.SeatManagementService"
  const DEFAULT_API_SERVER_URL = "https://server.codeium.com"
  const CLOUD_COMPAT_VERSION = "1.108.2"
  const LOGIN_HINT = "Run devin auth login or sign in to Devin and try again."
  const QUOTA_HINT = "Devin quota data unavailable. Try again later."
  const DAY_MS = 24 * 60 * 60 * 1000
  const WEEK_MS = 7 * DAY_MS

  function normalizePlatform(platform) {
    if (platform === "darwin") return "macos"
    if (platform === "win32") return "windows"
    return platform
  }

  function credentialsPaths(ctx) {
    const platform = normalizePlatform(ctx.app.platform)
    if (platform === "windows") {
      return ["~/AppData/Roaming/devin/credentials.toml"]
    }
    return ["~/.local/share/devin/credentials.toml"]
  }

  function appAuthSources(ctx) {
    const platform = normalizePlatform(ctx.app.platform)
    const appNames = ["Devin", "Devin - Next"]

    let makePath
    if (platform === "macos") {
      makePath = (name) => "~/Library/Application Support/" + name + "/User/globalStorage/state.vscdb"
    } else if (platform === "linux") {
      makePath = (name) => "~/.config/" + name + "/User/globalStorage/state.vscdb"
    } else if (platform === "windows") {
      makePath = (name) => "~/AppData/Roaming/" + name + "/User/globalStorage/state.vscdb"
    } else {
      makePath = (name) => "~/Library/Application Support/" + name + "/User/globalStorage/state.vscdb"
    }

    return appNames.map((name) => ({ source: name + " app", stateDb: makePath(name) }))
  }

  function readFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  function clampPercent(value) {
    if (!Number.isFinite(value)) return 0
    if (value < 0) return 0
    if (value > 100) return 100
    return value
  }

  function readTomlString(text, key) {
    const lines = String(text || "").split(/\r?\n/)
    const prefix = new RegExp("^\\s*" + key + "\\s*=\\s*(.*)$")
    for (let i = 0; i < lines.length; i++) {
      const match = prefix.exec(lines[i])
      if (!match) continue
      let value = match[1].trim()
      if (!value) return null
      if (value[0] === '"' || value[0] === "'") {
        const quote = value[0]
        let out = ""
        for (let j = 1; j < value.length; j++) {
          const ch = value[j]
          if (ch === quote && value[j - 1] !== "\\") return out.trim() || null
          out += ch
        }
        return null
      }
      const commentIndex = value.indexOf("#")
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trim()
      return value || null
    }
    return null
  }

  function cleanApiServerUrl(value) {
    if (typeof value !== "string") return null
    const trimmed = value.trim().replace(/\/+$/, "")
    if (!/^https:\/\//.test(trimmed)) return null
    return trimmed
  }

  function effectiveApiServerUrl(auth) {
    return (auth && auth.apiServerUrl) || DEFAULT_API_SERVER_URL
  }

  function hasOwn(obj, key) {
    return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key))
  }

  function readHost(value) {
    if (typeof value !== "string") return null
    const match = /^https?:\/\/([^/]+)/.exec(value.trim())
    return match ? match[1] : null
  }

  function valueOrMissing(value) {
    return value === null || value === undefined || value === "" ? "missing" : String(value)
  }

  function logQuotaDiagnostics(ctx, auth, userStatus) {
    const planStatus = (userStatus && userStatus.planStatus) || {}
    const planInfo = planStatus.planInfo || {}
    const devinInfo = planInfo.devinInfo || {}
    const apiServerHost = readHost(auth.apiServerUrl || DEFAULT_API_SERVER_URL)
    const webappHost = readHost(devinInfo.webappHost) || devinInfo.webappHost || null
    const devinApiHost = readHost(devinInfo.apiUrl)

    ctx.host.log.info(
      "Devin quota diagnostics" +
        " source=" + auth.source +
        " apiServerHost=" + valueOrMissing(apiServerHost) +
        " planName=" + valueOrMissing(planInfo.planName) +
        " teamsTier=" + valueOrMissing(userStatus && userStatus.teamsTier) +
        " planTeamsTier=" + valueOrMissing(planInfo.teamsTier) +
        " billingStrategy=" + valueOrMissing(planInfo.billingStrategy) +
        " isDevin=" + String(planInfo.isDevin === true) +
        " hideDailyQuota=" + String(planInfo.hideDailyQuota === true) +
        " hasDailyQuotaPercent=" + String(hasOwn(planStatus, "dailyQuotaRemainingPercent")) +
        " hasWeeklyQuotaPercent=" + String(hasOwn(planStatus, "weeklyQuotaRemainingPercent")) +
        " hasOverageBalance=" + String(hasOwn(planStatus, "overageBalanceMicros")) +
        " hasDailyReset=" + String(hasOwn(planStatus, "dailyQuotaResetAtUnix")) +
        " hasWeeklyReset=" + String(hasOwn(planStatus, "weeklyQuotaResetAtUnix")) +
        " hasTopUpStatus=" + String(hasOwn(planStatus, "topUpStatus")) +
        " hasPlanStart=" + String(hasOwn(planStatus, "planStart")) +
        " hasPlanEnd=" + String(hasOwn(planStatus, "planEnd")) +
        " hasAcuConsumed=" + String(hasOwn(planStatus, "acuConsumed")) +
        " hasAcuLimit=" + String(hasOwn(planStatus, "acuLimit")) +
        " hasAvailablePromptCredits=" + String(hasOwn(planStatus, "availablePromptCredits")) +
        " hasUsedPromptCredits=" + String(hasOwn(planStatus, "usedPromptCredits")) +
        " hasAvailableFlowCredits=" + String(hasOwn(planStatus, "availableFlowCredits")) +
        " hasUsedFlowCredits=" + String(hasOwn(planStatus, "usedFlowCredits")) +
        " hasAvailableFlexCredits=" + String(hasOwn(planStatus, "availableFlexCredits")) +
        " hasUsedFlexCredits=" + String(hasOwn(planStatus, "usedFlexCredits")) +
        " canUseCli=" + String(devinInfo.canUseCli === true) +
        " canUseCascade=" + String(devinInfo.canUseCascade === true) +
        " devinReviewEnabled=" + String(devinInfo.devinReviewEnabled === true) +
        " webappHost=" + valueOrMissing(webappHost) +
        " devinApiHost=" + valueOrMissing(devinApiHost)
    )
  }

  function loadCredentialsFile(ctx) {
    const paths = credentialsPaths(ctx)
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (!ctx.host.fs.exists(path)) continue
      try {
        const text = ctx.host.fs.readText(path)
        const apiKey = readTomlString(text, "windsurf_api_key")
        if (!apiKey) {
          ctx.host.log.warn("Devin credentials missing windsurf_api_key at " + path)
          continue
        }
        return {
          apiKey: apiKey,
          apiServerUrl: cleanApiServerUrl(readTomlString(text, "api_server_url")),
          source: "credentials.toml",
        }
      } catch (e) {
        ctx.host.log.warn("failed to read Devin credentials at " + path + ": " + String(e))
      }
    }
    return null
  }

  function loadEnvAuth(ctx) {
    try {
      if (!ctx.host.env || typeof ctx.host.env.get !== "function") return null
      const apiKey = ctx.host.env.get("DEVIN_API_KEY")
      if (typeof apiKey !== "string" || !apiKey.trim()) return null
      return {
        apiKey: apiKey.trim(),
        apiServerUrl: null,
        source: "env:DEVIN_API_KEY",
      }
    } catch (e) {
      ctx.host.log.warn("failed to read DEVIN_API_KEY env: " + String(e))
      return null
    }
  }

  function readAppAuth(ctx, variant) {
    try {
      const rows = ctx.host.sqlite.query(
        variant.stateDb,
        "SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus' LIMIT 1"
      )
      const parsed = ctx.util.tryParseJson(rows)
      if (!parsed || !parsed.length || !parsed[0].value) return null
      const auth = ctx.util.tryParseJson(parsed[0].value)
      if (!auth || !auth.apiKey) return null
      return {
        apiKey: auth.apiKey,
        apiServerUrl: null,
        source: variant.source,
      }
    } catch (e) {
      ctx.host.log.warn("failed to read " + variant.source + " auth: " + String(e))
      return null
    }
  }

  function callCloud(ctx, auth) {
    const apiServerUrl = effectiveApiServerUrl(auth)
    try {
      const resp = ctx.host.http.request({
        method: "POST",
        url: apiServerUrl + "/" + CLOUD_SERVICE + "/GetUserStatus",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        bodyText: JSON.stringify({
          metadata: {
            apiKey: auth.apiKey,
            ideName: "devin",
            ideVersion: CLOUD_COMPAT_VERSION,
            extensionName: "devin",
            extensionVersion: CLOUD_COMPAT_VERSION,
            locale: "en",
          },
        }),
        timeoutMs: 15000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("cloud request returned status " + resp.status + " for " + auth.source)
        if (ctx.util && typeof ctx.util.isAuthStatus === "function" && ctx.util.isAuthStatus(resp.status)) {
          return { __usagepalAuthError: true }
        }
        return null
      }
      return ctx.util.tryParseJson(resp.bodyText)
    } catch (e) {
      ctx.host.log.warn("cloud request failed for " + auth.source + ": " + String(e))
      return null
    }
  }

  function tryAuth(ctx, auth) {
    const data = callCloud(ctx, auth)
    if (data && data.__usagepalAuthError) {
      return { authFailure: true }
    }
    if (!data || !data.userStatus) return {}

    try {
      logQuotaDiagnostics(ctx, auth, data.userStatus)
      return { output: buildOutput(ctx, data.userStatus) }
    } catch (e) {
      if (e === QUOTA_HINT) {
        ctx.host.log.warn("quota contract unavailable for " + auth.source)
        return {}
      }
      throw e
    }
  }

  function unixSecondsToIso(ctx, value) {
    const seconds = readFiniteNumber(value)
    if (seconds === null) return null
    return ctx.util.toIso(seconds * 1000)
  }

  function formatDollarsFromMicros(value) {
    let micros = readFiniteNumber(value)
    if (micros === null) return null
    if (!Number.isFinite(micros)) return null
    if (micros < 0) micros = 0
    return "$" + (micros / 1000000).toFixed(2)
  }

  function buildQuotaLine(ctx, label, remaining, resetsAt, periodDurationMs) {
    if (remaining === null) return null
    return buildUsedQuotaLine(ctx, label, 100 - remaining, resetsAt, periodDurationMs)
  }

  function buildUsedQuotaLine(ctx, label, used, resetsAt, periodDurationMs) {
    if (used === null) return null
    const line = {
      label: label,
      used: clampPercent(used),
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: periodDurationMs,
    }
    if (resetsAt) line.resetsAt = resetsAt
    return ctx.line.progress(line)
  }

  function planPeriodMs(ctx, planStatus) {
    const start = readFiniteNumber(planStatus.planStart)
    const end = readFiniteNumber(planStatus.planEnd)
    if (start === null || end === null) return null
    const ms = (end - start) * 1000
    return Number.isFinite(ms) && ms > 0 ? ms : null
  }

  function buildAcuLine(ctx, planStatus, reset, periodDurationMs) {
    const consumed = readFiniteNumber(planStatus.acuConsumed)
    const limit = readFiniteNumber(planStatus.acuLimit)
    if (consumed === null && limit === null) return null

    if (limit > 0) {
      const used = ((consumed || 0) / limit) * 100
      const line = {
        label: "ACU used",
        used: clampPercent(used),
        limit: 100,
        format: { kind: "percent" },
        periodDurationMs: periodDurationMs,
      }
      if (reset) line.resetsAt = reset
      return ctx.line.progress(line)
    }

    if (consumed !== null && consumed > 0) {
      return ctx.line.text({ label: "ACU used", value: consumed.toFixed(2) + " ACU" })
    }

    return null
  }

  function buildCreditLine(ctx, label, used, available, reset, periodDurationMs) {
    if (used === null && available === null) return null

    if (used !== null && used < 0) {
      return ctx.line.badge({ label: label, text: "Unlimited", color: "#a3a3a3" })
    }
    if (available !== null && available < 0) {
      return ctx.line.badge({ label: label, text: "Unlimited", color: "#a3a3a3" })
    }

    const total = used !== null && available !== null ? used + available : null
    if (total !== null && total > 0) {
      const line = {
        label: label,
        used: clampPercent((used / total) * 100),
        limit: 100,
        format: { kind: "percent" },
        periodDurationMs: periodDurationMs,
      }
      if (reset) line.resetsAt = reset
      return ctx.line.progress(line)
    }

    if (used !== null && used > 0) {
      return ctx.line.text({ label: label, value: String(used) + " used" })
    }
    if (available !== null && available > 0) {
      return ctx.line.text({ label: label, value: String(available) + " available" })
    }

    return null
  }

  function buildPaceBadge(ctx, progressLine) {
    if (!progressLine || progressLine.type !== "progress") return null
    const nowMs = ctx.util.parseDateMs(ctx.nowIso)
    const resetsAtMs = progressLine.resetsAt ? ctx.util.parseDateMs(progressLine.resetsAt) : null
    const periodDurationMs = progressLine.periodDurationMs
    if (
      nowMs === null ||
      resetsAtMs === null ||
      !Number.isFinite(periodDurationMs) ||
      !Number.isFinite(progressLine.used) ||
      !Number.isFinite(progressLine.limit)
    ) {
      return null
    }

    const periodStartMs = resetsAtMs - periodDurationMs
    const elapsedMs = nowMs - periodStartMs
    if (elapsedMs <= 0 || nowMs >= resetsAtMs) return null

    if (progressLine.used === 0) {
      return ctx.line.badge({ label: "Pace", text: "Ahead", color: "#22c55e" })
    }
    if (progressLine.used >= progressLine.limit) {
      return ctx.line.badge({ label: "Pace", text: "Behind", color: "#ef4444" })
    }

    const elapsedFraction = elapsedMs / periodDurationMs
    if (elapsedFraction < 0.05) return null

    const projectedUsage = (progressLine.used / elapsedMs) * periodDurationMs
    if (projectedUsage <= progressLine.limit * 0.8) {
      return ctx.line.badge({ label: "Pace", text: "Ahead", color: "#22c55e" })
    }
    if (projectedUsage <= progressLine.limit) {
      return ctx.line.badge({ label: "Pace", text: "On track", color: "#a3a3a3" })
    }
    return ctx.line.badge({ label: "Pace", text: "Behind", color: "#ef4444" })
  }

  function buildOutput(ctx, userStatus) {
    const planStatus = (userStatus && userStatus.planStatus) || {}
    const planInfo = planStatus.planInfo || {}
    const planName = typeof planInfo.planName === "string" && planInfo.planName.trim()
      ? planInfo.planName.trim()
      : "Unknown"

    const hideDailyQuota = planInfo.hideDailyQuota === true
    const dailyRemaining = readFiniteNumber(planStatus.dailyQuotaRemainingPercent)
    const weeklyRemaining = readFiniteNumber(planStatus.weeklyQuotaRemainingPercent)
    const dailyReset = !hideDailyQuota ? unixSecondsToIso(ctx, planStatus.dailyQuotaResetAtUnix) : null
    const weeklyReset = unixSecondsToIso(ctx, planStatus.weeklyQuotaResetAtUnix)

    const planEnd = unixSecondsToIso(ctx, planStatus.planEnd)
    const planPeriod = planPeriodMs(ctx, planStatus)

    const dailyLine = !hideDailyQuota && dailyRemaining !== null
      ? buildQuotaLine(ctx, "Daily quota", dailyRemaining, dailyReset, DAY_MS)
      : null

    let weeklyLine = null
    if (weeklyRemaining !== null) {
      weeklyLine = buildQuotaLine(ctx, "Weekly quota", weeklyRemaining, weeklyReset, WEEK_MS)
    } else if (hideDailyQuota && dailyRemaining !== null) {
      ctx.host.log.info("Devin weekly quota mapped from daily because weeklyQuotaRemainingPercent is missing")
      weeklyLine = buildUsedQuotaLine(ctx, "Weekly quota", dailyRemaining, weeklyReset, WEEK_MS)
    }

    const acuLine = buildAcuLine(ctx, planStatus, planEnd, planPeriod)

    const promptLine = buildCreditLine(
      ctx,
      "Prompt credits",
      readFiniteNumber(planStatus.usedPromptCredits),
      readFiniteNumber(planStatus.availablePromptCredits),
      planEnd,
      planPeriod
    )
    const flowLine = buildCreditLine(
      ctx,
      "Flow credits",
      readFiniteNumber(planStatus.usedFlowCredits),
      readFiniteNumber(planStatus.availableFlowCredits),
      planEnd,
      planPeriod
    )
    const onDemandLine = buildCreditLine(
      ctx,
      "On-demand credits",
      readFiniteNumber(planStatus.usedFlexCredits),
      readFiniteNumber(planStatus.availableFlexCredits),
      planEnd,
      planPeriod
    )

    const extraUsageBalance = formatDollarsFromMicros(planStatus.overageBalanceMicros)
    const extraUsageLine = extraUsageBalance
      ? ctx.line.text({ label: "Extra usage balance", value: extraUsageBalance })
      : null

    const paceBadge = buildPaceBadge(ctx, weeklyLine || acuLine)

    const lines = []
    if (acuLine) lines.push(acuLine)
    if (weeklyLine) lines.push(weeklyLine)
    if (dailyLine) lines.push(dailyLine)
    if (promptLine) lines.push(promptLine)
    if (flowLine) lines.push(flowLine)
    if (onDemandLine) lines.push(onDemandLine)
    if (extraUsageLine) lines.push(extraUsageLine)
    if (paceBadge) lines.push(paceBadge)

    if (!lines.length) throw QUOTA_HINT

    return {
      plan: planName,
      lines: lines,
    }
  }

  function probe(ctx) {
    let sawApiKey = false
    let sawAuthFailure = false
    const attempts = []

    const envAuth = loadEnvAuth(ctx)
    if (envAuth) {
      sawApiKey = true
      attempts.push(authFingerprint(envAuth))
      const envAttempt = tryAuth(ctx, envAuth)
      if (envAttempt.output) return envAttempt.output
      if (envAttempt.authFailure) sawAuthFailure = true
    }

    const credentials = loadCredentialsFile(ctx)
    if (credentials) {
      sawApiKey = true
      attempts.push(authFingerprint(credentials))
      const credentialsAttempt = tryAuth(ctx, credentials)
      if (credentialsAttempt.output) return credentialsAttempt.output
      if (credentialsAttempt.authFailure) sawAuthFailure = true
    }

    // Walk every app install (stable, then "- Next") and try each token the cloud
    // hasn't already rejected, so a stale token in one install doesn't mask a
    // valid one in another. Read each state DB only when we reach it, so a working
    // earlier source short-circuits before we touch a later install's DB.
    const appSources = appAuthSources(ctx)
    for (let i = 0; i < appSources.length; i++) {
      const appAuth = readAppAuth(ctx, appSources[i])
      if (!appAuth) continue
      if (alreadyAttempted(attempts, appAuth)) continue
      sawApiKey = true
      attempts.push(authFingerprint(appAuth))
      const appAttempt = tryAuth(ctx, appAuth)
      if (appAttempt.output) return appAttempt.output
      if (appAttempt.authFailure) sawAuthFailure = true
    }

    if (sawAuthFailure) throw LOGIN_HINT
    if (sawApiKey) throw QUOTA_HINT
    throw LOGIN_HINT
  }

  function authFingerprint(auth) {
    return auth.apiKey + "\n" + effectiveApiServerUrl(auth)
  }

  function alreadyAttempted(attempts, auth) {
    const fingerprint = authFingerprint(auth)
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] === fingerprint) return true
    }
    return false
  }

  globalThis.__usagepal_plugin = {
    id: "devin",
    probe: probe,
    __test: {
      normalizePlatform,
      credentialsPaths,
      appAuthSources,
      buildOutput,
      buildPaceBadge,
      buildCreditLine,
      buildAcuLine,
    },
  }
})()
