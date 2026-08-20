import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const DEFAULT_API_SERVER_URL = "https://server.codeium.com"
const CLOUD_COMPAT_VERSION = "1.108.2"
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

const CREDENTIALS_PATH = "~/.local/share/devin/credentials.toml"
const WIN_CREDENTIALS_PATH = "~/AppData/Roaming/devin/credentials.toml"
const MACOS_STATE_DB = "~/Library/Application Support/Devin/User/globalStorage/state.vscdb"
const MACOS_NEXT_STATE_DB = "~/Library/Application Support/Devin - Next/User/globalStorage/state.vscdb"
const LINUX_STATE_DB = "~/.config/Devin/User/globalStorage/state.vscdb"
const LINUX_NEXT_STATE_DB = "~/.config/Devin - Next/User/globalStorage/state.vscdb"
const WIN_STATE_DB = "~/AppData/Roaming/Devin/User/globalStorage/state.vscdb"
const WIN_NEXT_STATE_DB = "~/AppData/Roaming/Devin - Next/User/globalStorage/state.vscdb"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

function credentialsPath(platform) {
  const norm = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform
  if (norm === "windows") return WIN_CREDENTIALS_PATH
  return CREDENTIALS_PATH
}

function appStateDb(platform, appName = "Devin") {
  const norm = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform
  if (norm === "macos") return `~/Library/Application Support/${appName}/User/globalStorage/state.vscdb`
  if (norm === "linux") return `~/.config/${appName}/User/globalStorage/state.vscdb`
  if (norm === "windows") return `~/AppData/Roaming/${appName}/User/globalStorage/state.vscdb`
  return `~/Library/Application Support/${appName}/User/globalStorage/state.vscdb`
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
  const stableDb = appStateDb(ctx.app.platform, "Devin")
  ctx.host.sqlite.query.mockImplementation((db, sql) => {
    expect(String(sql)).toContain("windsurfAuthStatus")
    return db === stableDb ? makeAuthStatus(apiKey) : "[]"
  })
}

function writeCredentials(ctx, toml = makeCredentialsToml()) {
  ctx.host.fs.writeText(credentialsPath(ctx.app.platform), toml)
}

