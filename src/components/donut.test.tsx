import { describe, expect, it } from "vitest"
import { donutCenterTotalFontSize, SHARE_DONUT_CENTER_FONT_SIZE, SHARE_DONUT_REFERENCE_SIZE } from "@/components/donut"

describe("donutCenterTotalFontSize", () => {
  it("uses the share-card size as the baseline", () => {
    expect(donutCenterTotalFontSize(SHARE_DONUT_REFERENCE_SIZE)).toBe(SHARE_DONUT_CENTER_FONT_SIZE)
  })

  it("scales down for the overview strip donut", () => {
    expect(donutCenterTotalFontSize(96)).toBe(13)
  })
})
