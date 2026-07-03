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

  it("merges Today/7d/30d cost into each model's existing % line", async () => {
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

    // opus tokens: 60 (today) + 100 (3d ago) + 100 (10d ago) = 260. sonnet tokens: 40 (today only).
    // Total = 300, so opus = 260/300 = 86.7%, sonnet = 40/300 = 13.3%.
    // opus cost: Today=3, 7d=3+4=7 (10d-ago entry is outside the 7d window), 30d=3+4+2=9.
    // sonnet cost: only contributes on "today", which is inside every window, so Today=7d=30d=2.
    const opus = result.lines.find((line) => line.label === "claude-opus-4-8")
    const sonnet = result.lines.find((line) => line.label === "claude-sonnet-4-6")
    expect(opus).toMatchObject({ type: "text", value: "86.7% · Today $3.00 · 7d $7.00 · 30d $9.00" })
    expect(sonnet).toMatchObject({ type: "text", value: "13.3% · Today $2.00 · 7d $2.00 · 30d $2.00" })

    // No separate period-suffixed lines exist anymore.
    expect(result.lines.find((line) => line.label === "claude-opus-4-8 · Today")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "claude-opus-4-8 · 7d")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "claude-opus-4-8 · 30d")).toBeUndefined()
  })

  it("omits Today/7d segments for a model with cost only outside those windows", async () => {
    const tenDaysAgoKey = localDayKey(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000))
    const ctx = makeProbeCtx({
      ccusageResult: okUsage([
        {
          date: tenDaysAgoKey,
          totalTokens: 100,
          totalCost: 5,
          modelBreakdowns: [
            { modelName: "claude-legacy-model", cost: 5, totalTokens: 100 },
          ],
        },
      ]),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    // Only model, only day -> 100% of tokens. Its only contributing day is 10 days ago,
    // which is outside both the Today and 7d windows but inside the 30d window.
    const legacy = result.lines.find((line) => line.label === "claude-legacy-model")
    expect(legacy).toMatchObject({ type: "text", value: "100% · 30d $5.00" })
  })

  it("abbreviates cost amounts of $1,000 or more", async () => {
    const todayKey = localDayKey(new Date())
    const ctx = makeProbeCtx({
      ccusageResult: okUsage([
        {
          date: todayKey,
          totalTokens: 100,
          totalCost: 1234.5,
          modelBreakdowns: [
            { modelName: "claude-big-spender", cost: 1234.5, totalTokens: 100 },
          ],
        },
      ]),
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const big = result.lines.find((line) => line.label === "claude-big-spender")
    expect(big).toMatchObject({
      type: "text",
      value: "100% · Today $1,235 · 7d $1,235 · 30d $1,235",
    })
  })
})
