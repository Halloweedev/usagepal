import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const AUTH_PATH = "~/.grok/auth.json"
const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing"
const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
const REFRESH_URL = "https://auth.x.ai/oauth2/token"

const loadPlugin = async () => {
  await import("./plugin.js?test=" + Math.random())
  return globalThis.__openusage_plugin
}

function writeAuth(ctx, entry) {
  const auth = {}
  auth["https://auth.x.ai::client"] = entry || {
    key: "test-token",
    email: "user@example.com",
    expires_at: "2026-06-01T00:00:00Z",
  }
  ctx.host.fs.writeText(AUTH_PATH, JSON.stringify(auth))
}

function billingData(overrides) {
  const config = Object.assign({
    monthlyLimit: { val: 60000 },
    used: { val: 4277 },
    onDemandCap: { val: 0 },
    billingPeriodStart: "2026-05-01T00:00:00+00:00",
    billingPeriodEnd: "2026-06-01T00:00:00+00:00",
    history: [
      {
        billingCycle: { year: 2026, month: 4 },
        includedUsed: { val: 1234 },
        onDemandUsed: { val: 200 },
        totalUsed: { val: 1434 },
      },
      {
        billingCycle: { year: 2026, month: 3 },
        includedUsed: { val: 0 },
        onDemandUsed: { val: 0 },
        totalUsed: { val: 0 },
      },
    ],
  }, overrides || {})
  return { config }
}

function mockGrokApi(ctx, data, settings) {
  ctx.host.http.request.mockImplementation((req) => {
    if (req.url === BILLING_URL) {
      return {
        status: 200,
        bodyText: JSON.stringify(data || billingData()),
      }
    }
    if (req.url === SETTINGS_URL) {
      return settings || {
        status: 200,
        bodyText: JSON.stringify({ subscription_tier_display: "SuperGrok Heavy" }),
      }
    }
    return { status: 404, bodyText: "" }
  })
}

