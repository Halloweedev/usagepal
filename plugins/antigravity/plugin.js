(function () {
  var LS_SERVICE = "exa.language_server_pb.LanguageServerService"
  // Antigravity IDE is a VS Code fork, so its state DB sits under the standard
  // per-OS user-data dir. "Antigravity IDE" is the current folder; "Antigravity"
  // is the pre-2.0 one, still present on machines that upgraded.
  var STATE_DB_BASES = {
    macos: "~/Library/Application Support/",
    linux: "~/.config/",
    windows: "~/AppData/Roaming/",
  }
  var STATE_DB_DIRS = ["Antigravity IDE", "Antigravity"]
  var STATE_DB_LEAF = "/User/globalStorage/state.vscdb"
  // agy caches its OAuth token in the OS keyring, but falls back to this file
  // whenever the keyring is unavailable — the common case on Linux, where a
  // headless or dbus-less session has no secret service.
  var AGY_TOKEN_FILE = "~/.gemini/antigravity-cli/antigravity-oauth-token"
  var AGY_KEYCHAIN_SERVICE = "gemini"
  var AGY_KEYCHAIN_ACCOUNT = "antigravity"
  var CLOUD_CODE_URLS = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]
  var LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist"
  var FETCH_MODELS_PATH = "/v1internal:fetchAvailableModels"
  var RETRIEVE_QUOTA_PATH = "/v1internal:retrieveUserQuota"
  var LOGIN_MESSAGE = "Start Antigravity or run `agy` and try again."
  var UNREACHABLE_MESSAGE = "Can't reach Antigravity right now. Try again shortly."
  var GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token"
  var GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
  var GOOGLE_CLIENT_SECRET = "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"
  var OAUTH_TOKEN_KEY = "antigravityUnifiedStateSync.oauthToken"
  var OAUTH_TOKEN_SENTINEL = "oauthTokenInfoSentinelKey"
  var CC_MODEL_BLACKLIST = {
    "MODEL_CHAT_20706": true,
    "MODEL_CHAT_23310": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE": true,
    "MODEL_GOOGLE_GEMINI_2_5_PRO": true,
    "MODEL_PLACEHOLDER_M19": true,
    "MODEL_PLACEHOLDER_M9": true,
    "MODEL_PLACEHOLDER_M12": true,
  }
  // --- Protobuf wire-format decoder ---

  function readVarint(s, pos) {
    var v = 0
    var shift = 0
    while (pos < s.length) {
      var b = s.charCodeAt(pos++)
      v += (b & 0x7f) * Math.pow(2, shift)
      if ((b & 0x80) === 0) return { v: v, p: pos }
      shift += 7
    }
    return null
  }

  function readFields(s) {
    var fields = {}
    var pos = 0
    while (pos < s.length) {
      var tag = readVarint(s, pos)
      if (!tag) break
      pos = tag.p
      var fieldNum = Math.floor(tag.v / 8)
      var wireType = tag.v % 8
      if (wireType === 0) {
        var val = readVarint(s, pos)
        if (!val) break
        fields[fieldNum] = { type: 0, value: val.v }
        pos = val.p
      } else if (wireType === 1) {
        if (pos + 8 > s.length) break
        pos += 8
      } else if (wireType === 2) {
        var len = readVarint(s, pos)
        if (!len) break
        pos = len.p
        if (pos + len.v > s.length) break
        fields[fieldNum] = { type: 2, data: s.substring(pos, pos + len.v) }
        pos += len.v
      } else if (wireType === 5) {
        if (pos + 4 > s.length) break
        pos += 4
      } else {
        break
      }
    }
    return fields
  }

  // --- SQLite credential reading ---

  // Antigravity wraps OAuth state in a double-base64 envelope:
  //   b64(outer.f1 = wrapper{ f1=sentinel, f2=payload{ f1=b64(inner proto) } }).
  // The inner base64 layer is the unusual part — it's a UTF-8 string field, not raw bytes.
  function unwrapOAuthSentinel(ctx, base64Text) {
    var trimmed = String(base64Text || "").replace(/^\s+|\s+$/g, "")
    if (!trimmed) return null
    var outer = ctx.base64.decode(trimmed)
    var outerFields = readFields(outer)
    if (!outerFields[1] || outerFields[1].type !== 2) return null
    var wrapper = readFields(outerFields[1].data)
    var sentinel = (wrapper[1] && wrapper[1].type === 2) ? wrapper[1].data : null
    var payload = (wrapper[2] && wrapper[2].type === 2) ? wrapper[2].data : null
    if (sentinel !== OAUTH_TOKEN_SENTINEL || !payload) return null
    var payloadFields = readFields(payload)
    if (!payloadFields[1] || payloadFields[1].type !== 2) return null
    var innerText = payloadFields[1].data.replace(/^\s+|\s+$/g, "")
    if (!innerText) return null
    return ctx.base64.decode(innerText)
  }

  function loadOAuthTokensFromDb(ctx, dbPath) {
    try {
      var rows = ctx.host.sqlite.query(
        dbPath,
        "SELECT value FROM ItemTable WHERE key = '" + OAUTH_TOKEN_KEY + "' LIMIT 1"
      )
      var parsed = ctx.util.tryParseJson(rows)
      if (!parsed || !parsed.length || !parsed[0].value) return null
      var inner = unwrapOAuthSentinel(ctx, parsed[0].value)
      if (!inner) return null
      var fields = readFields(inner)
      var accessToken = (fields[1] && fields[1].type === 2) ? fields[1].data : null
      var refreshToken = (fields[3] && fields[3].type === 2) ? fields[3].data : null
      var expirySeconds = null
      if (fields[4] && fields[4].type === 2) {
        var ts = readFields(fields[4].data)
        if (ts[1] && ts[1].type === 0) expirySeconds = ts[1].value
      }
      if (!accessToken && !refreshToken) return null
      return { accessToken: accessToken, refreshToken: refreshToken, expirySeconds: expirySeconds }
    } catch (e) {
      ctx.host.log.warn("failed to read unified oauth token from " + dbPath + ": " + String(e))
      return null
    }
  }

  // Unknown platforms probe every base path, so a host that reports something
  // we don't branch on still finds the DB instead of silently reporting nothing.
  function stateDbBases(platform) {
    var known = STATE_DB_BASES[platform]
    if (known) return [known]
    return [STATE_DB_BASES.macos, STATE_DB_BASES.linux, STATE_DB_BASES.windows]
  }

  function stateDbPaths(ctx) {
    var bases = stateDbBases(ctx.app && ctx.app.platform)
    var paths = []
    for (var i = 0; i < bases.length; i++) {
      for (var j = 0; j < STATE_DB_DIRS.length; j++) {
        paths.push(bases[i] + STATE_DB_DIRS[j] + STATE_DB_LEAF)
      }
    }
    return paths
  }

  function loadOAuthTokenCandidates(ctx) {
    var paths = stateDbPaths(ctx)
    var candidates = []
    for (var i = 0; i < paths.length; i++) {
      var tokens = loadOAuthTokensFromDb(ctx, paths[i])
      if (tokens) candidates.push(tokens)
    }
    return candidates
  }

  // --- Google OAuth token refresh ---

  function refreshAccessToken(ctx, refreshTokenValue) {
    if (!refreshTokenValue) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }
    ctx.host.log.info("attempting Google OAuth token refresh")
    try {
      var resp = ctx.host.http.request({
        method: "POST",
        url: GOOGLE_OAUTH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID) +
          "&client_secret=" + encodeURIComponent(GOOGLE_CLIENT_SECRET) +
          "&refresh_token=" + encodeURIComponent(refreshTokenValue) +
          "&grant_type=refresh_token",
        timeoutMs: 15000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Google OAuth refresh returned status: " + resp.status)
        return null
      }
      var body = ctx.util.tryParseJson(resp.bodyText)
      if (!body || !body.access_token) {
        ctx.host.log.warn("Google OAuth refresh response missing access_token")
        return null
      }
      var expiresIn = (typeof body.expires_in === "number") ? body.expires_in : 3600
      cacheToken(ctx, body.access_token, expiresIn)
      return body.access_token
    } catch (e) {
      ctx.host.log.warn("Google OAuth refresh failed: " + String(e))
      return null
    }
  }

  // --- Token cache ---

  function loadCachedToken(ctx) {
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      if (!ctx.host.fs.exists(path)) return null
      var data = ctx.util.tryParseJson(ctx.host.fs.readText(path))
      if (!data || !data.accessToken || !data.expiresAtMs) return null
      if (data.expiresAtMs <= Date.now()) return null
      return data.accessToken
    } catch (e) {
      ctx.host.log.warn("failed to read cached token: " + String(e))
      return null
    }
  }

  function cacheToken(ctx, accessToken, expiresInSeconds) {
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      ctx.host.fs.writeText(path, JSON.stringify({
        accessToken: accessToken,
        expiresAtMs: Date.now() + (expiresInSeconds || 3600) * 1000,
      }))
    } catch (e) {
      ctx.host.log.warn("failed to cache refreshed token: " + String(e))
    }
  }

  // --- agy keychain token ---

  function trimString(value) {
    return typeof value === "string" ? value.trim() : ""
  }

  function decodeBase64(ctx, text) {
    try {
      return ctx.base64.decode(text)
    } catch (e) {
      return null
    }
  }

  function unwrapAgyKeychainText(ctx, raw) {
    var text = trimString(raw)
    if (!text) return null
    if (text.indexOf("go-keyring-base64:") === 0) {
      text = trimString(decodeBase64(ctx, text.slice("go-keyring-base64:".length)))
    }
    return text || null
  }

  function extractTokenFromObject(obj) {
    if (!obj || typeof obj !== "object") return null

    var directKeys = [
      "access_token",
      "accessToken",
      "token",
      "id_token",
      "idToken",
      "bearerToken",
      "auth_token",
      "authToken",
    ]
    for (var i = 0; i < directKeys.length; i++) {
      var value = obj[directKeys[i]]
      if (typeof value === "string" && value.trim()) return value.trim()
    }

    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j++) {
      var nested = extractTokenFromObject(obj[nestedKeys[j]])
      if (nested) return nested
    }

    return null
  }

  function extractAgyAccessToken(ctx, raw) {
    var text = unwrapAgyKeychainText(ctx, raw)
    if (!text) return null

    var parsed = ctx.util.tryParseJson(text)
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim()
    if (parsed) return extractTokenFromObject(parsed)

    if (text.indexOf("Bearer ") === 0) return text.slice("Bearer ".length).trim() || null
    return text
  }

  // The keychain binding exists on every platform and throws when called off
  // macOS, so the typeof guard never fires there — the catch is what makes this
  // safe on Windows and Linux.
  function loadAgyKeychainToken(ctx) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }
    try {
      var raw = ctx.host.keychain.readGenericPassword(AGY_KEYCHAIN_SERVICE, AGY_KEYCHAIN_ACCOUNT)
      return extractAgyAccessToken(ctx, raw)
    } catch (e) {
      ctx.host.log.info("agy keychain read failed: " + String(e))
      return null
    }
  }

  function loadAgyFileToken(ctx) {
    try {
      if (!ctx.host.fs.exists(AGY_TOKEN_FILE)) return null
      return extractAgyAccessToken(ctx, ctx.host.fs.readText(AGY_TOKEN_FILE))
    } catch (e) {
      ctx.host.log.info("agy token file read failed: " + String(e))
      return null
    }
  }

  // Keychain first so macOS keeps its existing source of truth; the file is
  // agy's own fallback and is the only source on a keyring-less Linux session.
  function loadAgyTokens(ctx) {
    var tokens = []
    var keychainToken = loadAgyKeychainToken(ctx)
    if (keychainToken) tokens.push(keychainToken)
    var fileToken = loadAgyFileToken(ctx)
    if (fileToken && tokens.indexOf(fileToken) === -1) tokens.push(fileToken)
    return tokens
  }

  // --- LS discovery ---

  function discoverLs(ctx) {
    return ctx.host.ls.discover({
      processName: "language_server",
      markers: ["antigravity", "antigravity-ide"],
      csrfFlag: "--csrf_token",
      portFlag: "--extension_server_port",
    })
  }

  function discoverAgyLs(ctx) {
    return ctx.host.ls.discover({
      processName: "agy",
      markers: [],
      csrfFlag: "",
      portFlag: null,
    })
  }

  // The language server expects the host OS in its request metadata. The host
  // reports the same three names, so pass it through and fall back to macos for
  // anything else rather than sending a value the server has never seen.
  function lsOsName(ctx) {
    var platform = (ctx.app && ctx.app.platform) || ""
    return STATE_DB_BASES[platform] ? platform : "macos"
  }

  function probePort(ctx, scheme, port, csrf) {
    ctx.host.http.request({
      method: "POST",
      url: scheme + "://127.0.0.1:" + port + "/" + LS_SERVICE + "/GetUnleashData",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
      },
      bodyText: JSON.stringify({
        context: {
          properties: {
            devMode: "false",
            extensionVersion: "unknown",
            ide: "antigravity",
            ideVersion: "unknown",
            os: lsOsName(ctx),
          },
        },
      }),
      timeoutMs: 5000,
      dangerouslyIgnoreTls: scheme === "https",
    })
    // Any HTTP response means this port is alive (even 400 validation errors).
    return true
  }

  function findWorkingPort(ctx, discovery) {
    var ports = discovery.ports || []
    for (var i = 0; i < ports.length; i++) {
      var port = ports[i]
      // Try HTTPS first (LS may use self-signed cert), then HTTP
      try { if (probePort(ctx, "https", port, discovery.csrf)) return { port: port, scheme: "https" } } catch (e) { /* ignore */ }
      try { if (probePort(ctx, "http", port, discovery.csrf)) return { port: port, scheme: "http" } } catch (e) { /* ignore */ }
      ctx.host.log.info("port " + port + " probe failed on both schemes")
    }
    if (discovery.extensionPort) return { port: discovery.extensionPort, scheme: "http" }
    return null
  }

  function callLs(ctx, port, scheme, csrf, method, body) {
    var resp = ctx.host.http.request({
      method: "POST",
      url: scheme + "://127.0.0.1:" + port + "/" + LS_SERVICE + "/" + method,
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
      },
      bodyText: JSON.stringify(body || {}),
      timeoutMs: 10000,
      dangerouslyIgnoreTls: scheme === "https",
    })
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("callLs " + method + " returned " + resp.status)
      return null
    }
    return ctx.util.tryParseJson(resp.bodyText)
  }

  // --- Line builders ---

  function normalizeLabel(label) {
    // "Gemini 3 Pro (High)" -> "Gemini 3 Pro"
    return label.replace(/\s*\([^)]*\)\s*$/, "").trim()
  }

  // All non-Gemini models (Claude, GPT-OSS, etc.) share a single quota pool, so
  // anything unrecognized lands there. Pool labels are fixed because overview
  // membership is an exact match against the manifest, so a new model family
  // can't get its own overview line — it gets logged here and shown at its real
  // value on its own per-model line instead.
  function poolLabel(ctx, normalizedLabel) {
    var lower = normalizedLabel.toLowerCase()
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("pro") !== -1) return "Gemini Pro"
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("flash") !== -1) return "Gemini Flash"
    if (lower.indexOf("claude") !== -1) return "Claude"
    ctx.host.log.info("model '" + normalizedLabel + "' matched no pool rule; folded into Claude")
    return "Claude"
  }

  function modelSortKey(label) {
    var lower = label.toLowerCase()
    // Gemini Pro variants first, then other Gemini, then Claude Opus, then other Claude, then rest
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("pro") !== -1) return "0a_" + label
    if (lower.indexOf("gemini") !== -1) return "0b_" + label
    if (lower.indexOf("claude") !== -1 && lower.indexOf("opus") !== -1) return "1a_" + label
    if (lower.indexOf("claude") !== -1) return "1b_" + label
    return "2_" + label
  }

  var QUOTA_PERIOD_MS = 5 * 60 * 60 * 1000 // 5 hours

  // Labels that appear on the overview card. They must match plugin.json.
  var POOL_LABELS = ["Gemini Pro", "Gemini Flash", "Claude"]
  var HISTORY_FILE_NAME = "history.json"
  var HISTORY_RETENTION_MS = 31 * 24 * 60 * 60 * 1000
  var HISTORY_MAX_SAMPLES = 1500
  var HISTORY_MIN_SAMPLE_GAP_MS = 60 * 1000
  var TREND_MAX_DAYS = 31
  var TREND_MIN_DAYS = 2
  var BURN_RATE_MIN_SPAN_MS = 15 * 60 * 1000

  function modelLine(ctx, label, remainingFraction, resetTime) {
    var clamped = Math.max(0, Math.min(1, remainingFraction))
    var used = Math.round((1 - clamped) * 100)
    return ctx.line.progress({
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: resetTime || undefined,
      periodDurationMs: QUOTA_PERIOD_MS,
    })
  }

  // A pool reports its worst model, so a drained variant is never hidden behind
  // a healthy sibling.
  function keepWorst(bucket, label, remainingFraction, resetTime) {
    if (!bucket[label] || remainingFraction < bucket[label].remainingFraction) {
      bucket[label] = { label: label, remainingFraction: remainingFraction, resetTime: resetTime }
    }
  }

  function sortedLines(ctx, bucket) {
    var models = []
    var keys = Object.keys(bucket)
    for (var i = 0; i < keys.length; i++) {
      var m = bucket[keys[i]]
      m.sortKey = modelSortKey(m.label)
      models.push(m)
    }

    models.sort(function (a, b) {
      return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
    })

    var lines = []
    for (var i = 0; i < models.length; i++) {
      lines.push(modelLine(ctx, models[i].label, models[i].remainingFraction, models[i].resetTime))
    }
    return lines
  }

  // Pool lines first — their labels match the manifest, which is what puts them
  // on the overview card. The per-model lines that follow carry labels the
  // manifest doesn't declare, so the UI renders them as detail-only model rows.
  function buildModelLines(ctx, configs) {
    var pools = {}
    var models = {}
    for (var i = 0; i < configs.length; i++) {
      var c = configs[i]
      var label = (typeof c.label === "string") ? c.label.trim() : ""
      if (!label) continue
      var qi = c.quotaInfo
      var frac = (qi && typeof qi.remainingFraction === "number") ? qi.remainingFraction : 0
      var rtime = (qi && qi.resetTime) || undefined
      var normalized = normalizeLabel(label)
      keepWorst(pools, poolLabel(ctx, normalized), frac, rtime)
      keepWorst(models, normalized, frac, rtime)
    }

    // A model whose own name is already a pool name would produce two lines
    // sharing a label, which the UI keys on — drop the duplicate.
    var modelKeys = Object.keys(models)
    for (var k = 0; k < modelKeys.length; k++) {
      if (pools[modelKeys[k]]) delete models[modelKeys[k]]
    }

    return sortedLines(ctx, pools).concat(sortedLines(ctx, models))
  }

  // --- Usage history ---

  // Antigravity reports a remaining fraction and nothing else: no token counts,
  // no request counts, no cost, and no history of its own. The only way to show
  // a trend is to sample what it does report and keep the samples ourselves.
  // Every probe runs in a fresh runtime, so the series has to round-trip through
  // the plugin data dir.
  function historyPath(ctx) {
    var dir = ctx.app && ctx.app.pluginDataDir
    return dir ? dir + "/" + HISTORY_FILE_NAME : null
  }

  function isUsableSample(sample) {
    return !!sample &&
      typeof sample.ts === "number" &&
      isFinite(sample.ts) &&
      !!sample.pools &&
      typeof sample.pools === "object"
  }

  function loadHistory(ctx) {
    var path = historyPath(ctx)
    if (!path) return []
    try {
      if (!ctx.host.fs.exists(path)) return []
      var parsed = ctx.util.tryParseJson(ctx.host.fs.readText(path))
      if (!parsed || !Array.isArray(parsed.samples)) return []
      var samples = []
      for (var i = 0; i < parsed.samples.length; i++) {
        if (isUsableSample(parsed.samples[i])) samples.push(parsed.samples[i])
      }
      return samples
    } catch (e) {
      ctx.host.log.warn("failed to read usage history: " + String(e))
      return []
    }
  }

  function saveHistory(ctx, samples) {
    var path = historyPath(ctx)
    if (!path) return
    try {
      ctx.host.fs.writeText(path, JSON.stringify({ v: 1, samples: samples }))
    } catch (e) {
      ctx.host.log.warn("failed to persist usage history: " + String(e))
    }
  }

  function poolUsageFromLines(lines) {
    var pools = {}
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (line.type !== "progress") continue
      if (POOL_LABELS.indexOf(line.label) === -1) continue
      pools[line.label] = line.used
    }
    return pools
  }

  // The pool closest to running out — the one worth charting and pacing.
  // Ties resolve in manifest order so the choice doesn't flicker between probes.
  function topPool(pools) {
    var top = null
    for (var i = 0; i < POOL_LABELS.length; i++) {
      var label = POOL_LABELS[i]
      var used = pools[label]
      if (typeof used !== "number" || !isFinite(used)) continue
      if (!top || used > top.used) top = { label: label, used: used }
    }
    return top
  }

  // Returns the new sample list, or null when this probe is too close to the
  // previous sample to be worth recording (rapid manual refreshes).
  function recordSample(samples, pools, nowMs) {
    if (Object.keys(pools).length === 0) return null
    var last = samples.length ? samples[samples.length - 1] : null
    if (last && nowMs - last.ts < HISTORY_MIN_SAMPLE_GAP_MS) return null

    var next = []
    var cutoff = nowMs - HISTORY_RETENTION_MS
    for (var i = 0; i < samples.length; i++) {
      if (samples[i].ts >= cutoff && samples[i].ts <= nowMs) next.push(samples[i])
    }
    next.push({ ts: nowMs, pools: pools })
    if (next.length > HISTORY_MAX_SAMPLES) next = next.slice(next.length - HISTORY_MAX_SAMPLES)
    return next
  }

  function pad2(value) {
    return value < 10 ? "0" + value : String(value)
  }

  function dayKey(ts) {
    var d = new Date(ts)
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
  }

  function dayLabel(key) {
    return Number(key.slice(5, 7)) + "/" + Number(key.slice(8, 10))
  }

  function trendPoints(samples) {
    var byDay = {}
    for (var i = 0; i < samples.length; i++) {
      var top = topPool(samples[i].pools)
      if (!top) continue
      var key = dayKey(samples[i].ts)
      if (!byDay[key] || top.used > byDay[key].used) byDay[key] = top
    }

    var keys = Object.keys(byDay).sort()
    if (keys.length > TREND_MAX_DAYS) keys = keys.slice(keys.length - TREND_MAX_DAYS)

    var points = []
    for (var j = 0; j < keys.length; j++) {
      var peak = byDay[keys[j]]
      points.push({
        label: dayLabel(keys[j]),
        value: peak.used,
        valueLabel: peak.used + "% " + peak.label,
      })
    }
    return points
  }

  function poolResetsAt(lines, label) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].label === label && lines[i].resetsAt) return lines[i].resetsAt
    }
    return null
  }

  function formatBurnRate(percentPerHour) {
    return percentPerHour >= 10
      ? String(Math.round(percentPerHour))
      : String(Math.round(percentPerHour * 10) / 10)
  }

  // Consumption within the pool's current reset window. Samples from an earlier
  // window would compare against a quota that has since refilled, so the window
  // start is the cutoff.
  function burnRateLine(ctx, samples, lines, nowMs) {
    var top = topPool(poolUsageFromLines(lines))
    if (!top) return null

    // A reset time already in the past means the provider's value is stale, so
    // deriving the window from it would compare against an unbounded stretch of
    // history. Fall back to the trailing period instead.
    var resetsAtMs = ctx.util.parseDateMs(poolResetsAt(lines, top.label))
    var windowStart = (typeof resetsAtMs === "number" && isFinite(resetsAtMs) && resetsAtMs > nowMs)
      ? resetsAtMs - QUOTA_PERIOD_MS
      : nowMs - QUOTA_PERIOD_MS

    var inWindow = []
    for (var i = 0; i < samples.length; i++) {
      var used = samples[i].pools[top.label]
      if (samples[i].ts < windowStart) continue
      if (typeof used !== "number" || !isFinite(used)) continue
      inWindow.push({ ts: samples[i].ts, used: used })
    }
    if (inWindow.length < 2) return null

    var first = inWindow[0]
    var last = inWindow[inWindow.length - 1]
    var elapsedMs = last.ts - first.ts
    if (elapsedMs < BURN_RATE_MIN_SPAN_MS) return null

    var delta = last.used - first.used
    if (delta <= 0) return null

    var rate = delta / (elapsedMs / 3600000)
    return ctx.line.text({
      label: "Burn Rate",
      value: formatBurnRate(rate) + "%/hr",
      subtitle: top.label + " · over " + ctx.fmt.resetIn(Math.round(elapsedMs / 1000)),
    })
  }

  function withUsageHistory(ctx, result) {
    if (!result || !Array.isArray(result.lines)) return result

    var nowMs = Date.now()
    var samples = loadHistory(ctx)
    var recorded = recordSample(samples, poolUsageFromLines(result.lines), nowMs)
    if (recorded) {
      saveHistory(ctx, recorded)
      samples = recorded
    }

    var burnRate = burnRateLine(ctx, samples, result.lines, nowMs)
    if (burnRate) result.lines.push(burnRate)

    var points = trendPoints(samples)
    if (points.length >= TREND_MIN_DAYS) {
      result.lines.push(ctx.line.barChart({
        label: "Usage Trend",
        points: points,
        note: "Peak quota used per day, sampled while UsagePal is running.",
        color: "#4285F4",
      }))
    }

    return result
  }

  // --- Cloud Code API ---

  // Set whenever Cloud Code itself misbehaves — unreachable, 5xx, or a body we
  // can't parse — as opposed to rejecting our credentials. It decides which
  // failure message the user sees, so an outage doesn't read as "signed out".
  var sawTransportFailure = false

  function requestCloudCodeJson(ctx, path, token, userAgent, body) {
    for (var i = 0; i < CLOUD_CODE_URLS.length; i++) {
      try {
        var resp = ctx.host.http.request({
          method: "POST",
          url: CLOUD_CODE_URLS[i] + path,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
            "User-Agent": userAgent || "antigravity",
          },
          bodyText: JSON.stringify(body || {}),
          timeoutMs: 15000,
        })
        if (!resp || typeof resp.status !== "number" || !Number.isFinite(resp.status)) {
          ctx.host.log.warn("Cloud Code returned invalid response shape (" + CLOUD_CODE_URLS[i] + ")")
          sawTransportFailure = true
          continue
        }
        if (ctx.util.isAuthStatus(resp.status)) return { _authFailed: true }
        if (resp.status >= 200 && resp.status < 300) {
          var json = ctx.util.tryParseJson(resp.bodyText)
          if (!json || typeof json !== "object") {
            ctx.host.log.warn("Cloud Code returned invalid JSON (" + CLOUD_CODE_URLS[i] + ")")
            sawTransportFailure = true
            continue
          }
          return json
        }
        sawTransportFailure = true
      } catch (e) {
        ctx.host.log.warn("Cloud Code request failed (" + CLOUD_CODE_URLS[i] + "): " + String(e))
        sawTransportFailure = true
      }
    }
    return null
  }

  function probeCloudCode(ctx, token, userAgent) {
    return requestCloudCodeJson(ctx, FETCH_MODELS_PATH, token, userAgent, {})
  }

  function parseCloudCodeModels(data) {
    var modelsObj = data && data.models
    if (!modelsObj || typeof modelsObj !== "object") return []
    var keys = Object.keys(modelsObj)
    var configs = []
    for (var i = 0; i < keys.length; i++) {
      var m = modelsObj[keys[i]]
      if (!m || typeof m !== "object") continue
      if (m.isInternal) continue
      var modelId = m.model || keys[i]
      if (CC_MODEL_BLACKLIST[modelId]) continue
      var displayName =
        (typeof m.displayName === "string" && m.displayName.trim()) ||
        (typeof m.label === "string" && m.label.trim()) ||
        ""
      if (!displayName) continue
      var qi = m.quotaInfo
      var frac = (qi && typeof qi.remainingFraction === "number") ? qi.remainingFraction : 0
      var rtime = (qi && qi.resetTime) || undefined
      configs.push({
        label: displayName,
        quotaInfo: { remainingFraction: frac, resetTime: rtime },
      })
    }
    return configs
  }

  function readAgyPlan(loadData) {
    var paidTier = loadData && loadData.paidTier
    if (paidTier && typeof paidTier.name === "string" && paidTier.name.trim()) {
      return paidTier.name.trim()
    }
    var currentTier = loadData && loadData.currentTier
    if (currentTier && typeof currentTier.name === "string" && currentTier.name.trim()) {
      return currentTier.name.trim()
    }
    return null
  }

  function parseAgyQuotaBuckets(data) {
    var buckets = data && data.buckets
    if (!Array.isArray(buckets)) return []
    var configs = []
    for (var i = 0; i < buckets.length; i++) {
      var bucket = buckets[i]
      if (!bucket || typeof bucket !== "object") continue
      var modelId = (typeof bucket.modelId === "string" && bucket.modelId.trim()) || ""
      if (!modelId) continue
      var frac = (typeof bucket.remainingFraction === "number") ? bucket.remainingFraction : 0
      configs.push({
        label: modelId,
        quotaInfo: { remainingFraction: frac, resetTime: bucket.resetTime || undefined },
      })
    }
    return configs
  }

  function probeAgyCloudCode(ctx, token) {
    var loadData = requestCloudCodeJson(ctx, LOAD_CODE_ASSIST_PATH, token, "agy", {})
    if (!loadData || loadData._authFailed) return loadData

    var project =
      typeof loadData.cloudaicompanionProject === "string" && loadData.cloudaicompanionProject.trim()
        ? loadData.cloudaicompanionProject.trim()
        : null
    var quotaData = null
    if (project) {
      quotaData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_PATH, token, "agy", { project: project })
    }
    if (!quotaData || quotaData._authFailed) {
      quotaData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_PATH, token, "agy", {})
    }
    if (!quotaData || quotaData._authFailed) return quotaData

    var lines = buildModelLines(ctx, parseAgyQuotaBuckets(quotaData))
    if (lines.length === 0) return null
    return { plan: readAgyPlan(loadData), lines: lines }
  }

  // --- LS probe ---

  function probeDiscovery(ctx, discovery) {
    if (!discovery) return null

    var found = findWorkingPort(ctx, discovery)
    if (!found) return null

    ctx.host.log.info("using LS at " + found.scheme + "://127.0.0.1:" + found.port)

    var metadata = {
      ideName: "antigravity",
      extensionName: "antigravity",
      ideVersion: "unknown",
      locale: "en",
    }

    // Try GetUserStatus first, fall back to GetCommandModelConfigs
    var data = null
    try {
      data = callLs(ctx, found.port, found.scheme, discovery.csrf, "GetUserStatus", { metadata: metadata })
    } catch (e) {
      ctx.host.log.warn("GetUserStatus threw: " + String(e))
    }
    var hasUserStatus = data && data.userStatus

    if (!hasUserStatus) {
      ctx.host.log.warn("GetUserStatus failed, trying GetCommandModelConfigs")
      data = callLs(ctx, found.port, found.scheme, discovery.csrf, "GetCommandModelConfigs", { metadata: metadata })
    }

    // Parse model configs
    var configs
    if (hasUserStatus) {
      configs = (data.userStatus.cascadeModelConfigData || {}).clientModelConfigs || []
    } else if (data && data.clientModelConfigs) {
      configs = data.clientModelConfigs
    } else {
      return null
    }

    var filtered = []
    for (var j = 0; j < configs.length; j++) {
      var mid = configs[j].modelOrAlias && configs[j].modelOrAlias.model
      if (mid && CC_MODEL_BLACKLIST[mid]) continue
      filtered.push(configs[j])
    }

    var lines = buildModelLines(ctx, filtered)
    if (lines.length === 0) return null

    var plan = null
    if (hasUserStatus) {
      // Prefer userTier.name (Google's own subscription system) over the legacy
      // planInfo.planName field inherited from Windsurf/Codeium, which always
      // returns "Pro" for all paid tiers including Google AI Ultra.
      var ut = data.userStatus.userTier
      var userTierName =
        ut && typeof ut.name === "string" && ut.name.trim() ? ut.name.trim() : null
      if (userTierName) {
        plan = userTierName
      } else {
        var ps = data.userStatus.planStatus || {}
        var pi = ps.planInfo || {}
        plan =
          typeof pi.planName === "string" && pi.planName.trim() ? pi.planName.trim() : null
      }
    }

    return { plan: plan, lines: lines }
  }

  function probeLs(ctx) {
    return probeDiscovery(ctx, discoverLs(ctx))
  }

  function probeAgyLs(ctx) {
    return probeDiscovery(ctx, discoverAgyLs(ctx))
  }

  // --- Probe ---

  function probe(ctx) {
    sawTransportFailure = false

    var lsResult = probeLs(ctx)
    if (lsResult) return withUsageHistory(ctx, lsResult)

    var agyLsResult = probeAgyLs(ctx)
    if (agyLsResult) return withUsageHistory(ctx, agyLsResult)

    var dbTokenCandidates = loadOAuthTokenCandidates(ctx)

    var tokens = []
    var nowSec = Math.floor(Date.now() / 1000)
    for (var i = 0; i < dbTokenCandidates.length; i++) {
      var dbTokens = dbTokenCandidates[i]
      if (dbTokens.accessToken && (!dbTokens.expirySeconds || dbTokens.expirySeconds > nowSec)) {
        if (tokens.indexOf(dbTokens.accessToken) === -1) tokens.push(dbTokens.accessToken)
      }
    }

    var cached = loadCachedToken(ctx)
    if (cached && tokens.indexOf(cached) === -1) tokens.push(cached)

    var ccData = null
    var sawAuthFailure = false
    for (var i = 0; i < tokens.length; i++) {
      var nextData = probeCloudCode(ctx, tokens[i])
      if (nextData && !nextData._authFailed) {
        ccData = nextData
        break
      }
      if (nextData && nextData._authFailed) sawAuthFailure = true
    }

    // Only refresh on evidence of an auth failure, or when there were no tokens to try.
    // probeCloudCode returns null for transient failures (5xx/timeouts); without this
    // guard a Cloud Code incident would trigger a Google OAuth refresh every probe cycle
    // instead of ~once per token lifetime — risking refresh-token throttling or rotation.
    if (!ccData && (sawAuthFailure || tokens.length === 0)) {
      var refreshTokens = []
      for (var j = 0; j < dbTokenCandidates.length; j++) {
        var refreshToken = dbTokenCandidates[j].refreshToken
        if (refreshToken && refreshTokens.indexOf(refreshToken) === -1) refreshTokens.push(refreshToken)
      }
      for (var k = 0; k < refreshTokens.length; k++) {
        var refreshed = refreshAccessToken(ctx, refreshTokens[k])
        if (!refreshed) continue
        var refreshedData = probeCloudCode(ctx, refreshed)
        if (refreshedData && !refreshedData._authFailed) {
          ccData = refreshedData
          break
        }
        if (refreshedData && refreshedData._authFailed) ccData = refreshedData
      }
    }

    if (!ccData || ccData._authFailed) {
      var agyTokens = loadAgyTokens(ctx)
      for (var a = 0; a < agyTokens.length; a++) {
        var agyResult = probeAgyCloudCode(ctx, agyTokens[a])
        if (agyResult && !agyResult._authFailed) return withUsageHistory(ctx, agyResult)
        if (agyResult && agyResult._authFailed) ccData = agyResult
      }
    }

    if (ccData && !ccData._authFailed) {
      var configs = parseCloudCodeModels(ccData)
      var lines = buildModelLines(ctx, configs)
      if (lines.length > 0) return withUsageHistory(ctx, { plan: null, lines: lines })
    }

    if (sawTransportFailure) throw UNREACHABLE_MESSAGE
    throw LOGIN_MESSAGE
  }

  globalThis.__usagepal_plugin = { id: "antigravity", probe: probe }
})()
