import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadDefaultAccountLabels,
  removeAccountMeta,
  resolveSelectedAccountId,
  saveDefaultAccountLabels,
  setDefaultAccountLabel,
  upsertAccount,
} from "@/lib/settings"

const { storeData } = vi.hoisted(() => ({ storeData: new Map<string, unknown>() }))

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get(key: string) {
      return storeData.get(key)
    }
    async set(key: string, value: unknown) {
      storeData.set(key, value)
    }
    async save() {}
  },
}))

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

  it("returns the implicit account when nothing is selected", () => {
    expect(resolveSelectedAccountId("claude", accounts, {})).toBeNull()
  })

  it("returns the persisted selection when it still names a registered account", () => {
    expect(resolveSelectedAccountId("claude", accounts, { claude: "home" })).toBe("home")
  })

  it("falls back to the implicit account when the selection no longer exists", () => {
    expect(resolveSelectedAccountId("claude", accounts, { claude: "deleted" })).toBeNull()
  })
})

describe("setDefaultAccountLabel", () => {
  it("stores a trimmed custom name", () => {
    expect(setDefaultAccountLabel({}, "codex", "  Personal  ")).toEqual({ codex: "Personal" })
  })

  it("clears the custom name when the label is blank", () => {
    const base = { codex: "Personal", claude: "Job" }
    expect(setDefaultAccountLabel(base, "codex", "   ")).toEqual({ claude: "Job" })
    expect(setDefaultAccountLabel(base, "cursor", "")).toEqual(base)
  })

  it("round-trips through the settings store and drops non-string values on load", async () => {
    await saveDefaultAccountLabels(setDefaultAccountLabel({}, "codex", "Personal"))
    expect(await loadDefaultAccountLabels()).toEqual({ codex: "Personal" })

    storeData.set("defaultAccountLabels", { codex: 42, claude: "Work" })
    expect(await loadDefaultAccountLabels()).toEqual({ claude: "Work" })
  })
})
