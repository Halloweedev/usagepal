import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

// Far-future expiry so normal tests don't trigger the refresh path.
const FAR_FUTURE_EXPIRES_AT = Date.now() + 365 * 24 * 60 * 60 * 1000

const buildProvidersJson = (overrides = {}) => {
  const auth = {
    accessToken: "workos:eyJtesttoken123",
    refreshToken: "refresh123",
    expiresAt: FAR_FUTURE_EXPIRES_AT,
    accountId: "usr-test123",
    ...overrides,
  }
  return JSON.stringify({
    version: 1,
    providers: {
      cline: {
        settings: { provider: "cline", auth },
        tokenSource: "oauth",
      },
    },
  })
}

const PROVIDERS_JSON = buildProvidersJson()

const mockConfigFile = (ctx, json = PROVIDERS_JSON) => {
  const files = new Map()
  files.set("~/.cline/data/settings/providers.json", json)
  ctx.host.fs.exists = (path) => files.has(path)
  ctx.host.fs.readText = (path) => files.get(path)
  ctx.host.fs.writeText = vi.fn((path, text) => files.set(path, text))
}

const mockEnvKey = (ctx, key) => {
  ctx.host.env.get.mockImplementation((name) => (name === "CLINE_API_KEY" ? key : null))
}

const mockUsagePalKeyFile = (ctx, text = JSON.stringify({ apiKey: "usagepal-cline-key" })) => {
  const path = "~/.config/usagepal/cline-pass.json"
  ctx.host.fs.exists = (p) => p === path
  ctx.host.fs.readText = (p) => (p === path ? text : null)
}

const ME_RESPONSE = { id: "usr-abc123", email: "test@test.com", displayName: "Test" }
// Balance is in micro-USD: 500000 = $0.50
const BALANCE_RESPONSE = { balance: 500000, userId: "usr-abc123" }

const PLAN_RESPONSE = {
  subscriptionId: "sub-123",
  currentPeriodStart: "2026-07-01T00:00:00.000Z",
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  plan: {
    displayName: "Cline Pass (Monthly)",
    pricePerSeatCents: 999,
    entitlements: {
      cline_pass: {
        enabled: true,
        inferenceCapThreshold: {
          last5HoursUsageCostUSDPerUser: 1000000000,
          last7daysUsageCostUSDPerUser: 2500000000,
          last30daysUsageCostUSDPerUser: 5000000000,
        },
      },
    },
  },
}

// Pre-computed usage limits from /api/v1/users/me/plan/usage-limits.
// The Cline dashboard uses this same endpoint.
const USAGE_LIMITS_RESPONSE = {
  limits: [
    { type: "five_hour", percentUsed: 63, resetsAt: "2026-07-04T14:36:35Z" },
    { type: "weekly", percentUsed: 60, resetsAt: "2026-07-10T15:57:15Z" },
    { type: "monthly", percentUsed: 30, resetsAt: "2026-08-02T15:57:15Z" },
  ],
}

// Usage transaction costs are in micro-USD (same unit as balance).
const USAGES_RESPONSE = {
  items: [
    {
      id: "tx-1",
      createdAt: "2026-07-04T10:00:00.000Z",
      aiInferenceProviderName: "anthropic",
      aiModelName: "claude-sonnet-4-6",
      costUsd: 1_500_000,
      totalTokens: 1_000_000,
      promptTokens: 700_000,
      completionTokens: 300_000,
    },
    {
      id: "tx-2",
      createdAt: "2026-07-03T10:00:00.000Z",
      aiInferenceProviderName: "openai",
      aiModelName: "gpt-5.4",
      costUsd: 2_000_000,
      totalTokens: 2_000_000,
      promptTokens: 1_500_000,
      completionTokens: 500_000,
    },
  ],
}

const NOW_ISO = "2026-07-04T12:00:00.000Z"

const REFRESH_RESPONSE = {
  access_token: "eyJrefreshedtoken456",
  refresh_token: "refresh456",
  expires_in: 3600,
}

const mockEndpoints = (ctx, {
  me = ME_RESPONSE,
  balance = BALANCE_RESPONSE,
  plan = PLAN_RESPONSE,
  usageLimits = USAGE_LIMITS_RESPONSE,
  usages = USAGES_RESPONSE,
  refresh = REFRESH_RESPONSE,
} = {}) => {
  ctx.host.http.request.mockImplementation((opts) => {
    if (opts.url.includes("workos.com/user_management/token")) {
      return refresh === null
        ? { status: 400, bodyText: "" }
        : { status: 200, bodyText: JSON.stringify(refresh) }
    }
    // usage-limits endpoint must be checked before the generic plan endpoint
    if (opts.url.includes("/api/v1/users/me/plan/usage-limits")) {
      return usageLimits === null
        ? { status: 404, bodyText: "" }
        : { status: 200, bodyText: JSON.stringify(usageLimits) }
    }
    if (opts.url.includes("/api/v1/users/me/plan")) {
      return plan === null
        ? { status: 404, bodyText: "" }
        : { status: 200, bodyText: JSON.stringify(plan) }
    }
    if (opts.url.includes("/usages")) {
      return usages === null
        ? { status: 404, bodyText: "" }
        : { status: 200, bodyText: JSON.stringify(usages) }
    }
    if (opts.url.includes("/api/v1/users/me")) {
      return { status: 200, bodyText: JSON.stringify(me) }
    }
    if (opts.url.includes("/balance")) {
      return balance === null
        ? { status: 200, bodyText: JSON.stringify({}) }
        : { status: 200, bodyText: JSON.stringify(balance) }
    }
    return { status: 404, bodyText: "" }
  })
}

