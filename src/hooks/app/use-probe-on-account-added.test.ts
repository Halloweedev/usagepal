import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }))

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }))

import { useProbeOnAccountAdded } from "@/hooks/app/use-probe-on-account-added"
import { emitAccountsChanged } from "@/hooks/app/use-accounts"

describe("useProbeOnAccountAdded", () => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>()

  const makeArgs = () => ({
    startBatch: vi.fn(() => Promise.resolve<string[] | undefined>(undefined)),
    setLoadingForPlugins: vi.fn(),
    setErrorForPlugins: vi.fn(),
  })

  beforeEach(() => {
    handlers.clear()
    listenMock.mockReset()
    listenMock.mockImplementation(async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    })
  })

  it("probes exactly the added account on an add event", () => {
    const args = makeArgs()
    renderHook(() => useProbeOnAccountAdded(args))

    act(() => {
      emitAccountsChanged({ added: true, providerId: "claude", accountId: "work" })
    })

    // Only the added account is flagged loading; the probe targets the base
    // provider id (the backend expands it to every account).
    expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["claude::work"])
    expect(args.startBatch).toHaveBeenCalledWith(["claude"])
  })

  it("does not probe on a removal / plain reload (no detail)", () => {
    const args = makeArgs()
    renderHook(() => useProbeOnAccountAdded(args))

    act(() => {
      emitAccountsChanged()
    })

    expect(args.startBatch).not.toHaveBeenCalled()
    expect(args.setLoadingForPlugins).not.toHaveBeenCalled()
  })

  it("probes Codex when its native login-complete event fires", async () => {
    const args = makeArgs()
    renderHook(() => useProbeOnAccountAdded(args))
    await waitFor(() => expect(handlers.has("codex:login-complete")).toBe(true))

    act(() => {
      handlers.get("codex:login-complete")!({ payload: { accountId: "nicodmz02", label: "Free" } })
    })

    expect(args.setLoadingForPlugins).toHaveBeenCalledWith(["codex::nicodmz02"])
    expect(args.startBatch).toHaveBeenCalledWith(["codex"])
  })

  it("clears the spinner if the probe batch fails to start", async () => {
    const args = makeArgs()
    args.startBatch = vi.fn(() => Promise.reject(new Error("nope")))
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderHook(() => useProbeOnAccountAdded(args))

    act(() => {
      emitAccountsChanged({ added: true, providerId: "cursor", accountId: "x" })
    })

    await waitFor(() =>
      expect(args.setErrorForPlugins).toHaveBeenCalledWith(["cursor::x"], expect.any(String))
    )
  })
})