describe("grok plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
  })

  it("throws when auth file is missing", async () => {
    const ctx = makeCtx()
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok not logged in. Run `grok login`.")
  })

  it("throws when auth file has no usable token", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(AUTH_PATH, JSON.stringify({ account: { email: "user@example.com" } }))
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok auth invalid. Run `grok login` again.")
  })

  it("throws when the only token is expired and no refresh token is available", async () => {
    const ctx = makeCtx()
    writeAuth(ctx, {
      key: "expired-token",
      email: "user@example.com",
      expires_at: "2026-01-01T00:00:00Z",
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok auth expired. Run `grok login` again.")
  })

  it("refreshes an expired Grok CLI token and persists rotated auth", async () => {
    const ctx = makeCtx()
    writeAuth(ctx, {
      key: "expired-token",
      refresh_token: "refresh-token",
      email: "user@example.com",
      oidc_client_id: "client-id",
      expires_at: "2026-01-01T00:00:00Z",
    })
    ctx.host.http.request.mockImplementation((req) => {
      if (req.url === REFRESH_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            access_token: "new-token",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
        }
      }
      if (req.url === BILLING_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify(billingData()),
        }
      }
      if (req.url === SETTINGS_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify({ subscription_tier_display: "SuperGrok Heavy" }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("SuperGrok Heavy")
    expect(ctx.host.http.request.mock.calls[0][0].url).toBe(REFRESH_URL)
    expect(ctx.host.http.request.mock.calls[0][0].bodyText).toContain("client_id=client-id")
    expect(ctx.host.http.request.mock.calls[0][0].bodyText).toContain("refresh_token=refresh-token")
    const billingCall = ctx.host.http.request.mock.calls.find((call) => call[0].url === BILLING_URL)[0]
    expect(billingCall.headers.Authorization).toBe("Bearer new-token")

    const authWrites = ctx.host.fs.writeText.mock.calls.filter((call) => call[0] === AUTH_PATH)
    const saved = JSON.parse(authWrites[authWrites.length - 1][1])
    const entry = saved["https://auth.x.ai::client"]
    expect(entry.key).toBe("new-token")
    expect(entry.refresh_token).toBe("new-refresh")
    expect(entry.expires_at).toBe("2026-02-02T01:00:00.000Z")
  })

  it("refreshes and retries once when billing returns an auth error", async () => {
    const ctx = makeCtx()
    writeAuth(ctx, {
      key: "old-token",
      refresh_token: "refresh-token",
      email: "user@example.com",
      expires_at: "2026-06-01T00:00:00Z",
    })
    let billingCalls = 0
    ctx.host.http.request.mockImplementation((req) => {
      if (req.url === BILLING_URL) {
        billingCalls += 1
        if (billingCalls === 1) return { status: 401, bodyText: "" }
        return {
          status: 200,
          bodyText: JSON.stringify(billingData()),
        }
      }
      if (req.url === REFRESH_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            access_token: "new-token",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
        }
      }
      if (req.url === SETTINGS_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify({ subscription_tier_display: "SuperGrok Heavy" }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("SuperGrok Heavy")
    const billingAuths = ctx.host.http.request.mock.calls
      .filter((call) => call[0].url === BILLING_URL)
      .map((call) => call[0].headers.Authorization)
    expect(billingAuths).toEqual(["Bearer old-token", "Bearer new-token"])
    const refreshCall = ctx.host.http.request.mock.calls.find((call) => call[0].url === REFRESH_URL)[0]
    expect(refreshCall.bodyText).toContain("client_id=client")
    expect(refreshCall.bodyText).toContain("refresh_token=refresh-token")
  })

  it("uses a still-valid token when proactive refresh is unauthorized", async () => {
    const ctx = makeCtx()
    writeAuth(ctx, {
      key: "old-token",
      refresh_token: "refresh-token",
      email: "user@example.com",
      expires_at: "2026-02-02T00:04:00Z",
    })
    ctx.host.http.request.mockImplementation((req) => {
      if (req.url === REFRESH_URL) {
        return {
          status: 401,
          bodyText: JSON.stringify({ error: "invalid_grant" }),
        }
      }
      if (req.url === BILLING_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify(billingData()),
        }
      }
      if (req.url === SETTINGS_URL) {
        return {
          status: 200,
          bodyText: JSON.stringify({ subscription_tier_display: "SuperGrok Heavy" }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("SuperGrok Heavy")
    const billingCall = ctx.host.http.request.mock.calls.find((call) => call[0].url === BILLING_URL)[0]
    expect(billingCall.headers.Authorization).toBe("Bearer old-token")
  })

  it("uses the first non-expired token", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(AUTH_PATH, JSON.stringify({
      expired: {
        key: "expired-token",
        expires_at: "2026-01-01T00:00:00Z",
      },
      active: {
        key: "active-token",
        email: "active@example.com",
        expires_at: "2026-06-01T00:00:00Z",
      },
    }))
    mockGrokApi(ctx)

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("SuperGrok Heavy")
    expect(ctx.host.http.request.mock.calls[0][0].headers.Authorization).toBe("Bearer active-token")
  })

  it("requests the CLI billing endpoint with Grok CLI headers", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx)

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.method).toBe("GET")
    expect(call.url).toBe(BILLING_URL)
    expect(call.headers.Authorization).toBe("Bearer test-token")
    expect(call.headers["X-XAI-Token-Auth"]).toBe("xai-grok-cli")
    expect(call.headers.Accept).toBe("application/json")
  })

  it("renders credits used as percent progress", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx)

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Credits used")

    expect(line.type).toBe("progress")
    expect(line.used).toBeCloseTo(7.128, 3)
    expect(line.limit).toBe(100)
    expect(line.format).toEqual({ kind: "percent" })
    expect(line.resetsAt).toBe("2026-06-01T00:00:00.000Z")
  })

  it("does not render duplicate reset or billing detail rows", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx)

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((l) => l.label === "Resets")).toBeUndefined()
    expect(result.lines.find((l) => l.label === "Current period")).toBeUndefined()
    expect(result.lines.find((l) => l.label === "Billing cycle")).toBeUndefined()
  })

  it("renders pay as you go disabled when cap is zero", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData({ onDemandCap: { val: 0 } }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Pay as you go")

    expect(line.type).toBe("badge")
    expect(line.text).toBe("Disabled")
    expect(line.color).toBe("#a3a3a3")
  })

  it("renders pay as you go cap when enabled", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData({ onDemandCap: { val: "2500" } }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Pay as you go")

    expect(line.text).toBe("2500 cap")
    expect(line.color).toBe("#22c55e")
  })

  it("parses billing values provided as strings", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData({
      monthlyLimit: { val: "10000" },
      used: { val: "2500" },
      onDemandCap: { val: "0" },
    }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((l) => l.label === "Credits used").used).toBe(25)
    expect(result.lines.find((l) => l.label === "Current period")).toBeUndefined()
  })

  it("reads the plan name from settings instead of auth email", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData(), {
      status: 200,
      bodyText: JSON.stringify({ subscription_tier_display: "SuperGrok Heavy" }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const settingsCall = ctx.host.http.request.mock.calls.find((call) => call[0].url === SETTINGS_URL)[0]
    expect(settingsCall.headers.Authorization).toBe("Bearer test-token")
    expect(settingsCall.headers["X-XAI-Token-Auth"]).toBe("xai-grok-cli")
    expect(result.plan).toBe("SuperGrok Heavy")
  })

  it("shows base SuperGrok subscription tier from settings", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData(), {
      status: 200,
      bodyText: JSON.stringify({ subscription_tier_display: "SuperGrok" }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("SuperGrok")
  })

  it("treats missing onDemandCap as disabled for subscription-only billing", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData({ onDemandCap: undefined }))

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const line = result.lines.find((l) => l.label === "Pay as you go")

    expect(line.text).toBe("Disabled")
    expect(line.color).toBe("#a3a3a3")
  })

  it("omits the plan label when settings does not include a plan", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, billingData(), {
      status: 200,
      bodyText: JSON.stringify({ release_channel: "stable" }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe(null)
  })

  it("throws when billing request returns auth error", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    ctx.host.http.request.mockReturnValue({ status: 401, bodyText: "" })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok auth expired. Run `grok login` again.")
  })

  it("throws on billing HTTP error", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    ctx.host.http.request.mockReturnValue({ status: 500, bodyText: "" })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok billing request failed (HTTP 500). Try again later.")
  })

  it("throws on billing network error", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    ctx.host.http.request.mockImplementation(() => {
      throw new Error("offline")
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok billing request failed. Check your connection.")
  })

  it("throws on invalid billing JSON", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    ctx.host.http.request.mockReturnValue({ status: 200, bodyText: "not-json" })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok billing response changed.")
  })

  it("throws on unexpected billing response shape", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx, { config: { used: { val: 1 } } })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Grok billing response changed.")
  })
})

