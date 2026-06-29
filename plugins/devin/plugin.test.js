import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const CREDENTIALS_PATH = "~/.local/share/devin/credentials.toml"
const STATE_DB = "~/Library/Application Support/Devin/User/globalStorage/state.vscdb"
const NEXT_STATE_DB = "~/Library/Application Support/Devin - Next/User/globalStorage/state.vscdb"
const DEFAULT_API_SERVER_URL = "https://server.codeium.com"
const CLOUD_COMPAT_VERSION = "1.108.2"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

function makeCredentialsToml({
  apiKey = "devin-session-token$cli",
  apiServerUrl = "https://server.codeium.test",
} = {}) {
  return [
    `windsurf_api_key = "${apiKey}"`,
    `api_server_url = "${apiServerUrl}"`,
    'devin_api_url = "https://api.devin.ai"',
  ].join("\n")
}

function makeAuthStatus(apiKey = "devin-session-token$app") {
  return JSON.stringify([{ value: JSON.stringify({ apiKey }) }])
}

function makeQuotaResponse(overrides = {}) {
  const base = {
    userStatus: {
      planStatus: {
        planInfo: {
          planName: "Max",
          billingStrategy: "BILLING_STRATEGY_QUOTA",
        },
        dailyQuotaRemainingPercent: 100,
        weeklyQuotaRemainingPercent: 40,
        overageBalanceMicros: "964220000",
        dailyQuotaResetAtUnix: "1774080000",
        weeklyQuotaResetAtUnix: "1774166400",
      },
    },
  }

  base.userStatus.planStatus = {
    ...base.userStatus.planStatus,
    ...overrides,
    planInfo: {
      ...base.userStatus.planStatus.planInfo,
      ...(overrides.planInfo || {}),
    },
  }

  return base
}

function mockAppAuth(ctx, apiKey = "devin-session-token$app") {
  ctx.host.sqlite.query.mockImplementation((db, sql) => {
    expect(String(sql)).toContain("windsurfAuthStatus")
    return db === STATE_DB ? makeAuthStatus(apiKey) : "[]"
  })
}

