import { beforeEach, describe, expect, it, vi } from "vitest"

const { toBlobMock, writeImageMock } = vi.hoisted(() => ({
  toBlobMock: vi.fn(),
  writeImageMock: vi.fn(),
}))

vi.mock("html-to-image", () => ({ toBlob: toBlobMock }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeImage: writeImageMock }))

import { copyCardImage } from "@/lib/share-image"

describe("copyCardImage", () => {
  beforeEach(() => {
    toBlobMock.mockReset()
    writeImageMock.mockReset()
  })

  it("renders the node to a PNG blob and writes the raw bytes to the clipboard", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    toBlobMock.mockResolvedValue(new Blob([bytes]))
    writeImageMock.mockResolvedValue(undefined)

    const node = document.createElement("div")
    await copyCardImage(node)

    expect(toBlobMock).toHaveBeenCalledWith(node, { pixelRatio: 3 })
    expect(writeImageMock).toHaveBeenCalledTimes(1)
    const written = writeImageMock.mock.calls[0]![0] as Uint8Array
    expect(Array.from(written)).toEqual([1, 2, 3, 4])
  })

  it("respects a custom pixelRatio option", async () => {
    toBlobMock.mockResolvedValue(new Blob([new Uint8Array([9])]))
    writeImageMock.mockResolvedValue(undefined)

    const node = document.createElement("div")
    await copyCardImage(node, { pixelRatio: 2 })

    expect(toBlobMock).toHaveBeenCalledWith(node, { pixelRatio: 2 })
  })

  it("throws when rendering produces no blob", async () => {
    toBlobMock.mockResolvedValue(null)

    const node = document.createElement("div")
    await expect(copyCardImage(node)).rejects.toThrow("Failed to render share card to an image.")
    expect(writeImageMock).not.toHaveBeenCalled()
  })

  it("propagates clipboard write failures", async () => {
    toBlobMock.mockResolvedValue(new Blob([new Uint8Array([9])]))
    writeImageMock.mockRejectedValue(new Error("clipboard denied"))

    const node = document.createElement("div")
    await expect(copyCardImage(node)).rejects.toThrow("clipboard denied")
  })
})
