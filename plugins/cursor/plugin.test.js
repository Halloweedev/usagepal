import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

function makeJwt(payload) {
  const jwtPayload = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
  return `a.${jwtPayload}.c`
}

describe("cursor plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("throws when no token", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([]))
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
  })

  it("loads tokens from keychain when sqlite has none", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([]))
    ctx.host.keychain.readGenericPassword.mockImplementation((service) => {
      if (service === "cursor-access-token") return "keychain-access-token"
      if (service === "cursor-refresh-token") return "keychain-refresh-token"
      return null
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        enabled: true,
        planUsage: { totalSpend: 1200, limit: 2400 },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith("cursor-access-token")
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith("cursor-refresh-token")
  })

  it("refreshes keychain access token and persists to keychain source", async () => {
    const ctx = makeCtx()
    const expiredPayload = Buffer.from(JSON.stringify({ exp: 1 }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const expiredAccessToken = `a.${expiredPayload}.c`
    const freshPayload = Buffer.from(JSON.stringify({ exp: 9999999999 }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const refreshedAccessToken = `a.${freshPayload}.c`

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([]))
    ctx.host.keychain.readGenericPassword.mockImplementation((service) => {
      if (service === "cursor-access-token") return expiredAccessToken
      if (service === "cursor-refresh-token") return "keychain-refresh-token"
      return null
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/oauth/token")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ access_token: refreshedAccessToken }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          enabled: true,
          planUsage: { totalSpend: 1200, limit: 2400 },
        }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
    expect(ctx.host.keychain.writeGenericPassword).toHaveBeenCalledWith(
      "cursor-access-token",
      refreshedAccessToken
    )
    expect(ctx.host.sqlite.exec).not.toHaveBeenCalled()
  })

  it("prefers sqlite tokens when sqlite and keychain both have tokens", async () => {
    const ctx = makeCtx()
    const sqlitePayload = Buffer.from(JSON.stringify({ exp: 9999999999 }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const sqliteToken = `a.${sqlitePayload}.c`
    const keychainPayload = Buffer.from(JSON.stringify({ exp: 9999999999, sub: "keychain" }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const keychainToken = `a.${keychainPayload}.c`

    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: sqliteToken }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) {
        return JSON.stringify([{ value: "sqlite-refresh-token" }])
      }
      return JSON.stringify([])
    })
    ctx.host.keychain.readGenericPassword.mockImplementation((service) => {
      if (service === "cursor-access-token") return keychainToken
      if (service === "cursor-refresh-token") return "keychain-refresh-token"
      return null
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        expect(opts.headers.Authorization).toBe("Bearer " + sqliteToken)
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          enabled: true,
          planUsage: { totalSpend: 1200, limit: 2400 },
        }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith("cursor-access-token")
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith("cursor-refresh-token")
  })

  it("prefers keychain when sqlite looks free and token subjects differ", async () => {
    const ctx = makeCtx()
    const sqlitePayload = Buffer.from(
      JSON.stringify({ exp: 9999999999, sub: "google-oauth2|sqlite-user" }),
      "utf8"
    )
      .toString("base64")
      .replace(/=+$/g, "")
    const sqliteToken = `a.${sqlitePayload}.c`

    const keychainPayload = Buffer.from(
      JSON.stringify({ exp: 9999999999, sub: "auth0|keychain-user" }),
      "utf8"
    )
      .toString("base64")
      .replace(/=+$/g, "")
    const keychainToken = `a.${keychainPayload}.c`

    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: sqliteToken }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) {
        return JSON.stringify([{ value: "sqlite-refresh-token" }])
      }
      if (String(sql).includes("cursorAuth/stripeMembershipType")) {
        return JSON.stringify([{ value: "free" }])
      }
      return JSON.stringify([])
    })
    ctx.host.keychain.readGenericPassword.mockImplementation((service) => {
      if (service === "cursor-access-token") return keychainToken
      if (service === "cursor-refresh-token") return "keychain-refresh-token"
      return null
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        expect(opts.headers.Authorization).toBe("Bearer " + keychainToken)
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          enabled: true,
          planUsage: { totalSpend: 1200, limit: 2400 },
        }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
  })

  it("throws on sqlite errors when reading token", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation(() => {
      throw new Error("boom")
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
    expect(ctx.host.log.warn).toHaveBeenCalled()
  })

  it("throws on disabled usage", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({ enabled: false }),
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("No active Cursor subscription.")
  })

  it("throws on missing plan usage data", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({ enabled: true }),
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("No active Cursor subscription.")
  })

  it("accepts team usage when enabled flag is missing", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770064133000",
            billingCycleEnd: "1772483333000",
            planUsage: { totalSpend: 8474, limit: 2000, bonusSpend: 6474 },
            spendLimitUsage: {
              pooledLimit: 60000,
              pooledRemaining: 19216,
            },
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ planInfo: { planName: "Team" } }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Team")
    const totalLine = result.lines.find((line) => line.label === "Total usage")
    expect(totalLine).toBeTruthy()
    expect(totalLine.format).toEqual({ kind: "dollars" })
    expect(totalLine.used).toBe(84.74)
    expect(totalLine.limit).toBe(20)
    expect(result.lines.find((line) => line.label === "Bonus spend")).toBeTruthy()
  })

  it("throws on missing total usage limit", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        enabled: true,
        planUsage: { totalSpend: 1200 }, // missing limit
      }),
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Total usage limit missing")
  })

  it("uses percent-only usage when totalPercentUsed exists but limit is missing", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            billingCycleStart: "1772556293029",
            billingCycleEnd: "1775234693029",
            planUsage: {
              autoPercentUsed: 0,
              apiPercentUsed: 0,
              totalPercentUsed: 0,
            },
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Free" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        throw new Error("unexpected REST usage fallback")
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Free")
    const totalLine = result.lines.find((line) => line.label === "Total usage")
    expect(totalLine).toBeTruthy()
    expect(totalLine.format).toEqual({ kind: "percent" })
    expect(totalLine.used).toBe(0)
    expect(totalLine.limit).toBe(100)
  })

  it("uses percent-only free usage when pooledLimit is zero", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            billingCycleStart: "1772556293029",
            billingCycleEnd: "1775234693029",
            planUsage: {
              autoPercentUsed: 0,
              apiPercentUsed: 0,
              totalPercentUsed: 0,
            },
            spendLimitUsage: { pooledLimit: 0, pooledRemaining: 0 },
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Free" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        throw new Error("unexpected REST usage fallback")
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Free")
    const totalLine = result.lines.find((line) => line.label === "Total usage")
    expect(totalLine).toBeTruthy()
    expect(totalLine.format).toEqual({ kind: "percent" })
    expect(totalLine.used).toBe(0)
    expect(totalLine.limit).toBe(100)
  })

  it("renders percent-only usage when plan info is unavailable", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            billingCycleStart: "1772556293029",
            billingCycleEnd: "1775234693029",
            planUsage: {
              totalPercentUsed: 42,
            },
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return { status: 503, bodyText: "" }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        throw new Error("unexpected REST usage fallback")
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeNull()
    const totalLine = result.lines.find((line) => line.label === "Total usage")
    expect(totalLine).toBeTruthy()
    expect(totalLine.format).toEqual({ kind: "percent" })
    expect(totalLine.used).toBe(42)
    expect(totalLine.limit).toBe(100)
  })

  it("falls back to computed percent when totalSpend missing and no totalPercentUsed", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        enabled: true,
        planUsage: { limit: 2400, remaining: 1200 },
      }),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const planLine = result.lines.find((l) => l.label === "Total usage")
    expect(planLine).toBeTruthy()
    expect(planLine.format).toEqual({ kind: "percent" })
    // computed = (2400 - 1200) / 2400 * 100 = 50
    expect(planLine.used).toBe(50)
  })

  it("renders usage + plan info", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400, bonusSpend: 100 },
            spendLimitUsage: { individualLimit: 5000, individualRemaining: 1000 },
            billingCycleEnd: Date.now(),
          }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({ planInfo: { planName: "pro plan" } }),
      }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeTruthy()
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
  })

  it("omits plan badge for blank plan names", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
          }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({ planInfo: { planName: "   " } }),
      }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeFalsy()
  })

  it("uses pooled spend limits when individual values missing", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
            spendLimitUsage: { pooledLimit: 2000, pooledRemaining: 500 },
          }),
        }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({ planInfo: { planName: "pro plan" } }),
      }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "On-demand")).toBeTruthy()
  })

  it("throws on token expired", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({ status: 401, bodyText: "" })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Token expired")
  })

  it("throws on http errors", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({ status: 500, bodyText: "" })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("HTTP 500")
  })

  it("throws on usage request errors", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation(() => {
      throw new Error("boom")
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage request failed")
  })

  it("throws on parse errors", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: "not-json",
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage response invalid")
  })

  it("handles enterprise account with request-based usage", async () => {
    const ctx = makeCtx()

    // Build a JWT with a sub claim containing a user ID
    const jwtPayload = Buffer.from(
      JSON.stringify({ sub: "google-oauth2|user_abc123", exp: 9999999999 }),
      "utf8"
    )
      .toString("base64")
      .replace(/=+$/g, "")
    const accessToken = `a.${jwtPayload}.c`

    ctx.host.sqlite.query.mockReturnValue(
      JSON.stringify([{ value: accessToken }])
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        // Enterprise returns no enabled/planUsage
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
            displayThreshold: 100,
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise", price: "Custom" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 422,
              numRequestsTotal: 422,
              numTokens: 171664819,
              maxRequestUsage: 500,
              maxTokenUsage: null,
            },
            startOfMonth: "2026-02-01T06:12:57.000Z",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Enterprise")
    const reqLine = result.lines.find((l) => l.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(422)
    expect(reqLine.limit).toBe(500)
    expect(reqLine.format).toEqual({ kind: "count", suffix: "requests" })
  })

  it("falls back to enterprise request-based usage when planUsage.limit is missing", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
            planUsage: {
              totalSpend: 1234,
              totalPercentUsed: 12,
            },
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 211,
              maxRequestUsage: 500,
            },
            startOfMonth: "2026-02-01T06:12:57.000Z",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Enterprise")
    const reqLine = result.lines.find((line) => line.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(211)
    expect(reqLine.limit).toBe(500)
  })

  it("falls back to REST usage for team-inferred account with percent-only and unavailable plan info", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            billingCycleStart: "1772556293029",
            billingCycleEnd: "1775234693029",
            planUsage: {
              totalPercentUsed: 35,
            },
            spendLimitUsage: {
              limitType: "team",
              pooledLimit: 5000,
            },
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return { status: 503, bodyText: "" }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 150,
              maxRequestUsage: 500,
            },
            startOfMonth: "2026-02-01T06:12:57.000Z",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const reqLine = result.lines.find((l) => l.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(150)
    expect(reqLine.limit).toBe(500)
    expect(reqLine.format).toEqual({ kind: "count", suffix: "requests" })
  })

  it("handles team account with request-based usage", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(
      JSON.stringify([{ value: accessToken }])
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1772124774973",
            billingCycleEnd: "1772124774973",
            displayThreshold: 100,
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: {
              planName: "Team",
              includedAmountCents: 2000,
              price: "$40/mo",
              billingCycleEnd: "1773077797000",
            },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 39,
              numRequestsTotal: 39,
              numTokens: 12345,
              maxRequestUsage: 500,
              maxTokenUsage: null,
            },
            startOfMonth: "2026-02-09T17:36:37.000Z",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Team")
    const reqLine = result.lines.find((l) => l.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(39)
    expect(reqLine.limit).toBe(500)
    expect(reqLine.format).toEqual({ kind: "count", suffix: "requests" })
  })

  it("throws when enterprise REST usage API fails", async () => {
    const ctx = makeCtx()

    const jwtPayload = Buffer.from(
      JSON.stringify({ sub: "google-oauth2|user_abc123", exp: 9999999999 }),
      "utf8"
    )
      .toString("base64")
      .replace(/=+$/g, "")
    const accessToken = `a.${jwtPayload}.c`

    ctx.host.sqlite.query.mockReturnValue(
      JSON.stringify([{ value: accessToken }])
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return { status: 500, bodyText: "" }
      }
      return { status: 200, bodyText: "{}" }
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Enterprise usage data unavailable")
  })

  it("throws team request-based unavailable when REST usage API fails", async () => {
    const ctx = makeCtx()

    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(
      JSON.stringify([{ value: accessToken }])
    )
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1772124774973",
            billingCycleEnd: "1772124774973",
            displayThreshold: 100,
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Team" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return { status: 500, bodyText: "" }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Team request-based usage data unavailable")
  })

  it("throws team request-based unavailable when REST usage request throws", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1772124774973",
            billingCycleEnd: "1772124774973",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ planInfo: { planName: "Team" } }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        throw new Error("rest usage boom")
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Team request-based usage data unavailable")
  })

  it("falls back to REST request usage when plan info is unavailable", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1772124774973",
            billingCycleEnd: "1772124774973",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return { status: 503, bodyText: "" }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 31,
              maxRequestUsage: 500,
            },
            startOfMonth: "2026-02-09T17:36:37.000Z",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeNull()
    const reqLine = result.lines.find((l) => l.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(31)
    expect(reqLine.limit).toBe(500)
  })

  it("surfaces request-based unavailable when plan info is unavailable and REST fallback fails", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1772124774973",
            billingCycleEnd: "1772124774973",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        throw new Error("plan info timeout")
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return { status: 500, bodyText: "" }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Cursor request-based usage data unavailable")
  })

  it("does not use request-based fallback for disabled team accounts", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    let restUsageCalled = false

    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: false,
            billingCycleStart: "1772124774973",
            billingCycleEnd: "1772124774973",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ planInfo: { planName: "Team" } }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        restUsageCalled = true
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": { numRequests: 1, maxRequestUsage: 500 },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("No active Cursor subscription.")
    expect(restUsageCalled).toBe(false)
  })

  it("still throws no subscription for non-enterprise accounts without planUsage", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ enabled: false }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ planInfo: { planName: "Pro" } }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("No active Cursor subscription.")
  })

  it("handles plan fetch failure gracefully", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 0, limit: 100 },
          }),
        }
      }
      // Plan fetch fails
      throw new Error("plan fail")
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
  })

  it("outputs Credits first when available", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
            spendLimitUsage: { individualLimit: 5000, individualRemaining: 1000 },
          }),
        }
      }
      if (String(opts.url).includes("GetCreditGrantsBalance")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            hasCreditGrants: true,
            totalCents: 10000,
            usedCents: 500,
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    
    // Credits should be first in the lines array
    expect(result.lines[0].label).toBe("Credits")
    expect(result.lines[1].label).toBe("Total usage")
    // On-demand should come after
    const onDemandIndex = result.lines.findIndex((l) => l.label === "On-demand")
    expect(onDemandIndex).toBeGreaterThan(1)
  })

  it("combines credit grants with Stripe customer balance for Credits line", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      const url = String(opts.url)
      if (url.includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
          }),
        }
      }
      if (url.includes("GetCreditGrantsBalance")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            hasCreditGrants: true,
            totalCents: "1000000",
            usedCents: "264729",
          }),
        }
      }
      if (url.includes("/api/auth/stripe")) {
        expect(opts.headers.Cookie).toBe(
          "WorkosCursorSessionToken=user_abc123%3A%3A" + accessToken
        )
        return {
          status: 200,
          bodyText: JSON.stringify({
            customerBalance: -991544,
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const creditsLine = result.lines.find((line) => line.label === "Credits")

    expect(creditsLine).toBeTruthy()
    expect(creditsLine.used).toBeCloseTo(2647.29, 2)
    expect(creditsLine.limit).toBeCloseTo(19915.44, 2)
  })

  it("shows Credits line from Stripe balance when grants are unavailable", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      const url = String(opts.url)
      if (url.includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
          }),
        }
      }
      if (url.includes("GetCreditGrantsBalance")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ hasCreditGrants: false }),
        }
      }
      if (url.includes("/api/auth/stripe")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            customerBalance: -50000,
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const creditsLine = result.lines.find((line) => line.label === "Credits")

    expect(result.lines[0].label).toBe("Credits")
    expect(creditsLine).toBeTruthy()
    expect(creditsLine.used).toBe(0)
    expect(creditsLine.limit).toBe(500)
  })

  it("accepts Stripe customer balance when returned as numeric string", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      const url = String(opts.url)
      if (url.includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
          }),
        }
      }
      if (url.includes("GetCreditGrantsBalance")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ hasCreditGrants: false }),
        }
      }
      if (url.includes("/api/auth/stripe")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            customerBalance: "-50000",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const creditsLine = result.lines.find((line) => line.label === "Credits")

    expect(result.lines[0].label).toBe("Credits")
    expect(creditsLine).toBeTruthy()
    expect(creditsLine.used).toBe(0)
    expect(creditsLine.limit).toBe(500)
  })

  it("outputs Total usage first when Credits not available", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
          }),
        }
      }
      if (String(opts.url).includes("GetCreditGrantsBalance")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ hasCreditGrants: false }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    
    // Total usage should be first when Credits not available
    expect(result.lines[0].label).toBe("Total usage")
  })

  it("emits Auto usage and API usage percent lines when available", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            billingCycleEnd: Date.now(),
            planUsage: {
              limit: 40000,
              remaining: 32000,
              totalPercentUsed: 20,
              autoPercentUsed: 12.5,
              apiPercentUsed: 7.5,
            },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const totalLine = result.lines.find((line) => line.label === "Total usage")
    const autoLine = result.lines.find((line) => line.label === "Auto usage")
    const apiLine = result.lines.find((line) => line.label === "API usage")

    expect(totalLine).toBeTruthy()
    expect(totalLine.used).toBe(20)
    expect(totalLine.format).toEqual({ kind: "percent" })
    expect(autoLine).toBeTruthy()
    expect(autoLine.used).toBe(12.5)
    expect(autoLine.format).toEqual({ kind: "percent" })
    expect(apiLine).toBeTruthy()
    expect(apiLine.used).toBe(7.5)
    expect(apiLine.format).toEqual({ kind: "percent" })
  })

  it("falls back to computed percent when totalPercentUsed is not finite", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        enabled: true,
        planUsage: { limit: 2400, remaining: 1200, totalPercentUsed: Number.POSITIVE_INFINITY },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const totalLine = result.lines.find((l) => l.label === "Total usage")
    expect(totalLine).toBeTruthy()
    expect(totalLine.used).toBe(50)
  })

  it("omits Auto usage and API usage when percent fields missing", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        enabled: true,
        planUsage: { limit: 40000, remaining: 32000, totalPercentUsed: 20 },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
    expect(result.lines.find((line) => line.label === "Auto usage")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "API usage")).toBeUndefined()
  })

  it("team account uses dollars format for Total usage", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
            spendLimitUsage: { limitType: "team", pooledLimit: 5000, pooledRemaining: 3000 },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const totalLine = result.lines.find((line) => line.label === "Total usage")
    expect(totalLine).toBeTruthy()
    expect(totalLine.format).toEqual({ kind: "dollars" })
    expect(totalLine.used).toBe(12)
  })

  it("refreshes token when expired and persists new access token", async () => {
    const ctx = makeCtx()

    const expiredPayload = Buffer.from(JSON.stringify({ exp: 1 }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const accessToken = `a.${expiredPayload}.c`

    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: accessToken }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) {
        return JSON.stringify([{ value: "refresh" }])
      }
      return JSON.stringify([])
    })

    const newPayload = Buffer.from(JSON.stringify({ exp: 9999999999 }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const newToken = `a.${newPayload}.c`

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: newToken }) }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({ enabled: true, planUsage: { totalSpend: 0, limit: 100 } }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
    expect(ctx.host.sqlite.exec).toHaveBeenCalled()
  })

  it("throws session expired when refresh requires logout and no access token exists", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) {
        return JSON.stringify([{ value: "refresh" }])
      }
      return JSON.stringify([])
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ shouldLogout: true }) }
      }
      return { status: 500, bodyText: "" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Session expired")
  })

  it("continues with existing access token when refresh fails", async () => {
    const ctx = makeCtx()

    const payload = Buffer.from(JSON.stringify({ exp: 1 }), "utf8")
      .toString("base64")
      .replace(/=+$/g, "")
    const accessToken = `a.${payload}.c`

    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: accessToken }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) {
        return JSON.stringify([{ value: "refresh" }])
      }
      return JSON.stringify([])
    })

    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/oauth/token")) {
        // Force refresh to throw string error.
        return { status: 401, bodyText: JSON.stringify({ shouldLogout: true }) }
      }
      return {
        status: 200,
        bodyText: JSON.stringify({ enabled: true, planUsage: { totalSpend: 0, limit: 100 } }),
      }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
  })

  it("handles invalid sqlite JSON for access token when refresh token is available", async () => {
    const ctx = makeCtx()
    const refreshedToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })

    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) return "{}"
      if (String(sql).includes("cursorAuth/refreshToken")) return JSON.stringify([{ value: "refresh" }])
      return JSON.stringify([])
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: refreshedToken }) }
      }
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return { status: 200, bodyText: JSON.stringify({ enabled: true, planUsage: { totalSpend: 0, limit: 100 } }) }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
  })

  it("throws not logged in when only refresh token exists but refresh returns no access token", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) return JSON.stringify([])
      if (String(sql).includes("cursorAuth/refreshToken")) return JSON.stringify([{ value: "refresh" }])
      return JSON.stringify([])
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({}) }
      }
      return { status: 500, bodyText: "" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Not logged in")
  })

  it("throws token expired when usage remains unauthorized after refresh retry", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: makeJwt({ sub: "google-oauth2|u", exp: 9999999999 }) }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) return JSON.stringify([{ value: "refresh" }])
      return JSON.stringify([])
    })

    let usageCalls = 0
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        usageCalls += 1
        if (usageCalls === 1) return { status: 401, bodyText: "" }
        return { status: 403, bodyText: "" }
      }
      if (String(opts.url).includes("/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: makeJwt({ sub: "google-oauth2|u", exp: 9999999999 }) }) }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Token expired")
  })

  it("throws usage request failed after refresh when retried usage request errors", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: makeJwt({ sub: "google-oauth2|u", exp: 9999999999 }) }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) return JSON.stringify([{ value: "refresh" }])
      return JSON.stringify([])
    })

    let usageCalls = 0
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        usageCalls += 1
        if (usageCalls === 1) return { status: 401, bodyText: "" }
        throw new Error("boom")
      }
      if (String(opts.url).includes("/oauth/token")) {
        return { status: 200, bodyText: JSON.stringify({ access_token: makeJwt({ sub: "google-oauth2|u", exp: 9999999999 }) }) }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage request failed after refresh")
  })

  it("throws enterprise unavailable when token payload has no sub", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return { status: 200, bodyText: JSON.stringify({ billingCycleStart: "1770539602363" }) }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return { status: 200, bodyText: JSON.stringify({ planInfo: { planName: "Enterprise" } }) }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Enterprise usage data unavailable")
  })

  it("supports enterprise JWT sub values without provider prefix", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 3,
              maxRequestUsage: 10,
            },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Enterprise")
    const reqLine = result.lines.find((l) => l.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(3)
    expect(reqLine.limit).toBe(10)
  })

  it("uses zero default for missing remaining and omits zero on-demand limits", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { limit: 2400 },
            spendLimitUsage: {},
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const planLine = result.lines.find((line) => line.label === "Total usage")
    expect(planLine).toBeTruthy()
    expect(planLine.used).toBe(100)
    expect(result.lines.find((line) => line.label === "On-demand")).toBeUndefined()
  })

  it("rethrows string errors from retry wrapper", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.util.retryOnceOnAuth = vi.fn(() => {
      throw "retry failed"
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("retry failed")
  })

  it("skips malformed credit grants payload and still returns total usage", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 1200, limit: 2400 },
          }),
        }
      }
      if (String(opts.url).includes("GetCreditGrantsBalance")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            hasCreditGrants: true,
            totalCents: "oops",
            usedCents: "10",
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Credits")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "Total usage")).toBeTruthy()
  })

  it("uses expired access token when refresh token is missing", async () => {
    const ctx = makeCtx()
    const expiredToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 1 })
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      if (String(sql).includes("cursorAuth/accessToken")) {
        return JSON.stringify([{ value: expiredToken }])
      }
      if (String(sql).includes("cursorAuth/refreshToken")) return JSON.stringify([])
      return JSON.stringify([])
    })
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            enabled: true,
            planUsage: { totalSpend: 0, limit: 100 },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).not.toThrow()
  })

  it("throws enterprise unavailable when sub resolves to empty user id", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return { status: 200, bodyText: JSON.stringify({ billingCycleStart: "1770539602363" }) }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return { status: 200, bodyText: JSON.stringify({ planInfo: { planName: "Enterprise" } }) }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Enterprise usage data unavailable")
  })

  it("uses zero included requests when enterprise usage omits numRequests", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              maxRequestUsage: 10,
            },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const reqLine = result.lines.find((line) => line.label === "Requests")
    expect(reqLine).toBeTruthy()
    expect(reqLine.used).toBe(0)
    expect(reqLine.limit).toBe(10)
  })

  it("throws enterprise unavailable when gpt-4 request limit is not positive", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 42,
              maxRequestUsage: 0,
            },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Enterprise usage data unavailable")
  })

  it("omits enterprise plan label when formatter returns null", async () => {
    const ctx = makeCtx()
    const accessToken = makeJwt({ sub: "google-oauth2|user_abc123", exp: 9999999999 })
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: accessToken }]))
    ctx.fmt.planLabel = vi.fn(() => null)
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("GetCurrentPeriodUsage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            billingCycleStart: "1770539602363",
            billingCycleEnd: "1770539602363",
          }),
        }
      }
      if (String(opts.url).includes("GetPlanInfo")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            planInfo: { planName: "Enterprise" },
          }),
        }
      }
      if (String(opts.url).includes("cursor.com/api/usage")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            "gpt-4": {
              numRequests: 3,
              maxRequestUsage: 10,
            },
          }),
        }
      }
      return { status: 200, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeNull()
    expect(result.lines.find((line) => line.label === "Requests")).toBeTruthy()
  })

  it("wraps non-string retry wrapper errors as usage request failure", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockReturnValue(JSON.stringify([{ value: "token" }]))
    ctx.util.retryOnceOnAuth = vi.fn(() => {
      throw new Error("wrapper blew up")
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Usage request failed. Check your connection.")
  })
})

