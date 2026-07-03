import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

// Minimal credential + usage stubs so the probe reaches the ccusage path.
const CRED_JSON = JSON.stringify({ claudeAiOauth: { accessToken: "tok", subscriptionType: "pro" } })
const USAGE_RESPONSE = JSON.stringify({
  five_hour: { utilization: 30, resets_at: "2099-01-01T00:00:00.000Z" },
  seven_day: { utilization: 50, resets_at: "2099-01-01T00:00:00.000Z" },
})

function makeProbeCtx({ ccusageResult = { status: "runner_failed" } } = {}) {
  const ctx = makeCtx()
  ctx.host.fs.exists = () => true
  ctx.host.fs.readText = () => CRED_JSON
  ctx.host.http.request.mockReturnValue({ status: 200, bodyText: USAGE_RESPONSE })
  ctx.host.ccusage.query = vi.fn(() => ccusageResult)
  return ctx
}

const okUsage = (daily) => ({ status: "ok", data: { daily } })

function localDayKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return year + "-" + month + "-" + day
}

describe("claude plugin ccusage usage trend", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("adds model percentage text lines and a usage chart from claude ccusage", async () => {
    const todayKey = localDayKey(new Date())
    const yesterdayKey = localDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const ctx = makeProbeCtx({
      ccusageResult: okUsage([
        {
          date: todayKey,
          totalTokens: 300,
          totalCost: 1,
          modelBreakdowns: [
            { modelName: "claude-sonnet-4-20250514", totalTokens: 200 },
            { modelName: "claude-opus-4-1-20250805", totalTokens: 100 },
          ],
        },
        {
          date: yesterdayKey,
          totalTokens: 150,
          totalCost: 1,
          modelBreakdowns: [
            {
              modelName: "claude-opus-4-1-20250805",
              inputTokens: 30,
              cacheCreationTokens: 20,
              cacheReadTokens: 20,
              outputTokens: 30,
            },
          ],
        },
      ]),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const chart = result.lines.find((line) => line.label === "Usage Trend")
    expect(chart).toMatchObject({
      type: "barChart",
      note: "Estimated from local Claude logs at API rates.",
    })
    expect(chart.points.map((point) => point.value)).toEqual([150, 300])

    const sonnet = result.lines.find((line) => line.label === "claude-sonnet-4-20250514")
    const opus = result.lines.find((line) => line.label === "claude-opus-4-1-20250805")
    expect(sonnet).toMatchObject({
      type: "text",
      value: "50%",
    })
    expect(opus).toMatchObject({
      type: "text",
      value: "50%",
    })
  })

  it("adds per-model, per-period cost lines from modelBreakdowns", async () => {
    const todayKey = localDayKey(new Date())
    const threeDaysAgoKey = localDayKey(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
    const tenDaysAgoKey = localDayKey(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000))
    const ctx = makeProbeCtx({
      ccusageResult: okUsage([
        {
          date: todayKey,
          totalTokens: 100,
          totalCost: 5,
          modelBreakdowns: [
            { modelName: "claude-opus-4-8", cost: 3, totalTokens: 60 },
            { modelName: "claude-sonnet-4-6", cost: 2, totalTokens: 40 },
          ],
        },
        {
          date: threeDaysAgoKey,
          totalTokens: 100,
          totalCost: 4,
          modelBreakdowns: [
            { modelName: "claude-opus-4-8", cost: 4, totalTokens: 100 },
          ],
        },
        {
          date: tenDaysAgoKey,
          totalTokens: 100,
          totalCost: 2,
          modelBreakdowns: [
            { modelName: "claude-opus-4-8", cost: 2, totalTokens: 100 },
          ],
        },
        {
          // No modelBreakdowns at all: must be skipped without throwing, and must not
          // contribute to any per-model bucket.
          date: localDayKey(new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)),
          totalTokens: 50,
          totalCost: 1,
        },
      ]),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const opusToday = result.lines.find((line) => line.label === "claude-opus-4-8 · Today")
    const sonnetToday = result.lines.find((line) => line.label === "claude-sonnet-4-6 · Today")
    const opus7d = result.lines.find((line) => line.label === "claude-opus-4-8 · 7d")
    const sonnet7d = result.lines.find((line) => line.label === "claude-sonnet-4-6 · 7d")
    const opus30d = result.lines.find((line) => line.label === "claude-opus-4-8 · 30d")
    const sonnet30d = result.lines.find((line) => line.label === "claude-sonnet-4-6 · 30d")

    expect(opusToday).toMatchObject({ type: "text", value: "$3.00" })
    expect(sonnetToday).toMatchObject({ type: "text", value: "$2.00" })
    // 7d = today (3) + 3-days-ago (4) = 7; the 10-days-ago entry is outside the 7d window.
    expect(opus7d).toMatchObject({ type: "text", value: "$7.00" })
    expect(sonnet7d).toMatchObject({ type: "text", value: "$2.00" })
    // 30d = all three modelBreakdowns entries: 3 + 4 + 2 = 9.
    expect(opus30d).toMatchObject({ type: "text", value: "$9.00" })
    expect(sonnet30d).toMatchObject({ type: "text", value: "$2.00" })
  })
})
