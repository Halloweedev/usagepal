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

    const gpt55 = result.lines.find((line) => line.label === "GPT-5.5")
    const gpt5 = result.lines.find((line) => line.label === "GPT-5")
    expect(gpt55).toMatchObject({
      type: "text",
      value: "50%",
    })
    expect(gpt5).toMatchObject({
      type: "text",
      value: "50%",
    })
  })

  it("merges Today/7d/30d cost into each model's existing % line", async () => {
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

    // gpt-5.5 tokens: 60 + 100 + 100 = 260. gpt-5 tokens: 40 (today only). Total = 300.
    // gpt-5.5 = 260/300 = 86.7%, gpt-5 = 40/300 = 13.3%.
    // gpt-5.5 cost: Today=3, 7d=3+4=7, 30d=3+4+2=9. gpt-5 cost: Today=7d=30d=2 (today only).
    const gpt55 = result.lines.find((line) => line.label === "GPT-5.5")
    const gpt5 = result.lines.find((line) => line.label === "GPT-5")
    expect(gpt55).toMatchObject({ type: "text", value: "86.7% · Today $3.00 · 7d $7.00 · 30d $9.00" })
    expect(gpt5).toMatchObject({ type: "text", value: "13.3% · Today $2.00 · 7d $2.00 · 30d $2.00" })

    expect(result.lines.find((line) => line.label === "gpt-5.5 · Today")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "gpt-5.5 · 7d")).toBeUndefined()
    expect(result.lines.find((line) => line.label === "gpt-5.5 · 30d")).toBeUndefined()
  })

  it("omits Today/7d segments for a model with cost only outside those windows", async () => {
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
            date: dayKey(10),
            totalTokens: 100,
            totalCost: 5,
            modelBreakdowns: [
              { modelName: "gpt-legacy", cost: 5, totalTokens: 100 },
            ],
          },
        ],
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const legacy = result.lines.find((line) => line.label === "gpt-legacy")
    expect(legacy).toMatchObject({ type: "text", value: "100% · 30d $5.00" })
  })

  it("abbreviates cost amounts of $1,000 or more", async () => {
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
            totalCost: 1234.5,
            modelBreakdowns: [
              { modelName: "gpt-big-spender", cost: 1234.5, totalTokens: 100 },
            ],
          },
        ],
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const big = result.lines.find((line) => line.label === "gpt-big-spender")
    expect(big).toMatchObject({
      type: "text",
      value: "100% · Today $1,235 · 7d $1,235 · 30d $1,235",
    })
  })

  it("leaves an unrecognized model id unchanged", async () => {
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
            totalCost: 1,
            modelBreakdowns: [
              { modelName: "some-custom-model", cost: 1, totalTokens: 100 },
            ],
          },
        ],
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const custom = result.lines.find((line) => line.label === "some-custom-model")
    expect(custom).toMatchObject({
      type: "text",
      value: "100% · Today $1.00 · 7d $1.00 · 30d $1.00",
    })
  })
})