describe("cursor pricing", () => {
  it("resolves a known slug and its alias to rates", async () => {
    const plugin = await loadPlugin()
    const r = plugin.__test.resolveModelRates("composer-2.5-fast")
    expect(r).toEqual({ input: 0.5, cache_write: null, cache_read: 0.2, output: 2.5, apply_max_mode_uplift: true })
    expect(plugin.__test.resolveModelRates("claude-sonnet-5")).toEqual({
      input: 3.0, cache_write: 3.75, cache_read: 0.3, output: 15.0, apply_max_mode_uplift: true,
    })
  })

  it("resolves the GPT-5.6 tiers to their rates", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.resolveModelRates("gpt-5.6-sol")).toEqual({
      input: 5.0, cache_write: 6.25, cache_read: 0.5, output: 30.0, apply_max_mode_uplift: true,
    })
    expect(plugin.__test.resolveModelRates("gpt-5.6-terra")).toEqual({
      input: 2.5, cache_write: 3.125, cache_read: 0.25, output: 15.0, apply_max_mode_uplift: true,
    })
    expect(plugin.__test.resolveModelRates("gpt-5.6-luna")).toEqual({
      input: 1.0, cache_write: 1.25, cache_read: 0.1, output: 6.0, apply_max_mode_uplift: true,
    })
    // A tiered slug must not fall through to the generic gpt-5 rule.
    expect(plugin.__test.resolveModelRates("gpt-5.6-sol-thinking").output).toBe(30.0)
  })

  it("resolves Auto Cost and Cursor-prefixed Grok High variants", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.resolveModelRates("auto")).toEqual({
      input: 1.25, cache_write: 1.25, cache_read: 0.25, output: 6.0, apply_max_mode_uplift: true,
    })
    expect(plugin.__test.resolveModelRates("Auto")).toEqual(
      plugin.__test.resolveModelRates("auto-cost")
    )
    // CSV often prefixes Cursor first-party models and appends reasoning effort.
    expect(plugin.__test.resolveModelRates("cursor-grok-4.5-high-fast").output).toBe(18.0)
    expect(plugin.__test.resolveModelRates("cursor-grok-4.5-high").output).toBe(6.0)
    expect(plugin.__test.resolveModelRates("grok-4.5-high-fast").output).toBe(18.0)
    expect(plugin.__test.resolveModelRates("grok-4.5-high").output).toBe(6.0)
  })

  it("returns null for an unknown slug", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.resolveModelRates("totally-unknown-model")).toBeNull()
    expect(plugin.__test.resolveModelRates("")).toBeNull()
  })

  it("does not let an unlisted version fall through to the base model's rates", async () => {
    const plugin = await loadPlugin()
    // Regression: the base catch-alls ended in `\b`, and `\b` matches between a
    // digit and a `.`, so an unlisted `gpt-5.x` (or `composer-2.x`) silently
    // inherited the base model's price instead of being surfaced as unknown.
    const gpt5 = plugin.__test.resolveModelRates("gpt-5")
    expect(gpt5).not.toBeNull()
    expect(plugin.__test.resolveModelRates("gpt-5.6")).not.toEqual(gpt5)
    expect(plugin.__test.resolveModelRates("gpt-5.7")).toBeNull()

    const composer2 = plugin.__test.resolveModelRates("composer-2")
    expect(composer2).not.toBeNull()
    expect(plugin.__test.resolveModelRates("composer-2.6")).toBeNull()

    const composer1 = plugin.__test.resolveModelRates("composer-1")
    expect(composer1).not.toBeNull()
    expect(plugin.__test.resolveModelRates("composer-1.6")).toBeNull()
  })

  it("still resolves the plain base versions after the fallthrough guard", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.resolveModelRates("gpt-5")).toEqual({
      input: 1.25, cache_write: null, cache_read: 0.125, output: 10.0, apply_max_mode_uplift: true,
    })
    expect(plugin.__test.resolveModelRates("composer-2")).not.toBeNull()
    expect(plugin.__test.resolveModelRates("composer-1")).not.toBeNull()
    // Listed tiers keep resolving through their specific rules.
    expect(plugin.__test.resolveModelRates("gpt-5.6-sol").output).toBe(30.0)
    expect(plugin.__test.resolveModelRates("gpt-5.4").output).toBe(15.0)
  })
})

