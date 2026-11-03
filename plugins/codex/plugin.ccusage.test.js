import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__usagepal_plugin
}

describe("codex plugin ccusage (removed)", () => {
  beforeEach(() => {
    delete globalThis.__usagepal_plugin
    vi.resetModules()
  })

  it("does not query ccusage for local spend tracking", async () => {
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
    ctx.host.ccusage.query.mockReturnValue({ status: "ok", data: { daily: [] } })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(ctx.host.ccusage.query).not.toHaveBeenCalled()
    expect(result.lines.find((l) => l.label === "Today")).toBeUndefined()
    expect(result.lines.find((l) => l.label === "Usage Trend")).toBeUndefined()
  })
})