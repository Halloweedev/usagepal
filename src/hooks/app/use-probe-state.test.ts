import { renderHook, act } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProbeState } from "@/hooks/app/use-probe-state"

describe("useProbeState", () => {
  it("updates pluginStatesRef synchronously when marking plugins loading", () => {
    const { result } = renderHook(() => useProbeState({}))

    let loadingImmediatelyAfterSet: boolean | undefined
    act(() => {
      result.current.setLoadingForPlugins(["codex"])
      loadingImmediatelyAfterSet =
        result.current.pluginStatesRef.current.codex?.loading
    })

    expect(loadingImmediatelyAfterSet).toBe(true)
    expect(result.current.pluginStates.codex?.loading).toBe(true)
  })

  it("signals onProbeResult when cached snapshots are applied (tray refresh)", () => {
    const onProbeResult = vi.fn()
    const { result } = renderHook(() => useProbeState({ onProbeResult }))

    act(() => {
      result.current.applyCachedSnapshots([
        {
          providerId: "codex",
          displayName: "Codex",
          lines: [],
          fetchedAt: "2026-07-05T00:00:00.000Z",
        },
      ])
    })

    expect(onProbeResult).toHaveBeenCalledTimes(1)
  })

  it("does not signal onProbeResult when no snapshots are applied", () => {
    const onProbeResult = vi.fn()
    const { result } = renderHook(() => useProbeState({ onProbeResult }))

    act(() => {
      result.current.applyCachedSnapshots([])
    })

    expect(onProbeResult).not.toHaveBeenCalled()
  })
})