describe("cursor usage CSV parser", () => {
  const HEADER =
    "Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Requests"

  it("parses the verified header + sample row into token buckets", async () => {
    const plugin = await loadPlugin()
    const csv =
      HEADER +
      "\r\n" +
      '"2026-06-21T14:25:29.044Z","","","free","composer-2.5-fast","No","0","83265","685312","6760","775337","17.3"\r\n'
    const rows = plugin.__test.parseUsageEventsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      date: "2026-06-21T14:25:29.044Z",
      kind: "free",
      model: "composer-2.5-fast",
      maxMode: "No",
      cacheWrite: 0,
      input: 83265,
      cacheRead: 685312,
      output: 6760,
      totalTokens: 775337,
    })
  })

  it("skips blank/whitespace lines and rows with no date", async () => {
    const plugin = await loadPlugin()
    const csv =
      HEADER +
      "\n" +
      '"2026-06-21T00:00:00.000Z","","","free","composer-2","Yes","1","2","3","4","10","1"\n' +
      "\n" +
      '"","","","free","composer-2","No","1","1","1","1","4","1"\n'
    const rows = plugin.__test.parseUsageEventsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].model).toBe("composer-2")
    expect(rows[0].maxMode).toBe("Yes")
  })

  it("returns empty for empty or header-only input", async () => {
    const plugin = await loadPlugin()
    expect(plugin.__test.parseUsageEventsCsv("")).toEqual([])
    expect(plugin.__test.parseUsageEventsCsv(HEADER)).toEqual([])
  })
})

