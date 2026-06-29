import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { useDarkMode } from "./use-dark-mode"

describe("useDarkMode", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark")
  })

  it("returns false when dark class is not present", () => {
    const { result } = renderHook(() => useDarkMode())
    expect(result.current).toBe(false)
  })

  it("returns true when dark class is present", () => {
    document.documentElement.classList.add("dark")
    const { result } = renderHook(() => useDarkMode())
    expect(result.current).toBe(true)
  })

  it("updates when dark class is toggled", async () => {
    const { result } = renderHook(() => useDarkMode())
    expect(result.current).toBe(false)

    await act(async () => {
      document.documentElement.classList.add("dark")
      // MutationObserver is async, give it a tick
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current).toBe(true)

    await act(async () => {
      document.documentElement.classList.remove("dark")
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current).toBe(false)
  })
})
