import { describe, expect, it } from "vitest"
import { removeAccountMeta, upsertAccount } from "@/lib/settings"

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