describe("cursor imputation + aggregation", () => {
  it("imputes cost from token buckets at model rates", async () => {
    const plugin = await loadPlugin()
    const rates = plugin.__test.resolveModelRates("composer-2.5")
    // input 83265*0.5 + cacheWrite 0 (null->input rate) + cacheRead 685312*0.2 + output 6760*2.5, /1e6
    const row = { model: "composer-2.5", maxMode: "No", cacheWrite: 0, input: 83265, cacheRead: 685312, output: 6760, totalTokens: 775337 }
    const cost = plugin.__test.imputeRowCostUsd(row, rates, false)
    expect(cost).toBeCloseTo((83265 * 0.5 + 685312 * 0.2 + 6760 * 2.5) / 1e6, 9)
  })

  it("prices cache-write at the input rate when cache_write is null", async () => {
    const plugin = await loadPlugin()
    const rates = plugin.__test.resolveModelRates("composer-2")
    const row = { model: "composer-2", maxMode: "No", cacheWrite: 1000, input: 0, cacheRead: 0, output: 0, totalTokens: 1000 }
    expect(plugin.__test.imputeRowCostUsd(row, rates, false)).toBeCloseTo((1000 * rates.input) / 1e6, 12)
  })

  it("applies the 20% Max Mode uplift only on request-based plans", async () => {
    const plugin = await loadPlugin()
    const rates = plugin.__test.resolveModelRates("composer-2")
    const row = { model: "composer-2", maxMode: "Yes", cacheWrite: 0, input: 1000000, cacheRead: 0, output: 0, totalTokens: 1000000 }
    const base = rates.input // 1e6 input tokens => exactly rates.input dollars
    expect(plugin.__test.imputeRowCostUsd(row, rates, true)).toBeCloseTo(base * 1.2, 9)
    expect(plugin.__test.imputeRowCostUsd(row, rates, false)).toBeCloseTo(base, 9)
    const noMax = { ...row, maxMode: "No" }
    expect(plugin.__test.imputeRowCostUsd(noMax, rates, true)).toBeCloseTo(base, 9)
  })

  it("returns 0 cost for unknown model but still needs no rates", async () => {
    const plugin = await loadPlugin()
    const row = { model: "nope", maxMode: "No", cacheWrite: 0, input: 100, cacheRead: 0, output: 0, totalTokens: 100 }
    expect(plugin.__test.imputeRowCostUsd(row, null, false)).toBe(0)
  })

  it("aggregates rows by UTC day, filters >31 days, logs unknown models once", async () => {
    const ctx = makeCtx()
    const plugin = await loadPlugin()
    const now = Date.UTC(2026, 6, 1, 12, 0, 0) // 2026-07-01T12:00Z
    const rows = [
      { date: "2026-07-01T01:00:00.000Z", model: "composer-2", maxMode: "No", cacheWrite: 0, input: 1000000, cacheRead: 0, output: 0, totalTokens: 1000000 },
      { date: "2026-07-01T09:00:00.000Z", model: "unknownx", maxMode: "No", cacheWrite: 0, input: 5, cacheRead: 0, output: 0, totalTokens: 5 },
      { date: "2026-06-30T23:00:00.000Z", model: "composer-2", maxMode: "No", cacheWrite: 0, input: 0, cacheRead: 0, output: 0, totalTokens: 42 },
      { date: "2026-05-01T00:00:00.000Z", model: "composer-2", maxMode: "No", cacheWrite: 0, input: 1000000, cacheRead: 0, output: 0, totalTokens: 999 },
    ]
    const daily = plugin.__test.aggregateDailyFromCsvRows(ctx, rows, now, false)
    expect(daily.map((d) => d.date)).toEqual(["2026-06-30", "2026-07-01"])
    const jul1 = daily.find((d) => d.date === "2026-07-01")
    expect(jul1.totalTokens).toBe(1000005)
    expect(jul1.costUSD).toBeCloseTo(0.5, 9) // 1e6 input * composer-2 input(0.5)/1e6; unknown adds 0
    expect(ctx.host.log.info).toHaveBeenCalledWith("cursor pricing: unknown model unknownx")
  })

  it("aggregates CSV rows by model with today/7d/30d cost and token totals", async () => {
    const plugin = await loadPlugin()
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z")
    const rows = [
      { date: "2026-07-12T10:00:00.000Z", model: "composer-2", maxMode: "No", cacheWrite: 0, input: 1_000_000, cacheRead: 0, output: 0, totalTokens: 1_000_000 },
      { date: "2026-07-12T11:00:00.000Z", model: "claude-4-sonnet", maxMode: "No", cacheWrite: 0, input: 500_000, cacheRead: 0, output: 0, totalTokens: 500_000 },
      { date: "2026-07-11T10:00:00.000Z", model: "composer-2", maxMode: "No", cacheWrite: 0, input: 200_000, cacheRead: 0, output: 0, totalTokens: 200_000 },
    ]
    const result = plugin.__test.aggregateModelUsageFromCsvRows(makeCtx(), rows, nowMs, false)
    expect(result.models.map((m) => m.name)).toEqual(["composer-2", "claude-4-sonnet"])
    expect(result.models[0].tokens["30d"]).toBeGreaterThan(0)
    expect(result.models[0].costUSD.Today).toBeGreaterThan(0)
    expect(result.models[0].costUSD.Yesterday).toBeGreaterThan(0)
    expect(result.models[0].costUSD["30d"]).toBeGreaterThan(result.models[0].costUSD.Today)
  })

  it("merges case variants of the same model slug and prices cursor-grok rows", async () => {
    const plugin = await loadPlugin()
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z")
    const rows = [
      { date: "2026-07-12T10:00:00.000Z", model: "cursor-grok-4.5-high-fast", maxMode: "No", cacheWrite: 0, input: 1_000_000, cacheRead: 0, output: 0, totalTokens: 1_000_000 },
      { date: "2026-07-12T11:00:00.000Z", model: "Composer-2.5", maxMode: "No", cacheWrite: 0, input: 500_000, cacheRead: 0, output: 0, totalTokens: 500_000 },
      { date: "2026-07-12T11:30:00.000Z", model: "composer-2.5", maxMode: "No", cacheWrite: 0, input: 500_000, cacheRead: 0, output: 0, totalTokens: 500_000 },
    ]
    const result = plugin.__test.aggregateModelUsageFromCsvRows(makeCtx(), rows, nowMs, false)
    expect(result.models.map((m) => m.name)).toEqual(["composer-2.5", "cursor-grok-4.5-high-fast"])
    expect(result.models[0].tokens["30d"]).toBe(1_000_000)
    expect(result.models[0].costUSD.Today).toBeGreaterThan(0)
    expect(result.models[1].costUSD.Today).toBeGreaterThan(0)
  })

  it("emits runtime model breakdown lines from CSV aggregation", async () => {
    const plugin = await loadPlugin()
    const lines = []
    const lineCtx = {
      line: {
        text: (o) => o,
      },
    }
    const modelUsage = {
      models: [
        {
          name: "composer-2",
          percent: 70,
          tokens: { Today: 1e6, "7d": 2e6, "30d": 5e6 },
          costUSD: { Today: 1.5, "7d": 3.0, "30d": 10.0 },
        },
      ],
    }
    plugin.__test.pushCursorModelUsageLines(lines, lineCtx, modelUsage)
    expect(lines).toHaveLength(1)
    expect(lines[0].label).toBe("Composer 2")
    expect(lines[0].value).toMatch(/^70%/)
    expect(lines[0].value).toContain("Today $1.50")
    expect(lines[0].value).toContain("30d $10.00")
  })
})

