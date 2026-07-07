import { renderHook, act } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProbeState } from "@/hooks/app/use-probe-state"
import type { PluginOutput } from "@/lib/plugin-types"

function rateLimitedClaudeOutput(): PluginOutput {
  return {
    providerId: "claude",
    displayName: "Claude",
    plan: "Max 5x",
    iconUrl: "",
    lines: [
      {
        type: "badge",
        label: "Status",
        text: "Rate limited, retry in ~5m",
        color: "#f59e0b",
      },
      { type: "text", label: "Note", value: "Live usage rate limited — retry in ~5m" },
    ],
  }
}

function claudeWithBars(): PluginOutput {
  return {
    providerId: "claude",
    displayName: "Claude",
    plan: "Max 5x",
    iconUrl: "",
    lines: [
      {
        type: "progress",
        label: "Session",
        used: 42,
        limit: 100,
        format: { kind: "percent" },
      },
      {
        type: "progress",
        label: "Weekly",
        used: 18,
        limit: 100,
        format: { kind: "percent" },
      },
    ],
  }
}

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

  it("keeps prior progress lines when a rate-limited probe omits them", () => {
    const { result } = renderHook(() => useProbeState({}))

    act(() => {
      result.current.handleProbeResult(claudeWithBars())
    })

    act(() => {
      result.current.handleProbeResult(rateLimitedClaudeOutput())
    })

    const labels = result.current.pluginStates.claude?.data?.lines.map((line) => line.label)
    expect(labels).toEqual(["Status", "Session", "Weekly", "Note"])
  })
})