const findLine = (result, label) => result.lines.find((l) => l.label === label)

describe("cline-pass plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    if (vi.resetModules) vi.resetModules()
  })

  const makeCtxWithNow = () => {
    const ctx = makeCtx()
    ctx.nowIso = NOW_ISO
    return ctx
  }

  // === Auth tests ===

  it("throws when no auth token is configured", async () => {
    const ctx = makeCtxWithNow()
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("No Cline auth token")
  })

  it("loads token from providers.json config file", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Session")).toBeDefined()
  })

  it("loads token from CLINE_API_KEY env var", async () => {
    const ctx = makeCtxWithNow()
    mockEnvKey(ctx, "cline-key-test123")
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Session")).toBeDefined()
  })

  it("loads token from UsagePal-saved API key before env var", async () => {
    const ctx = makeCtxWithNow()
    mockUsagePalKeyFile(ctx)
    mockEnvKey(ctx, "env-key-should-not-be-used")
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const authCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].headers && c[0].headers.Authorization
    )
    expect(authCall[0].headers.Authorization).toBe("Bearer usagepal-cline-key")
  })

  it("strips the workos: prefix from OAuth tokens", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const authCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].headers && c[0].headers.Authorization
    )
    expect(authCall[0].headers.Authorization).toBe("Bearer eyJtesttoken123")
  })

  it("prefers config file over env var", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEnvKey(ctx, "env-key-should-not-be-used")
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const authCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].headers && c[0].headers.Authorization
    )
    expect(authCall[0].headers.Authorization).toBe("Bearer eyJtesttoken123")
  })

  // === Token refresh tests ===

  it("refreshes expired OAuth token via WorkOS", async () => {
    const ctx = makeCtxWithNow()
    const expiredJson = buildProvidersJson({ expiresAt: Date.now() - 60 * 60 * 1000 })
    mockConfigFile(ctx, expiredJson)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const refreshCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].url && c[0].url.includes("workos.com/user_management/token")
    )
    expect(refreshCall).toBeDefined()
    const apiCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].url && c[0].url.includes("api.cline.bot")
    )
    expect(apiCall[0].headers.Authorization).toBe("Bearer eyJrefreshedtoken456")
  })

  it("falls back to env var when refresh fails", async () => {
    const ctx = makeCtxWithNow()
    const expiredJson = buildProvidersJson({ expiresAt: Date.now() - 60 * 60 * 1000 })
    mockConfigFile(ctx, expiredJson)
    mockEnvKey(ctx, "sk_envkey_fallback_123")
    mockEndpoints(ctx, { refresh: null })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const apiCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].url && c[0].url.includes("api.cline.bot")
    )
    expect(apiCall[0].headers.Authorization).toBe("Bearer sk_envkey_fallback_123")
    expect(findLine(result, "Session")).toBeDefined()
  })

  it("does not refresh when token is not expired", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const refreshCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].url && c[0].url.includes("workos.com/user_management/token")
    )
    expect(refreshCall).toBeUndefined()
  })

  // === Progress bar tests (pre-computed percentages from usage-limits API) ===

  it("shows Session as a percent progress bar from usage-limits API", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const session = findLine(result, "Session")
    expect(session.type).toBe("progress")
    expect(session.format.kind).toBe("percent")
    expect(session.limit).toBe(100)
    expect(session.used).toBe(63)
    expect(session.resetsAt).toBe("2026-07-04T14:36:35Z")
  })

  it("shows Weekly as a percent progress bar from usage-limits API", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const weekly = findLine(result, "Weekly")
    expect(weekly.type).toBe("progress")
    expect(weekly.format.kind).toBe("percent")
    expect(weekly.limit).toBe(100)
    expect(weekly.used).toBe(60)
    expect(weekly.resetsAt).toBe("2026-07-10T15:57:15Z")
  })

  it("shows Monthly as a percent progress bar from usage-limits API", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const monthly = findLine(result, "Monthly")
    expect(monthly.type).toBe("progress")
    expect(monthly.format.kind).toBe("percent")
    expect(monthly.limit).toBe(100)
    expect(monthly.used).toBe(30)
    expect(monthly.resetsAt).toBe("2026-08-02T15:57:15Z")
  })

  it("calls the usage-limits endpoint the dashboard uses", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const limitsCall = ctx.host.http.request.mock.calls.find(
      (c) => c[0].url && c[0].url.includes("/api/v1/users/me/plan/usage-limits")
    )
    expect(limitsCall).toBeDefined()
    expect(limitsCall[0].method).toBe("GET")
  })

  it("shows Balance as dollars converted from micro-USD", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx, { balance: { balance: 750000, userId: "usr-abc123" } })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Balance").value).toBe("$0.75")
  })

  it("derives plan label from plan displayName", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Cline Pass (Monthly)")
  })

  // === Error handling ===

  it("throws on auth failure (401)", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    ctx.host.http.request.mockImplementation(() => ({ status: 401, bodyText: "" }))
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("auth token invalid")
  })

  it("throws on network error", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    ctx.host.http.request.mockImplementation(() => { throw new Error("network") })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Couldn't reach the Cline API")
  })

  it("falls back to text dashes when usage-limits endpoint fails", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx, { usageLimits: null })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const session = findLine(result, "Session")
    expect(session.type).toBe("text")
    expect(session.value).toBe("—")
    const weekly = findLine(result, "Weekly")
    expect(weekly.type).toBe("text")
    expect(weekly.value).toBe("—")
    // Monthly line is omitted when no limits data.
    expect(findLine(result, "Monthly")).toBeUndefined()
  })

  it("handles missing balance gracefully", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx, { balance: null })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Balance")).toBeUndefined()
    expect(findLine(result, "Session")).toBeDefined()
  })

  it("handles missing plan gracefully (still shows usage limits)", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx, { plan: null })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    // Usage limits come from a separate endpoint, not the plan endpoint.
    expect(findLine(result, "Session").type).toBe("progress")
    expect(findLine(result, "Session").used).toBe(63)
    expect(result.plan).toBeNull()
  })
})