describe("cursor spend history assembly", () => {
  const HEADER2 =
    "Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Requests"
  // A valid Cursor access token JWT with sub "auth0|user_x" so buildSessionToken works.
  const HEADER_JSON = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const PAYLOAD_JSON = Buffer.from(JSON.stringify({ sub: "auth0|user_x" })).toString("base64url")
  const TOKEN = `${HEADER_JSON}.${PAYLOAD_JSON}.sig`

  function csvRow(dateIso, tokens) {
    return `"${dateIso}","","","free","composer-2","No","0","${tokens}","0","0","${tokens}","1"`
  }

  it("adds Today/Yesterday/Last 30 Days + Usage Trend from CSV", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const ctx = makeCtx()
      ctx.host.http.request.mockReturnValue({
        status: 200,
        bodyText:
          HEADER2 +
          "\n" +
          csvRow("2026-07-01T01:00:00.000Z", 1000000) +
          "\n" +
          csvRow("2026-06-30T01:00:00.000Z", 2000000) +
          "\n",
      })
      const plugin = await loadPlugin()
      const lines = []
      plugin.__test.appendSpendHistory(ctx, lines, TOKEN, false)

      const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]))
      expect(byLabel["Today"].type).toBe("text")
      expect(byLabel["Today"].value).toContain("1M")
      expect(byLabel["Yesterday"].value).toContain("2M")
      expect(byLabel["Last 30 Days"].value).toContain("3M")
      expect(byLabel["Usage Trend"].type).toBe("barChart")
      expect(byLabel["Usage Trend"].note).toBe("Estimated at API rates.")
      expect(byLabel["Usage Trend"].points).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("selects Today's bucket by UTC day, not local timezone", async () => {
    // Force a local timezone well behind UTC (America/New_York) so that
    // 2026-07-01T02:00:00Z (June 30 local) still resolves to the July 1 UTC
    // bucket. This reproduces the bug regardless of the host machine's TZ.
    vi.stubEnv("TZ", "America/New_York")
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T02:00:00.000Z"))
    try {
      const ctx = makeCtx()
      ctx.host.http.request.mockReturnValue({
        status: 200,
        bodyText: HEADER2 + "\n" + csvRow("2026-07-01T02:00:00.000Z", 3000000) + "\n",
      })
      const plugin = await loadPlugin()
      const lines = []
      plugin.__test.appendSpendHistory(ctx, lines, TOKEN, false)

      const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]))
      expect(byLabel["Today"].value).toContain("3M")
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })

  it("adds no lines when the CSV request fails", async () => {
    const ctx = makeCtx()
    ctx.host.http.request.mockReturnValue({ status: 500, bodyText: "" })
    const plugin = await loadPlugin()
    const lines = []
    plugin.__test.appendSpendHistory(ctx, lines, TOKEN, false)
    expect(lines).toEqual([])
    expect(ctx.host.log.warn).toHaveBeenCalled()
  })

  it("adds no lines and does not throw when request throws", async () => {
    const ctx = makeCtx()
    ctx.host.http.request.mockImplementation(() => {
      throw new Error("network down")
    })
    const plugin = await loadPlugin()
    const lines = []
    expect(() => plugin.__test.appendSpendHistory(ctx, lines, TOKEN, false)).not.toThrow()
    expect(lines).toEqual([])
  })
})

