import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

const makeJwt = (payload) => [
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
  Buffer.from(JSON.stringify(payload)).toString("base64url"),
  "signature",
].join(".")

const MANAGED_PATH = "~/.config/usagepal/accounts/cursor/user123.json"

describe("cursor plugin — managed account seam", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("uses the managed snapshot and never reads Cursor's own stores", async () => {
    const ctx = makeCtx()
    const managedToken = makeJwt({ sub: "auth0|user123", exp: 4102444800 }) // year 2100
    ctx.host.env.get.mockImplementation((name) =>
      name === "USAGEPAL_CURSOR_AUTH_FILE" ? MANAGED_PATH : null
    )
    ctx.host.fs.writeText(
      MANAGED_PATH,
      JSON.stringify({ accessToken: managedToken, refreshToken: "managed-refresh" })
    )
    ctx.host.fs.writeText.mockClear() // ignore the test's own seed write
    ctx.host.http.request.mockReturnValue({ status: 200, headers: {}, bodyText: "{}" })

    const plugin = await loadPlugin()
    try { plugin.probe(ctx) } catch (_e) { /* downstream usage parsing is out of scope */ }

    // Managed token was used for the API call...
    const authHeaders = ctx.host.http.request.mock.calls
      .map((c) => c[0]?.headers?.Authorization)
      .filter(Boolean)
    expect(authHeaders).toContain("Bearer " + managedToken)
    // ...and Cursor's own credential stores were never read.
    expect(ctx.host.sqlite.query).not.toHaveBeenCalled()
    expect(ctx.host.keychain.readGenericPassword).not.toHaveBeenCalled()
  })

  it("falls back to Cursor's sqlite store when no managed env var is set", async () => {
    const ctx = makeCtx()
    const sqliteToken = makeJwt({ sub: "auth0|local", exp: 4102444800 })
    ctx.host.env.get.mockReturnValue(null)
    ctx.host.sqlite.query.mockImplementation((_db, sql) => {
      if (sql.includes("cursorAuth/accessToken")) return JSON.stringify([{ value: sqliteToken }])
      if (sql.includes("cursorAuth/refreshToken")) return JSON.stringify([{ value: "local-refresh" }])
      return "[]"
    })
    ctx.host.http.request.mockReturnValue({ status: 200, headers: {}, bodyText: "{}" })

    const plugin = await loadPlugin()
    try { plugin.probe(ctx) } catch (_e) { /* usage parsing out of scope */ }

    expect(ctx.host.sqlite.query).toHaveBeenCalled() // existing path is intact
  })

  it("refreshes a managed account without touching Cursor's stores", async () => {
    const ctx = makeCtx()
    const expiredToken = makeJwt({ sub: "auth0|user123", exp: 1 }) // 1970 → needs refresh
    const refreshedToken = makeJwt({ sub: "auth0|user123", exp: 4102444800 })
    ctx.host.env.get.mockImplementation((name) =>
      name === "USAGEPAL_CURSOR_AUTH_FILE" ? MANAGED_PATH : null
    )
    ctx.host.fs.writeText(
      MANAGED_PATH,
      JSON.stringify({ accessToken: expiredToken, refreshToken: "managed-refresh" })
    )
    ctx.host.fs.writeText.mockClear()
    ctx.host.http.request.mockImplementation((opts) => {
      if (String(opts.url).includes("oauth/token")) {
        return { status: 200, headers: {}, bodyText: JSON.stringify({ access_token: refreshedToken }) }
      }
      return { status: 200, headers: {}, bodyText: "{}" }
    })

    const plugin = await loadPlugin()
    try { plugin.probe(ctx) } catch (_e) { /* usage parsing out of scope */ }

    // Cursor's own stores are never written.
    expect(ctx.host.sqlite.exec).not.toHaveBeenCalled()
    expect(ctx.host.keychain.writeGenericPassword).not.toHaveBeenCalled()
    // The refreshed token is persisted ONLY to the managed snapshot file.
    const managedWrites = ctx.host.fs.writeText.mock.calls.filter((c) => c[0] === MANAGED_PATH)
    expect(managedWrites.length).toBeGreaterThan(0)
    const lastWrite = JSON.parse(managedWrites[managedWrites.length - 1][1])
    expect(lastWrite.accessToken).toBe(refreshedToken)
    expect(lastWrite.refreshToken).toBe("managed-refresh")
  })
})