describe("grok spend aggregation", () => {
  const LOG_PATH = "~/.grok/logs/unified.jsonl"

  beforeEach(() => {
    delete globalThis.__openusage_plugin
  })

  function inferenceLine(ts, pid, tokens) {
    return JSON.stringify({
      msg: "shell.turn.inference_done",
      ts,
      pid,
      ctx: {
        prompt_tokens: tokens.prompt,
        cached_prompt_tokens: tokens.cached || 0,
        completion_tokens: tokens.completion || 0,
        reasoning_tokens: tokens.reasoning || 0,
      },
    })
  }

  function modelLine(pid, model) {
    return JSON.stringify({ msg: "model changed", pid, ctx: { model } })
  }

  it("resolves grok-build alias to grok-build-0.1 pricing", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.resolveModelRates("grok-build")).toEqual(
      plugin.__test.GROK_PRICING.models["grok-build-0.1"],
    )
  })

  it("keeps token rows for unknown models with zero cost", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const plugin = await loadPlugin()
      const text = [
        modelLine(42, "grok-4.5"),
        inferenceLine("2026-07-01T01:00:00.000Z", 42, { prompt: 1_000_000, completion: 100_000 }),
        modelLine(99, "totally-unknown-model"),
        inferenceLine("2026-07-01T02:00:00.000Z", 99, { prompt: 500_000, completion: 50_000 }),
      ].join("\n")

      const ctx = makeCtx()
      const sinceMs = Date.parse("2026-06-01T00:00:00.000Z")
      const rows = plugin.__test.buildUsageRowsFromLog(ctx, text, sinceMs)
      expect(rows).toHaveLength(2)
      expect(rows[0].cost).toBeGreaterThan(0)
      expect(rows[1].model).toBe("totally-unknown-model")
      expect(rows[1].tokens).toBe(550_000)
      expect(rows[1].cost).toBe(0)

      const modelUsage = plugin.__test.aggregateModelUsageFromRows(rows, Date.now())
      expect(modelUsage.totalTokens30d).toBe(1_650_000)
      const unknown = modelUsage.models.find((m) => m.name === "totally-unknown-model")
      expect(unknown).toBeDefined()
      expect(unknown.tokens.Today).toBe(550_000)
      expect(unknown.costUSD.Today).toBe(0)

      const lines = []
      ctx.host.fs.writeText(LOG_PATH, text)
      plugin.__test.appendSpendHistory(ctx, lines, Date.now())
      const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]))
      expect(byLabel["Today"].value).toContain("1.6M")
      expect(byLabel["Today"].value).toContain("$")
      expect(byLabel["Totally Unknown Model"].value).toContain("%")
      expect(byLabel["Totally Unknown Model"].value).not.toMatch(/Today \$/)
    } finally {
      vi.useRealTimers()
    }
  })

  it("builds usage rows from unified.jsonl with per-pid model attribution", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const plugin = await loadPlugin()
      const text = [
        modelLine(42, "grok-4.5"),
        inferenceLine("2026-07-01T01:00:00.000Z", 42, { prompt: 1_000_000, completion: 100_000 }),
        modelLine(99, "grok-4.5-fast"),
        inferenceLine("2026-06-30T01:00:00.000Z", 99, { prompt: 2_000_000, completion: 200_000 }),
      ].join("\n")

      const ctx = makeCtx()
      const sinceMs = Date.parse("2026-06-01T00:00:00.000Z")
      const rows = plugin.__test.buildUsageRowsFromLog(ctx, text, sinceMs)
      expect(rows).toHaveLength(2)
      expect(rows[0].model).toBe("grok-4.5")
      expect(rows[0].tokens).toBe(1_100_000)
      expect(rows[0].cost).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("appendSpendHistory adds Today/Yesterday/Last 30 Days from local log", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const ctx = makeCtx()
      const plugin = await loadPlugin()
      ctx.host.fs.writeText(
        LOG_PATH,
        [
          modelLine(1, "grok-4.5"),
          inferenceLine("2026-07-01T01:00:00.000Z", 1, { prompt: 1_000_000, completion: 0 }),
          modelLine(2, "grok-4.5"),
          inferenceLine("2026-06-30T01:00:00.000Z", 2, { prompt: 2_000_000, completion: 0 }),
        ].join("\n"),
      )

      const lines = []
      plugin.__test.appendSpendHistory(ctx, lines, Date.now())

      const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]))
      expect(byLabel["Today"].value).toContain("1M")
      expect(byLabel["Yesterday"].value).toContain("2M")
      expect(byLabel["Last 30 Days"].value).toContain("3M")
      expect(byLabel["Usage Trend"].type).toBe("barChart")
      expect(byLabel["Grok 4.5"].value).toContain("100%")
    } finally {
      vi.useRealTimers()
    }
  })

  it("gracefully skips share-graph lines when the log is missing", async () => {
    const ctx = makeCtx()
    writeAuth(ctx)
    mockGrokApi(ctx)

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((l) => l.label === "Today")).toBeUndefined()
    expect(result.lines.find((l) => l.label === "Credits used")).toBeDefined()
  })

  it("appends share-graph lines to a successful probe when log exists", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const ctx = makeCtx()
      writeAuth(ctx)
      mockGrokApi(ctx)
      ctx.host.fs.writeText(
        LOG_PATH,
        [
          modelLine(1, "grok-4.5"),
          inferenceLine("2026-07-01T01:00:00.000Z", 1, { prompt: 500_000, completion: 0 }),
        ].join("\n"),
      )

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const labels = result.lines.map((line) => line.label)

      expect(labels).toEqual(
        expect.arrayContaining(["Today", "Yesterday", "Last 30 Days", "Usage Trend", "Grok 4.5"]),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  function setOpenCodeXaiQuery(ctx, rows) {
    const list = Array.isArray(rows) ? rows : []
    ctx.host.sqlite.query.mockImplementation((dbPath, sql) => {
      expect(dbPath).toBe("~/.local/share/opencode/opencode.db")
      expect(String(sql)).toContain("json_extract(data, '$.providerID') = 'xai'")
      expect(String(sql)).not.toContain("opencode-go")
      expect(String(sql)).toContain("json_extract(data, '$.role') = 'assistant'")
      return JSON.stringify(list)
    })
  }

  function openCodeXaiRow(overrides) {
    return Object.assign(
      {
        createdMs: Date.parse("2026-07-01T03:00:00.000Z"),
        cost: 0.5,
        modelID: "grok-4.5",
        tokensInput: 100_000,
        tokensOutput: 10_000,
        tokensReasoning: 0,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensTotal: 110_000,
      },
      overrides || {},
    )
  }

  it("OpenCode-only xAI history produces Today and model lines", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const ctx = makeCtx()
      ctx.nowIso = "2026-07-01T12:00:00.000Z"
      writeAuth(ctx, {
        key: "test-token",
        email: "user@example.com",
        expires_at: "2026-08-01T00:00:00Z",
      })
      mockGrokApi(ctx)
      setOpenCodeXaiQuery(ctx, [
        openCodeXaiRow({
          createdMs: Date.parse("2026-07-01T04:00:00.000Z"),
          cost: 1.25,
          modelID: "grok-4.5",
          tokensTotal: 220_000,
        }),
        openCodeXaiRow({
          createdMs: Date.parse("2026-06-30T04:00:00.000Z"),
          cost: 0.75,
          modelID: "grok-4.5",
          tokensTotal: 80_000,
        }),
      ])

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const byLabel = Object.fromEntries(result.lines.map((l) => [l.label, l]))

      expect(byLabel["Today"].value).toContain("220K")
      expect(byLabel["Today"].value).toContain("$1.25")
      expect(byLabel["Yesterday"].value).toContain("80K")
      expect(byLabel["Last 30 Days"].value).toContain("300K")
      expect(byLabel["Last 30 Days"].value).toContain("$2.00")
      expect(byLabel["Grok 4.5"].value).toContain("100%")
      expect(byLabel["Grok 4.5"].value).toContain("Today $1.25")
    } finally {
      vi.useRealTimers()
    }
  })

  it("CLI-only spend still works when OpenCode has no xAI rows", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const ctx = makeCtx()
      ctx.nowIso = "2026-07-01T12:00:00.000Z"
      writeAuth(ctx, {
        key: "test-token",
        email: "user@example.com",
        expires_at: "2026-08-01T00:00:00Z",
      })
      mockGrokApi(ctx)
      setOpenCodeXaiQuery(ctx, [])
      ctx.host.fs.writeText(
        LOG_PATH,
        [
          modelLine(1, "grok-4.5"),
          inferenceLine("2026-07-01T01:00:00.000Z", 1, { prompt: 1_000_000, completion: 0 }),
        ].join("\n"),
      )

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const byLabel = Object.fromEntries(result.lines.map((l) => [l.label, l]))

      expect(byLabel["Today"].value).toContain("1M")
      expect(byLabel["Grok 4.5"].value).toContain("100%")
    } finally {
      vi.useRealTimers()
    }
  })

  it("merge prefers CLI for overlapping UTC days and does not double-count", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const plugin = await loadPlugin()
      const cliRows = [
        {
          createdMs: Date.parse("2026-07-01T01:00:00.000Z"),
          cost: 2.0,
          model: "grok-4.5",
          tokens: 1_000_000,
        },
        {
          createdMs: Date.parse("2026-06-30T01:00:00.000Z"),
          cost: 1.0,
          model: "grok-4.5",
          tokens: 500_000,
        },
      ]
      const openCodeRows = [
        {
          createdMs: Date.parse("2026-07-01T05:00:00.000Z"),
          cost: 99.0,
          model: "grok-4.5",
          tokens: 9_000_000,
        },
        {
          createdMs: Date.parse("2026-06-29T05:00:00.000Z"),
          cost: 0.5,
          model: "grok-4.5",
          tokens: 100_000,
        },
      ]

      const merged = plugin.__test.mergeUsageRowsByDay(cliRows, openCodeRows)
      expect(merged).toHaveLength(3)
      expect(merged.some((r) => r.cost === 99.0)).toBe(false)
      expect(merged.some((r) => r.tokens === 100_000)).toBe(true)

      const daily = plugin.__test.aggregateDailyFromRows(merged, Date.now())
      const byDate = Object.fromEntries(daily.map((d) => [d.date, d]))
      expect(byDate["2026-07-01"].totalTokens).toBe(1_000_000)
      expect(byDate["2026-07-01"].costUSD).toBe(2.0)
      expect(byDate["2026-06-30"].totalTokens).toBe(500_000)
      expect(byDate["2026-06-29"].totalTokens).toBe(100_000)

      const ctx = makeCtx()
      ctx.nowIso = "2026-07-01T12:00:00.000Z"
      writeAuth(ctx, {
        key: "test-token",
        email: "user@example.com",
        expires_at: "2026-08-01T00:00:00Z",
      })
      mockGrokApi(ctx)
      setOpenCodeXaiQuery(ctx, [
        openCodeXaiRow({
          createdMs: Date.parse("2026-07-01T05:00:00.000Z"),
          cost: 99.0,
          modelID: "grok-4.5",
          tokensTotal: 9_000_000,
        }),
        openCodeXaiRow({
          createdMs: Date.parse("2026-06-29T05:00:00.000Z"),
          cost: 0.5,
          modelID: "grok-4.5",
          tokensTotal: 100_000,
        }),
      ])
      ctx.host.fs.writeText(
        LOG_PATH,
        [
          modelLine(1, "grok-4.5"),
          inferenceLine("2026-07-01T01:00:00.000Z", 1, { prompt: 1_000_000, completion: 0 }),
          modelLine(2, "grok-4.5"),
          inferenceLine("2026-06-30T01:00:00.000Z", 2, { prompt: 500_000, completion: 0 }),
        ].join("\n"),
      )

      const result = plugin.probe(ctx)
      const byLabel = Object.fromEntries(result.lines.map((l) => [l.label, l]))
      expect(byLabel["Today"].value).toContain("1M")
      expect(byLabel["Today"].value).not.toContain("9M")
      expect(byLabel["Last 30 Days"].value).toContain("1.6M")
      expect(byLabel["Last 30 Days"].value).not.toContain("9M")
      expect(byLabel["Last 30 Days"].value).not.toContain("$99")
    } finally {
      vi.useRealTimers()
    }
  })

  it("prettify keeps grok-4.5 consistent across CLI and OpenCode model IDs", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.prettifyGrokModelName("grok-4.5")).toBe("Grok 4.5")
  })
})