describe("cursor probe integrates spend history", () => {
  const HEADER3 =
    "Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Requests"

  it("appends Today/Yesterday/Last 30 Days/Usage Trend to a successful probe", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"))
    try {
      const ctx = makeCtx()
      // Valid access token in sqlite so probe authenticates.
      const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
      const payload = Buffer.from(JSON.stringify({ sub: "auth0|user_x", exp: 4102444800 })).toString("base64url")
      const token = `${header}.${payload}.sig`
      ctx.host.sqlite.query.mockImplementation((_db, sql) => {
        if (sql.includes("cursorAuth/accessToken")) return JSON.stringify([{ value: token }])
        return JSON.stringify([])
      })
      ctx.host.http.request.mockImplementation((opts) => {
        if (opts.url.includes("export-usage-events-csv")) {
          return {
            status: 200,
            bodyText:
              HEADER3 +
              "\n" +
              '"2026-07-01T01:00:00.000Z","","","free","composer-2","No","0","1000000","0","0","1000000","1"\n',
          }
        }
        if (opts.url.includes("GetCurrentPeriodUsage")) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              enabled: true,
              planUsage: { limit: 20, totalPercentUsed: 10, remaining: 18 },
              billingCycleStart: "1",
              billingCycleEnd: "2",
            }),
          }
        }
        // GetPlanInfo, credits, stripe: benign empty successes.
        return { status: 200, bodyText: JSON.stringify({}) }
      })

      const plugin = await loadPlugin()
      const result = plugin.probe(ctx)
      const labels = result.lines.map((l) => l.label)
      expect(labels).toEqual(expect.arrayContaining(["Today", "Yesterday", "Last 30 Days", "Usage Trend"]))
      const modelLine = result.lines.find((l) => l.label === "Composer 2")
      expect(modelLine).toBeTruthy()
      expect(modelLine.type).toBe("text")
      expect(modelLine.value).toMatch(/%/)
    } finally {
      vi.useRealTimers()
    }
  })
})