describe("cline-pass share graph", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    if (vi.resetModules) vi.resetModules()
  })

  const makeCtxWithNow = () => {
    const ctx = makeCtx()
    ctx.nowIso = NOW_ISO
    return ctx
  }

  it("appends Today/Yesterday/Last 30 Days and per-model lines from usages API", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const labels = result.lines.map((line) => line.label)

    expect(labels).toEqual(
      expect.arrayContaining([
        "Today",
        "Yesterday",
        "Last 30 Days",
        "Usage Trend",
        "Claude Sonnet 4.6",
        "GPT 5.4",
      ]),
    )
    expect(findLine(result, "Today").value).toContain("$1.50")
    expect(findLine(result, "Yesterday").value).toContain("$2.00")
  })

  it("prettifies provider/model slugs for display", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.prettifyModelName("anthropic", "claude-sonnet-4-6")).toBe(
      "Claude Sonnet 4.6",
    )
    expect(plugin.__test.prettifyModelName("zai", "glm-5.2")).toBe("GLM 5.2")
    expect(plugin.__test.prettifyModelName("openai", "gpt-5.4")).toBe("GPT 5.4")
  })

  it("aggregates usage transactions into daily buckets", async () => {
    const plugin = await loadPlugin()
    const ctx = makeCtxWithNow()
    const rows = plugin.__test.normalizeUsageTransactions(ctx, USAGES_RESPONSE)
    const daily = plugin.__test.aggregateDailyFromRows(rows, Date.parse(NOW_ISO))

    expect(daily).toHaveLength(2)
    expect(daily.find((d) => d.date === "2026-07-04").costUSD).toBeCloseTo(1.5)
    expect(daily.find((d) => d.date === "2026-07-03").costUSD).toBeCloseTo(2)
  })

  it("omits share-graph lines when usages endpoint fails", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    mockEndpoints(ctx, { usages: null })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(findLine(result, "Today")).toBeUndefined()
    expect(findLine(result, "Session")).toBeDefined()
  })

  it("converts usage transaction costUsd from micro-USD to dollars", async () => {
    const ctx = makeCtxWithNow()
    mockConfigFile(ctx)
    // 51,822,951 micro-USD = $51.82 — without conversion this would display as $51,822,951.
    const microUsdBugPayload = {
      items: [
        {
          id: "tx-bug",
          createdAt: "2026-07-04T10:00:00.000Z",
          aiInferenceProviderName: "zai",
          aiModelName: "glm-5.2",
          costUsd: 51_822_951,
          totalTokens: 5_000_000,
        },
      ],
    }
    mockEndpoints(ctx, { usages: microUsdBugPayload })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(findLine(result, "Today").value).toContain("$51.82")
    expect(findLine(result, "Today").value).not.toContain("$51,822,951")
    expect(findLine(result, "GLM 5.2").value).toContain("$51.82")
  })
})
