import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: state.invokeMock }))
vi.mock("@/stores/app-notifications-store", () => ({ useAppNotificationsStore: vi.fn() }))

import { deliverPaceNotification } from "./use-pace-notifications"

describe("usePaceNotifications", () => {
  beforeEach(() => {
    state.invokeMock.mockClear()
    state.invokeMock.mockResolvedValue(undefined)
  })

  it("delivers pace alerts through the native command that applies the bundled macOS app icon", async () => {
    await deliverPaceNotification({
      title: "Almost Out",
      body: "Claude Session — Under 10% usage remaining for this window.",
    })

    await waitFor(() => {
      expect(state.invokeMock).toHaveBeenCalledWith("send_pace_notification", {
        title: "Almost Out",
        body: "Claude Session — Under 10% usage remaining for this window.",
      })
    })
  })
})
