import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

// Relative local day key so fixtures stay inside the rolling trend window.
function dayKey(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return year + "-" + month + "-" + day
}

describe("codex plugin ccusage usage trend", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("adds model percentage text lines and a usage chart from codex ccusage", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText("~/.codex/auth.json", JSON.stringify({
      tokens: { access_token: "token" },
      last_refresh: new Date().toISOString(),
    }))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      headers: { "x-codex-primary-used-percent": "10" },
      bodyText: JSON.stringify({}),
    })
    ctx.host.ccusage.query.mockReturnValue({
      status: "ok",
      data: {
        daily: [
          {
            date: dayKey(0),
            totalTokens: 300,
            models: {
              "gpt-5.5": { totalTokens: 200 },
              "gpt-5": { totalTokens: 100 },
            },
          },
          {
            date: dayKey(1),
            totalTokens: 150,
            models: {
              "gpt-5": { inputTokens: 30, cachedInputTokens: 20, outputTokens: 50 },
            },
          },
        ],
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const chart = result.lines.find((line) => line.label === "Usage Trend")
    expect(chart).toMatchObject({
      type: "barChart",
      note: "Estimated from local Codex logs for the selected account.",
    })
    expect(chart.points.map((point) => point.value)).toEqual([150, 300])

    const gpt55 = result.lines.find((line) => line.label === "gpt-5.5")
    const gpt5 = result.lines.find((line) => line.label === "gpt-5")
    expect(gpt55).toMatchObject({
      type: "text",
      value: "50%",
    })
    expect(gpt5).toMatchObject({
      type: "text",
      value: "50%",
    })
  })

  it("adds per-model, per-period cost lines from modelBreakdowns", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText("~/.codex/auth.json", JSON.stringify({
      tokens: { access_token: "token" },
      last_refresh: new Date().toISOString(),
    }))
    ctx.host.http.request.mockReturnValue({
      status: 200,
      headers: { "x-codex-primary-used-percent": "10" },
      bodyText: JSON.stringify({}),
    })
    ctx.host.ccusage.query.mockReturnValue({
      status: "ok",
      data: {
        daily: [
          {
            date: dayKey(0),
            totalTokens: 100,
            totalCost: 5,
            modelBreakdowns: [
              { modelName: "gpt-5.5", cost: 3, totalTokens: 60 },
              { modelName: "gpt-5", cost: 2, totalTokens: 40 },
            ],
          },
          {
            date: dayKey(3),
            totalTokens: 100,
            totalCost: 4,
            modelBreakdowns: [
              { modelName: "gpt-5.5", cost: 4, totalTokens: 100 },
            ],
          },
          {
            date: dayKey(10),
            totalTokens: 100,
            totalCost: 2,
            modelBreakdowns: [
              { modelName: "gpt-5.5", cost: 2, totalTokens: 100 },
            ],
          },
          {
            // No modelBreakdowns at all: must be skipped without throwing.
            date: dayKey(1),
            totalTokens: 50,
            totalCost: 1,
          },
        ],
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const gpt55Today = result.lines.find((line) => line.label === "gpt-5.5 · Today")
    const gpt5Today = result.lines.find((line) => line.label === "gpt-5 · Today")
    const gpt557d = result.lines.find((line) => line.label === "gpt-5.5 · 7d")
    const gpt57d = result.lines.find((line) => line.label === "gpt-5 · 7d")
    const gpt5530d = result.lines.find((line) => line.label === "gpt-5.5 · 30d")
    const gpt530d = result.lines.find((line) => line.label === "gpt-5 · 30d")

    expect(gpt55Today).toMatchObject({ type: "text", value: "$3.00" })
    expect(gpt5Today).toMatchObject({ type: "text", value: "$2.00" })
    // 7d = today (3) + 3-days-ago (4) = 7; the 10-days-ago entry is outside the 7d window.
    expect(gpt557d).toMatchObject({ type: "text", value: "$7.00" })
    expect(gpt57d).toMatchObject({ type: "text", value: "$2.00" })
    // 30d = all three modelBreakdowns entries: 3 + 4 + 2 = 9.
    expect(gpt5530d).toMatchObject({ type: "text", value: "$9.00" })
    expect(gpt530d).toMatchObject({ type: "text", value: "$2.00" })
  })
})
