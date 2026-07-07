import { describe, expect, it } from "vitest"
import {
  isRateLimitedProbeOutput,
  mergeRateLimitedProbeOutput,
} from "@/lib/probe-output-merge"
import type { PluginOutput } from "@/lib/plugin-types"

function output(
  lines: PluginOutput["lines"],
  providerId = "claude"
): PluginOutput {
  return {
    providerId,
    displayName: "Claude",
    plan: "Max 5x",
    lines,
    iconUrl: "",
  }
}

describe("probe-output-merge", () => {
  it("detects Claude rate-limited status badge", () => {
    expect(
      isRateLimitedProbeOutput(
        output([
          {
            type: "badge",
            label: "Status",
            text: "Rate limited, retry in ~5m",
            color: "#f59e0b",
          },
        ])
      )
    ).toBe(true)
  })

  it("preserves prior progress lines when rate-limited response omits them", () => {
    const previous = output([
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
    ])

    const incoming = output([
      {
        type: "badge",
        label: "Status",
        text: "Rate limited, retry in ~5m",
        color: "#f59e0b",
      },
      { type: "text", label: "Note", value: "Live usage rate limited — retry in ~5m" },
    ])

    const merged = mergeRateLimitedProbeOutput(incoming, previous)
    expect(merged.lines.map((line) => line.label)).toEqual([
      "Status",
      "Session",
      "Weekly",
      "Note",
    ])
    expect(merged.lines.find((line) => line.label === "Session")?.type).toBe("progress")
  })

  it("does not merge when incoming already has progress lines", () => {
    const previous = output([
      {
        type: "progress",
        label: "Session",
        used: 10,
        limit: 100,
        format: { kind: "percent" },
      },
    ])
    const incoming = output([
      {
        type: "badge",
        label: "Status",
        text: "Rate limited, retry in ~5m",
        color: "#f59e0b",
      },
      {
        type: "progress",
        label: "Session",
        used: 42,
        limit: 100,
        format: { kind: "percent" },
      },
    ])

    expect(mergeRateLimitedProbeOutput(incoming, previous)).toBe(incoming)
  })

  it("passes through non-rate-limited responses unchanged", () => {
    const previous = output([
      {
        type: "progress",
        label: "Session",
        used: 10,
        limit: 100,
        format: { kind: "percent" },
      },
    ])
    const incoming = output([
      {
        type: "progress",
        label: "Session",
        used: 42,
        limit: 100,
        format: { kind: "percent" },
      },
    ])

    expect(mergeRateLimitedProbeOutput(incoming, previous)).toBe(incoming)
  })
})
