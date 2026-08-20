import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const SECRETS_FILE = "~/.local/share/amp/secrets.json"
const SECRETS_KEY = "apiKey@https://ampcode.com/"
const API_URL = "https://ampcode.com/api/internal"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__usagepal_plugin
}

function writeSecrets(ctx, apiKey) {
  var obj = {}
  obj[SECRETS_KEY] = apiKey || "test-api-key"
  ctx.host.fs.writeText(SECRETS_FILE, JSON.stringify(obj))
}

function balanceResponse(displayText) {
  return {
    status: 200,
    bodyText: JSON.stringify({ ok: true, result: { displayText: displayText } }),
  }
}

describe("amp plugin", () => {
  beforeEach(() => {
    delete globalThis.__usagepal_plugin
    vi.resetModules()
  })

  // --- Auth ---

  it("throws when secrets file not found", async () => {
    var ctx = makeCtx()
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Amp not installed")
  })

  it("throws when secrets file has no api key", async () => {
    var ctx = makeCtx()
    ctx.host.fs.writeText(SECRETS_FILE, JSON.stringify({ other: "value" }))
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Amp not installed")
  })

  it("throws on invalid JSON in secrets file", async () => {
    var ctx = makeCtx()
    ctx.host.fs.writeText(SECRETS_FILE, "{bad json")
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Amp not installed")
  })

  // --- API request ---

  it("sends POST with Bearer auth to api/internal", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx, "my-api-key")
    ctx.host.http.request.mockReturnValue(balanceResponse("Individual credits: $0 remaining"))
    var plugin = await loadPlugin()
    plugin.probe(ctx)
    var call = ctx.host.http.request.mock.calls[0][0]
    expect(call.method).toBe("POST")
    expect(call.url).toBe(API_URL)
    expect(call.headers.Authorization).toBe("Bearer my-api-key")
    expect(call.headers["Content-Type"]).toBe("application/json")
    var body = JSON.parse(call.bodyText)
    expect(body.method).toBe("userDisplayBalanceInfo")
    expect(body.params).toEqual({})
  })

  // --- HTTP errors ---

  it("throws on HTTP 401", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue({ status: 401, bodyText: "" })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Session expired")
  })

  it("throws on HTTP 403", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue({ status: 403, bodyText: "" })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Session expired")
  })

  it("throws with error detail on non-2xx with JSON error", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 402,
      bodyText: JSON.stringify({ error: { message: "Credits required for this feature." } }),
    })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Credits required for this feature.")
  })

  it("throws generic error on HTTP 500", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue({ status: 500, bodyText: "" })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Request failed (HTTP 500)")
  })

  it("throws on network error", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockImplementation(() => { throw new Error("ECONNREFUSED") })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Request failed. Check your connection.")
  })

  // --- Response structure errors ---

  it("throws when response has no ok field", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue({ status: 200, bodyText: JSON.stringify({ result: {} }) })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Could not parse usage data")
  })

  it("throws when response has no displayText", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({ ok: true, result: {} }),
    })
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Could not parse usage data")
  })

  // --- Balance parsing ---

  it("parses subscription usage pools", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    var text = "Signed in as user@test.com (testuser)\n"
      + "Subscription Megawatt: 100% other usage and 100% orb usage remaining"
    ctx.host.http.request.mockReturnValue(balanceResponse(text))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    expect(result.plan).toBe("Megawatt")
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toMatchObject({
      type: "progress",
      label: "Subscription Usage",
      used: 0,
      limit: 100,
      format: { kind: "percent" },
    })
    expect(result.lines[1]).toMatchObject({
      type: "progress",
      label: "Orb Usage",
      used: 0,
      limit: 100,
      format: { kind: "percent" },
    })
  })

  it("throws when subscription usage is present but unparseable", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    var text = "Subscription Megawatt: unparseable data"
    ctx.host.http.request.mockReturnValue(balanceResponse(text))
    var plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Could not parse usage data")
  })

  it("includes credits text line when credits > 0", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue(balanceResponse("Individual credits: $5.50 remaining"))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    var creditsLine = result.lines.find(function (l) { return l.label === "Credits" })
    expect(creditsLine).toBeTruthy()
    expect(creditsLine.value).toBe("$5.50")
  })

  it("shows credits line when credits-only balance is zero", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue(balanceResponse("Individual credits: $0 remaining"))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    var creditsLine = result.lines.find(function (l) { return l.label === "Credits" })
    expect(creditsLine.value).toBe("$0.00")
  })

  // --- Credits only ---

  it("handles credits-only user", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    var text = "Signed in as user@test.com (testuser)\nIndividual credits: $25.50 remaining - https://ampcode.com/settings"
    ctx.host.http.request.mockReturnValue(balanceResponse(text))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    expect(result.plan).toBe("Credits")
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].label).toBe("Credits")
    expect(result.lines[0].value).toBe("$25.50")
  })

  it("parses credits-only text with top-up hint", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    var text = "Signed in as person@example.com (exampleuser)\n"
      + "Individual credits: $5 remaining (set up automatic top-up to avoid running out) - https://ampcode.com/settings"
    ctx.host.http.request.mockReturnValue(balanceResponse(text))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    expect(result.plan).toBe("Credits")
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].label).toBe("Credits")
    expect(result.lines[0].value).toBe("$5.00")
  })

  it("falls back to credits-only when no balance or credits parsed", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    ctx.host.http.request.mockReturnValue(balanceResponse("Signed in as user@test.com (testuser)"))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    expect(result.plan).toBe("Credits")
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].label).toBe("Credits")
    expect(result.lines[0].value).toBe("$0.00")
  })

  // --- Credits-only $0 ---

  it("shows $0.00 for credits-only user with zero balance", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    var text = "Signed in as user@test.com (testuser)\nIndividual credits: $0 remaining - https://ampcode.com/settings"
    ctx.host.http.request.mockReturnValue(balanceResponse(text))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    expect(result.plan).toBe("Credits")
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].label).toBe("Credits")
    expect(result.lines[0].value).toBe("$0.00")
  })

  it("parses credits with comma-formatted amounts", async () => {
    var ctx = makeCtx()
    writeSecrets(ctx)
    var text = "Signed in as user@test.com (testuser)\n"
      + "Individual credits: $1,000.50 remaining - https://ampcode.com/settings"
    ctx.host.http.request.mockReturnValue(balanceResponse(text))
    var plugin = await loadPlugin()
    var result = plugin.probe(ctx)
    expect(result.lines[0].value).toBe("$1000.50")
  })
})