describe("devin plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("loads CLI credentials first and renders quota lines", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse()),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(plugin.id).toBe("devin")
    expect(result.plan).toBe("Max")
    expect(result.lines).toEqual([
      {
        type: "progress",
        label: "Daily quota",
        used: 0,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-03-21T08:00:00.000Z",
        periodDurationMs: 24 * 60 * 60 * 1000,
      },
      {
        type: "progress",
        label: "Weekly quota",
        used: 60,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-03-22T08:00:00.000Z",
        periodDurationMs: 7 * 24 * 60 * 60 * 1000,
      },
      {
        type: "text",
        label: "Extra usage balance",
        value: "$964.22",
      },
    ])

    expect(ctx.host.sqlite.query).not.toHaveBeenCalled()
    const request = ctx.host.http.request.mock.calls[0][0]
    expect(request.url).toBe(
      "https://server.codeium.test/exa.seat_management_pb.SeatManagementService/GetUserStatus"
    )
    const sentBody = JSON.parse(String(request.bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$cli")
    expect(sentBody.metadata.ideName).toBe("devin")
    expect(sentBody.metadata.extensionName).toBe("devin")
    expect(sentBody.metadata.ideVersion).toBe(CLOUD_COMPAT_VERSION)
    expect(sentBody.metadata.extensionVersion).toBe(CLOUD_COMPAT_VERSION)
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Devin quota diagnostics source=credentials.toml")
    )
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("planName=Max")
    )
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("hasWeeklyQuotaPercent=true")
    )
  })

  it("falls back to Devin app SQLite auth and the default API server", async () => {
    const ctx = makeCtx()
    mockAppAuth(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Pro" } })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Pro")
    const request = ctx.host.http.request.mock.calls[0][0]
    expect(request.url).toBe(
      "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus"
    )
    const sentBody = JSON.parse(String(request.bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$app")
  })

  it("reads auth from the Devin - Next app when stable Devin is absent", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      expect(String(sql)).toContain("windsurfAuthStatus")
      if (db === NEXT_STATE_DB) return makeAuthStatus("devin-session-token$next")
      return "[]"
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Pro" } })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Pro")
    const queriedDbs = ctx.host.sqlite.query.mock.calls.map(([db]) => db)
    expect(queriedDbs).toContain(STATE_DB)
    expect(queriedDbs).toContain(NEXT_STATE_DB)
    const sentBody = JSON.parse(String(ctx.host.http.request.mock.calls[0][0].bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$next")
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Devin quota diagnostics source=Devin - Next app")
    )
  })

  it("falls back from a stale stable-Devin token to the Devin - Next app", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      expect(String(sql)).toContain("windsurfAuthStatus")
      if (db === STATE_DB) return makeAuthStatus("devin-session-token$stable")
      if (db === NEXT_STATE_DB) return makeAuthStatus("devin-session-token$next")
      return "[]"
    })
    ctx.host.http.request.mockImplementation((request) => {
      const body = JSON.parse(String(request.bodyText))
      if (body.metadata.apiKey === "devin-session-token$stable") {
        return { status: 401, bodyText: "{}" }
      }
      return {
        status: 200,
        bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Teams" } })),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Teams")
    expect(ctx.host.http.request).toHaveBeenCalledTimes(2)
    const triedKeys = ctx.host.http.request.mock.calls.map(
      ([request]) => JSON.parse(String(request.bodyText)).metadata.apiKey
    )
    expect(triedKeys).toEqual(["devin-session-token$stable", "devin-session-token$next"])
  })

  it("ignores plaintext API server URLs from CLI credentials", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml({
      apiServerUrl: "http://server.codeium.test",
    }))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse()),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    expect(ctx.host.http.request.mock.calls[0][0].url).toBe(
      `${DEFAULT_API_SERVER_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`
    )
  })

  it("falls back from expired CLI auth to app auth", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    mockAppAuth(ctx)
    ctx.host.http.request.mockImplementation((request) => {
      const body = JSON.parse(String(request.bodyText))
      if (body.metadata.apiKey === "devin-session-token$cli") {
        return { status: 401, bodyText: "{}" }
      }
      return {
        status: 200,
        bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Teams" } })),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Teams")
    expect(ctx.host.http.request).toHaveBeenCalledTimes(2)
  })

  it("does not call the app auth path twice when both sources have the same token", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml({
      apiServerUrl: DEFAULT_API_SERVER_URL,
    }))
    mockAppAuth(ctx, "devin-session-token$cli")
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse()),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    expect(ctx.host.http.request).toHaveBeenCalledTimes(1)
  })

  it("retries app auth when the same token has a different server URL", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml({
      apiKey: "devin-session-token$same",
      apiServerUrl: "https://stale.codeium.test",
    }))
    mockAppAuth(ctx, "devin-session-token$same")
    ctx.host.http.request.mockImplementation((request) => {
      if (request.url.startsWith("https://stale.codeium.test/")) {
        return { status: 500, bodyText: "{}" }
      }
      return {
        status: 200,
        bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Teams" } })),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Teams")
    expect(ctx.host.http.request).toHaveBeenCalledTimes(2)
    expect(ctx.host.http.request.mock.calls.map(([request]) => request.url)).toEqual([
      "https://stale.codeium.test/exa.seat_management_pb.SeatManagementService/GetUserStatus",
      `${DEFAULT_API_SERVER_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
    ])
  })

  it("throws the login hint when no auth source is available", async () => {
    const ctx = makeCtx()
    const plugin = await loadPlugin()

    expect(() => plugin.probe(ctx)).toThrow("Run devin auth login or sign in to Devin and try again.")
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("treats malformed credentials as missing auth", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, 'api_server_url = "https://server.codeium.test"')
    const plugin = await loadPlugin()

    expect(() => plugin.probe(ctx)).toThrow("Run devin auth login or sign in to Devin and try again.")
    expect(ctx.host.log.warn).toHaveBeenCalledWith("Devin credentials missing windsurf_api_key")
  })

  it("uses Devin's hidden daily quota field as weekly usage when weekly percentage is absent", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          planInfo: { hideDailyQuota: true },
          weeklyQuotaRemainingPercent: undefined,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Daily quota")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "Weekly quota")).toMatchObject({
      type: "progress",
      used: 100,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: "2026-03-22T08:00:00.000Z",
      periodDurationMs: 7 * 24 * 60 * 60 * 1000,
    })
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("hideDailyQuota=true")
    )
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("hasWeeklyQuotaPercent=false")
    )
    expect(result.lines.find((line) => line.label === "Extra usage balance")?.value).toBe("$964.22")
  })

  it("renders quota percentages when reset timestamps are absent", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          dailyQuotaResetAtUnix: undefined,
          weeklyQuotaResetAtUnix: undefined,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const dailyLine = result.lines.find((line) => line.label === "Daily quota")
    const weeklyLine = result.lines.find((line) => line.label === "Weekly quota")
    expect(dailyLine).toMatchObject({
      type: "progress",
      used: 0,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: 24 * 60 * 60 * 1000,
    })
    expect(weeklyLine).toMatchObject({
      type: "progress",
      used: 60,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: 7 * 24 * 60 * 60 * 1000,
    })
    expect(dailyLine).not.toHaveProperty("resetsAt")
    expect(weeklyLine).not.toHaveProperty("resetsAt")
  })

  it("throws quota unavailable when no displayable fields are present", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          dailyQuotaRemainingPercent: undefined,
          weeklyQuotaRemainingPercent: undefined,
          overageBalanceMicros: undefined,
        })
      ),
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Devin quota data unavailable. Try again later.")
  })

  it("omits daily quota when Devin marks it hidden", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          planInfo: { hideDailyQuota: true },
          dailyQuotaRemainingPercent: undefined,
          dailyQuotaResetAtUnix: undefined,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Daily quota")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "Weekly quota")?.used).toBe(60)
  })

  it("renders quota lines when Devin omits extra usage balance", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ overageBalanceMicros: undefined })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines).toHaveLength(2)
    expect(result.lines.find((line) => line.label === "Extra usage balance")).toBeUndefined()
  })

  it("does not probe the local language server or localhost", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(CREDENTIALS_PATH, makeCredentialsToml())
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse()),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    expect(ctx.host.ls.discover).not.toHaveBeenCalled()
    const urls = ctx.host.http.request.mock.calls.map((call) => String(call[0].url))
    expect(urls.every((url) => url.includes("exa.seat_management_pb.SeatManagementService"))).toBe(true)
    expect(urls.some((url) => url.includes("127.0.0.1"))).toBe(false)
  })
})
