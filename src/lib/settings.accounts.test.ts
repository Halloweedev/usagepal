import { describe, expect, it } from "vitest"
import { removeAccountMeta, resolveSelectedAccountId, upsertAccount } from "@/lib/settings"

describe("account metadata helpers", () => {
  it("appends a new account with the next order", () => {
    const next = upsertAccount({}, "claude", { accountId: "a1", label: "Work", order: 0 })
    expect(next.claude).toEqual([{ accountId: "a1", label: "Work", order: 0 }])
  })

  it("replaces an existing account by id, preserving others", () => {
    const base = { claude: [{ accountId: "a1", label: "Work", order: 0 }] }
    const next = upsertAccount(base, "claude", { accountId: "a1", label: "Job", order: 0 })
    expect(next.claude).toEqual([{ accountId: "a1", label: "Job", order: 0 }])
  })

  it("removes an account by id and drops empty providers", () => {
    const base = { claude: [{ accountId: "a1", label: "Work", order: 0 }] }
    expect(removeAccountMeta(base, "claude", "a1")).toEqual({})
  })
})

describe("resolveSelectedAccountId", () => {
  const accounts = {
    claude: [
      { accountId: "work", label: "Work", order: 0 },
      { accountId: "home", label: "Home", order: 1 },
    ],
  }

  it("returns null for a provider with no registered accounts", () => {
    expect(resolveSelectedAccountId("codex", {}, {})).toBeNull()
  })

  it("returns the primary (lowest-order) account when nothing is selected", () => {
    expect(resolveSelectedAccountId("claude", accounts, {})).toBe("work")
  })

  it("returns the persisted selection when it still names a registered account", () => {
    expect(resolveSelectedAccountId("claude", accounts, { claude: "home" })).toBe("home")
  })

  it("falls back to the primary when the selection no longer exists", () => {
    expect(resolveSelectedAccountId("claude", accounts, { claude: "deleted" })).toBe("work")
  })
})
