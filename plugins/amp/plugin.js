(function () {
  var SECRETS_FILE = "~/.local/share/amp/secrets.json"
  var SECRETS_KEY = "apiKey@https://ampcode.com/"
  var API_URL = "https://ampcode.com/api/internal"

  function loadApiKey(ctx) {
    if (!ctx.host.fs.exists(SECRETS_FILE)) return null
    try {
      var text = ctx.host.fs.readText(SECRETS_FILE)
      var parsed = ctx.util.tryParseJson(text)
      if (parsed && parsed[SECRETS_KEY]) {
        ctx.host.log.info("api key loaded from secrets file")
        return parsed[SECRETS_KEY]
      }
    } catch (e) {
      ctx.host.log.warn("secrets file read failed: " + String(e))
    }
    return null
  }

  function fetchBalanceInfo(ctx, apiKey) {
    return ctx.util.requestJson({
      method: "POST",
      url: API_URL,
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      bodyText: JSON.stringify({ method: "userDisplayBalanceInfo", params: {} }),
      timeoutMs: 15000,
    })
  }

  function parseMoney(s) {
    return Number(s.replace(/,/g, ""))
  }

  function parseBalanceText(text) {
    if (!text || typeof text !== "string") return null

    var result = {
      credits: null,
      subscriptionPlan: null,
      agentRemainingPct: null,
      orbRemainingPct: null,
    }

    var creditsMatch = text.match(/Individual credits: \$([0-9][0-9,]*(?:\.[0-9]+)?) remaining/)
    if (creditsMatch) {
      var credits = parseMoney(creditsMatch[1])
      if (Number.isFinite(credits)) result.credits = credits
    }

    var tierMatch = text.match(/^Amp ([^:\r\n]+?) Tier:\s*([^\r\n]*)/m)
    if (tierMatch) {
      var agentMatch = tierMatch[2].match(/\bagent usage\b.*?\(([0-9]+(?:\.[0-9]+)?)%\)/)
      var orbMatch = tierMatch[2].match(/\borb usage\b.*?\(([0-9]+(?:\.[0-9]+)?)%\)/)
      var agentRemainingPct = agentMatch ? Number(agentMatch[1]) : NaN
      var orbRemainingPct = orbMatch ? Number(orbMatch[1]) : NaN
      if (Number.isFinite(agentRemainingPct) && Number.isFinite(orbRemainingPct)) {
        result.subscriptionPlan = tierMatch[1].trim()
        result.agentRemainingPct = agentRemainingPct
        result.orbRemainingPct = orbRemainingPct
      }
    }

    if (result.credits === null && result.subscriptionPlan === null) return null

    return result
  }

  function probe(ctx) {
    var apiKey = loadApiKey(ctx)
    if (!apiKey) {
      throw "Amp not installed. Install Amp Code to get started."
    }

    var result
    try {
      result = fetchBalanceInfo(ctx, apiKey)
    } catch (e) {
      ctx.host.log.error("balance info request failed: " + String(e))
      throw "Request failed. Check your connection."
    }

    var resp = result.resp
    var json = result.json

    if (resp.status === 401 || resp.status === 403) {
      throw "Session expired. Re-authenticate in Amp Code."
    }
    if (resp.status < 200 || resp.status >= 300) {
      var detail = json && json.error && json.error.message ? json.error.message : ""
      if (detail) {
        ctx.host.log.error("api returned " + resp.status + ": " + detail)
        throw detail
      }
      ctx.host.log.error("api returned: " + resp.status)
      throw "Request failed (HTTP " + resp.status + "). Try again later."
    }

    if (!json || !json.ok || !json.result || !json.result.displayText) {
      ctx.host.log.error("unexpected response structure")
      throw "Could not parse usage data."
    }

    var balance = parseBalanceText(json.result.displayText)
    if (!balance) {
      if (/Amp [^:\r\n]+ Tier:/.test(json.result.displayText)) {
        ctx.host.log.error("failed to parse Amp usage display text")
        throw "Could not parse usage data."
      }
      ctx.host.log.warn("no balance data found, assuming credits-only")
      balance = { credits: 0, subscriptionPlan: null, agentRemainingPct: null, orbRemainingPct: null }
    } else if (/Amp [^:\r\n]+ Tier:/.test(json.result.displayText) && balance.subscriptionPlan === null) {
      ctx.host.log.error("failed to parse Amp subscription display text")
      throw "Could not parse usage data."
    }

    var lines = []
    var plan = balance.subscriptionPlan || "Credits"

    if (balance.subscriptionPlan !== null) {
      lines.push(ctx.line.progress({
        label: "Agent Usage",
        used: Math.min(100, Math.max(0, 100 - balance.agentRemainingPct)),
        limit: 100,
        format: { kind: "percent" },
      }))
      lines.push(ctx.line.progress({
        label: "Orb Usage",
        used: Math.min(100, Math.max(0, 100 - balance.orbRemainingPct)),
        limit: 100,
        format: { kind: "percent" },
      }))
    }

    if (balance.credits !== null && (balance.credits > 0 || balance.subscriptionPlan === null)) {
      lines.push(ctx.line.text({
        label: "Credits",
        value: "$" + balance.credits.toFixed(2),
      }))
    }

    return { plan: plan, lines: lines }
  }

  globalThis.__usagepal_plugin = { id: "amp", probe: probe }
})()