describe("devin plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("loads CLI credentials first and renders quota lines", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
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
        label: "Weekly quota",
        used: 60,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-03-22T08:00:00.000Z",
        periodDurationMs: WEEK_MS,
      },
      {
        type: "progress",
        label: "Daily quota",
        used: 0,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-03-21T08:00:00.000Z",
        periodDurationMs: DAY_MS,
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

  it("prefers DEVIN_API_KEY env over credentials file", async () => {
    const ctx = makeCtx()
    ctx.host.env.get.mockImplementation((name) =>
      name === "DEVIN_API_KEY" ? "devin-session-token$env" : null
    )
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Env" } })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Env")
    expect(ctx.host.http.request).toHaveBeenCalledTimes(1)
    const request = ctx.host.http.request.mock.calls[0][0]
    expect(request.url).toBe(
      `${DEFAULT_API_SERVER_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`
    )
    const sentBody = JSON.parse(String(request.bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$env")
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("source=env:DEVIN_API_KEY")
    )
  })

  it("falls back to credentials file when DEVIN_API_KEY env auth fails", async () => {
    const ctx = makeCtx()
    ctx.host.env.get.mockImplementation((name) =>
      name === "DEVIN_API_KEY" ? "devin-session-token$env" : null
    )
    writeCredentials(ctx)
    ctx.host.http.request.mockImplementation((request) => {
      const body = JSON.parse(String(request.bodyText))
      if (body.metadata.apiKey === "devin-session-token$env") {
        return { status: 401, bodyText: "{}" }
      }
      return {
        status: 200,
        bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Max" } })),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Max")
    expect(ctx.host.http.request).toHaveBeenCalledTimes(2)
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
      `${DEFAULT_API_SERVER_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`
    )
    const sentBody = JSON.parse(String(request.bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$app")
  })

  it("reads auth from the Devin - Next app when stable Devin is absent", async () => {
    const ctx = makeCtx()
    const nextDb = appStateDb(ctx.app.platform, "Devin - Next")
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      expect(String(sql)).toContain("windsurfAuthStatus")
      return db === nextDb ? makeAuthStatus("devin-session-token$next") : "[]"
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Pro" } })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Pro")
    const queriedDbs = ctx.host.sqlite.query.mock.calls.map(([db]) => db)
    expect(queriedDbs).toContain(appStateDb(ctx.app.platform, "Devin"))
    expect(queriedDbs).toContain(nextDb)
    const sentBody = JSON.parse(String(ctx.host.http.request.mock.calls[0][0].bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$next")
    expect(ctx.host.log.info).toHaveBeenCalledWith(
      expect.stringContaining("source=Devin - Next app")
    )
  })

  it("falls back from a stale stable-Devin token to the Devin - Next app", async () => {
    const ctx = makeCtx()
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      expect(String(sql)).toContain("windsurfAuthStatus")
      if (db === appStateDb(ctx.app.platform, "Devin")) return makeAuthStatus("devin-session-token$stable")
      if (db === appStateDb(ctx.app.platform, "Devin - Next")) return makeAuthStatus("devin-session-token$next")
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
    writeCredentials(ctx, makeCredentialsToml({
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
    writeCredentials(ctx)
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
    writeCredentials(ctx, makeCredentialsToml({
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
    writeCredentials(ctx, makeCredentialsToml({
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
    ctx.host.fs.writeText(credentialsPath(ctx.app.platform), 'api_server_url = "https://server.codeium.test"')
    const plugin = await loadPlugin()

    expect(() => plugin.probe(ctx)).toThrow("Run devin auth login or sign in to Devin and try again.")
    expect(ctx.host.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Devin credentials missing windsurf_api_key")
    )
  })

  it("uses Devin's hidden daily quota field as weekly usage when weekly percentage is absent", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
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
      periodDurationMs: WEEK_MS,
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
    writeCredentials(ctx)
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
      periodDurationMs: DAY_MS,
    })
    expect(weeklyLine).toMatchObject({
      type: "progress",
      used: 60,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: WEEK_MS,
    })
    expect(dailyLine).not.toHaveProperty("resetsAt")
    expect(weeklyLine).not.toHaveProperty("resetsAt")
  })

  it("throws quota unavailable when no displayable fields are present", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
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
    writeCredentials(ctx)
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
    writeCredentials(ctx)
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
    writeCredentials(ctx)
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

  it("uses Linux credentials and state DB paths", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "linux"
    ctx.host.fs.writeText(LINUX_STATE_DB, "irrelevant")
    ctx.host.fs.writeText(LINUX_NEXT_STATE_DB, "irrelevant")
    ctx.host.sqlite.query.mockImplementation((db, sql) => {
      expect(String(sql)).toContain("windsurfAuthStatus")
      if (db === LINUX_STATE_DB) return makeAuthStatus("devin-session-token$linux")
      return "[]"
    })
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Pro" } })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Pro")
    const request = ctx.host.http.request.mock.calls[0][0]
    expect(request.url).toBe(
      `${DEFAULT_API_SERVER_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`
    )
    const sentBody = JSON.parse(String(request.bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$linux")
    expect(result.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Weekly quota" }),
        expect.objectContaining({ label: "Daily quota" }),
      ])
    )
  })

  it("uses Windows credentials and state DB paths", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "windows"
    ctx.host.fs.writeText(WIN_CREDENTIALS_PATH, makeCredentialsToml({
      apiKey: "devin-session-token$win",
      apiServerUrl: DEFAULT_API_SERVER_URL,
    }))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(makeQuotaResponse({ planInfo: { planName: "Teams" } })),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Teams")
    const request = ctx.host.http.request.mock.calls[0][0]
    expect(request.url).toBe(
      `${DEFAULT_API_SERVER_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus`
    )
    const sentBody = JSON.parse(String(request.bodyText))
    expect(sentBody.metadata.apiKey).toBe("devin-session-token$win")
    expect(ctx.host.sqlite.query).not.toHaveBeenCalled()
  })

  it("renders ACU used progress for enterprise-shaped payloads", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          acuConsumed: 500,
          acuLimit: 1000,
          planStart: 1766908800,
          planEnd: 1769500800,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const acuLine = result.lines.find((line) => line.label === "ACU used")
    expect(acuLine).toMatchObject({
      type: "progress",
      used: 50,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: 30 * DAY_MS,
    })
    expect(acuLine.resetsAt).toBe("2026-01-27T08:00:00.000Z")
  })

  it("does not render ACU used when ACU fields are missing or zero", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          acuConsumed: 0,
          acuLimit: 0,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "ACU used")).toBeUndefined()
  })

  it("renders unlimited prompt credits as a badge", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          availablePromptCredits: -1,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const promptLine = result.lines.find((line) => line.label === "Prompt credits")
    expect(promptLine).toEqual({
      type: "badge",
      label: "Prompt credits",
      text: "Unlimited",
      color: "#a3a3a3",
    })
  })

  it("renders on-demand flex credits as a progress line", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          availableFlexCredits: 100,
          usedFlexCredits: 25,
          planStart: 1766908800,
          planEnd: 1769500800,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const onDemandLine = result.lines.find((line) => line.label === "On-demand credits")
    expect(onDemandLine).toMatchObject({
      type: "progress",
      used: 20,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: 30 * DAY_MS,
    })
    expect(onDemandLine.resetsAt).toBe("2026-01-27T08:00:00.000Z")
  })

  it("renders a Pace badge when usage is behind schedule", async () => {
    const ctx = makeCtx()
    ctx.nowIso = "2026-03-18T20:00:00.000Z"
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          weeklyQuotaRemainingPercent: 45,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const paceBadge = result.lines.find((line) => line.label === "Pace")
    expect(paceBadge).toEqual({
      type: "badge",
      label: "Pace",
      text: "Behind",
      color: "#ef4444",
    })
  })

  it("does not map daily to weekly when weekly percent is present and daily is hidden", async () => {
    const ctx = makeCtx()
    writeCredentials(ctx)
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify(
        makeQuotaResponse({
          planInfo: { hideDailyQuota: true },
          dailyQuotaRemainingPercent: undefined,
          weeklyQuotaRemainingPercent: 25,
        })
      ),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const weeklyLine = result.lines.find((line) => line.label === "Weekly quota")
    expect(weeklyLine).toMatchObject({ used: 75 })
    expect(result.lines.find((line) => line.label === "Daily quota")).toBeUndefined()
  })

  describe("buildPaceBadge", () => {
    it("classifies ahead, on-track, and behind", async () => {
      const ctx = makeCtx()
      ctx.nowIso = "2026-03-18T20:00:00.000Z"

      const plugin = await loadPlugin()
      const buildPaceBadge = plugin.__test.buildPaceBadge

      const base = {
        type: "progress",
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-03-22T08:00:00.000Z",
        periodDurationMs: WEEK_MS,
      }

      expect(buildPaceBadge(ctx, { ...base, used: 10 })).toEqual({
        type: "badge",
        label: "Pace",
        text: "Ahead",
        color: "#22c55e",
      })

      expect(buildPaceBadge(ctx, { ...base, used: 45 })).toEqual({
        type: "badge",
        label: "Pace",
        text: "On track",
        color: "#a3a3a3",
      })

      expect(buildPaceBadge(ctx, { ...base, used: 55 })).toEqual({
        type: "badge",
        label: "Pace",
        text: "Behind",
        color: "#ef4444",
      })
    })

    it("returns null for a fresh period", async () => {
      const ctx = makeCtx()
      ctx.nowIso = "2026-03-15T10:00:00.000Z"

      const plugin = await loadPlugin()
      const buildPaceBadge = plugin.__test.buildPaceBadge

      expect(buildPaceBadge(ctx, {
        type: "progress",
        used: 10,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: "2026-03-22T08:00:00.000Z",
        periodDurationMs: WEEK_MS,
      })).toBeNull()
    })
  })

  describe("buildOutput", () => {
    it("exposes cross-platform auth source paths", async () => {
      const plugin = await loadPlugin()
      const ctx = makeCtx()

      expect(plugin.__test.credentialsPaths({ app: { platform: "windows" } })).toEqual([
        WIN_CREDENTIALS_PATH,
      ])
      expect(plugin.__test.credentialsPaths({ app: { platform: "linux" } })).toEqual([
        CREDENTIALS_PATH,
      ])
      expect(plugin.__test.credentialsPaths({ app: { platform: "macos" } })).toEqual([
        CREDENTIALS_PATH,
      ])

      expect(plugin.__test.appAuthSources({ app: { platform: "linux" } })).toEqual([
        { source: "Devin app", stateDb: LINUX_STATE_DB },
        { source: "Devin - Next app", stateDb: LINUX_NEXT_STATE_DB },
      ])
      expect(plugin.__test.appAuthSources({ app: { platform: "windows" } })).toEqual([
        { source: "Devin app", stateDb: WIN_STATE_DB },
        { source: "Devin - Next app", stateDb: WIN_NEXT_STATE_DB },
      ])
    })
  })
})
