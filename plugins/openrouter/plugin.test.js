import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const mockEnvKey = (ctx, key, varName = "OPENROUTER_API_KEY") => {
  ctx.host.env.get.mockImplementation((name) => (name === varName ? key : null))
}

const CREDITS = { data: { total_credits: 100, total_usage: 40 } }
const KEY = {
  data: {
    is_free_tier: false,
    usage_daily: 1.5,
    usage_weekly: 8,
    usage_monthly: 30,
    limit: null,
    usage: 40,
  },
}

const mockEndpoints = (ctx, { credits = CREDITS, key = KEY } = {}) => {
  ctx.host.http.request.mockImplementation((opts) => {
    if (opts.url.includes("/credits")) {
      return credits === null
        ? { status: 500, bodyText: "" }
        : { status: 200, bodyText: JSON.stringify(credits) }
    }
    if (opts.url.includes("/key")) {
      return key === null
        ? { status: 500, bodyText: "" }
        : { status: 200, bodyText: JSON.stringify(key) }
    }
    return { status: 404, bodyText: "" }
  })
}

const findLine = (result, label) => result.lines.find((l) => l.label === label)

describe("openrouter plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    if (vi.resetModules) vi.resetModules()
  })

  it("throws when no API key is configured", async () => {
    const ctx = makeCtx()
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("No OpenRouter API key")
  })

  it("reads the key from the environment and sends it as a Bearer token", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "sk-or-env")
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.headers.Authorization).toBe("Bearer sk-or-env")
  })

  it("prefers a config-file key over an environment key", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "sk-or-env")
    ctx.host.fs.exists = (p) => p === "~/.config/usagepal/openrouter.json"
    ctx.host.fs.readText = () => JSON.stringify({ apiKey: "sk-or-config" })
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.headers.Authorization).toBe("Bearer sk-or-config")
  })

  it("accepts a plain-text config key file", async () => {
    const ctx = makeCtx()
    ctx.host.fs.exists = (p) => p === "~/.config/openrouter/key.json"
    ctx.host.fs.readText = () => "  sk-or-plain\n"
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    plugin.probe(ctx)
    const call = ctx.host.http.request.mock.calls[0][0]
    expect(call.headers.Authorization).toBe("Bearer sk-or-plain")
  })

  it("maps the Credits meter and Balance from /credits", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "k")
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const credits = findLine(result, "Credits")
    expect(credits.type).toBe("progress")
    expect(credits.used).toBe(40)
    expect(credits.limit).toBe(100)
    expect(credits.format.kind).toBe("dollars")
    expect(findLine(result, "Balance").value).toBe("$60.00")
  })

  it("omits the Credits meter but keeps Balance for a never-topped-up account", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "k")
    mockEndpoints(ctx, { credits: { data: { total_credits: 0, total_usage: 0 } } })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Credits")).toBeUndefined()
    expect(findLine(result, "Balance").value).toBe("$0.00")
  })

  it("maps period spend and plan from /key", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "k")
    mockEndpoints(ctx)
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Today").value).toBe("$1.50")
    expect(findLine(result, "This Week").value).toBe("$8.00")
    expect(findLine(result, "This Month").value).toBe("$30.00")
    expect(result.plan).toBe("Pay as you go")
  })

  it("shows a Key Limit meter only when the key has a cap", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "k")
    mockEndpoints(ctx, {
      key: { data: { is_free_tier: true, usage: 12, limit: 50 } },
    })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const keyLimit = findLine(result, "Key Limit")
    expect(keyLimit.type).toBe("progress")
    expect(keyLimit.used).toBe(12)
    expect(keyLimit.limit).toBe(50)
    expect(result.plan).toBe("Free tier")
  })

  it("still renders the balance when /key fails", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "k")
    mockEndpoints(ctx, { key: null })
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(findLine(result, "Balance").value).toBe("$60.00")
    expect(result.plan).toBeNull()
  })

  it("throws 'API key invalid' on a 401 from /credits", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "bad")
    ctx.host.http.request.mockReturnValue({ status: 401, bodyText: "" })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("API key invalid")
  })

  it("throws a connection error when /credits cannot be reached", async () => {
    const ctx = makeCtx()
    mockEnvKey(ctx, "k")
    ctx.host.http.request.mockImplementation((opts) => {
      if (opts.url.includes("/credits")) throw new Error("ECONNREFUSED")
      return { status: 200, bodyText: JSON.stringify(KEY) }
    })
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("Couldn't reach OpenRouter")
  })
})
