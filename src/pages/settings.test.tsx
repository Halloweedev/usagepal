import { cleanup, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let latestOnDragEnd: ((event: any) => void) | undefined

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => false,
}))

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: (event: any) => void }) => {
    latestOnDragEnd = onDragEnd
    return <div data-testid="dnd-context">{children}</div>
  },
  closestCenter: vi.fn(),
  PointerSensor: class {},
  KeyboardSensor: class {},
  useSensor: vi.fn((_sensor: any, options?: any) => ({ sensor: _sensor, options })),
  useSensors: vi.fn((...sensors: any[]) => sensors),
}))

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: (items: any[], from: number, to: number) => {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  },
  SortableContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => "" } },
}))

const { openUrlMock, getReferralUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn(() => Promise.resolve()),
  getReferralUrlMock: vi.fn<(id: string) => string | undefined>(),
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}))

vi.mock("@/lib/referral-links", () => ({
  getReferralUrl: getReferralUrlMock,
}))

import { SettingsPage } from "@/pages/settings"

const defaultProps = {
  plugins: [{ id: "a", name: "Alpha", enabled: true }],
  onReorder: vi.fn(),
  onToggle: vi.fn(),
  autoUpdateInterval: 15 as const,
  onAutoUpdateIntervalChange: vi.fn(),
  themeMode: "system" as const,
  onThemeModeChange: vi.fn(),
  displayMode: "used" as const,
  onDisplayModeChange: vi.fn(),
  resetTimerDisplayMode: "relative" as const,
  onResetTimerDisplayModeChange: vi.fn(),
  timeFormatMode: "auto" as const,
  onTimeFormatModeChange: vi.fn(),
  menubarIconStyle: "provider" as const,
  onMenubarIconStyleChange: vi.fn(),
  multiTrayProviderCount: 3 as const,
  multiTrayDisplayMode: "percent" as const,
  onMultiMenubarClick: vi.fn(),
  onMultiTrayDisplayModeChange: vi.fn(),
  menubarMetric: "default" as const,
  onMenubarMetricChange: vi.fn(),
  traySettingsPreview: {
    bars: [{ id: "a", fraction: 0.7 }],
    providerBars: [{ id: "a", fraction: 0.7 }],
    providerIconUrl: "icon-a",
    providerPercentText: "70%",
    multiProviders: [],
  },
  globalShortcut: null,
  onGlobalShortcutChange: vi.fn(),
  startOnLogin: false,
  onStartOnLoginChange: vi.fn(),
  betaUpdatesEnabled: false,
  onBetaUpdatesEnabledChange: vi.fn(),
  onShowStats: vi.fn(),
  onShowAbout: vi.fn(),
}

async function openPluginsList() {
  await userEvent.click(screen.getByRole("button", { name: "Show Plugins" }))
}

afterEach(() => {
  cleanup()
})

describe("SettingsPage", () => {
  beforeEach(() => {
    invokeMock.mockResolvedValue(undefined)
    openUrlMock.mockClear()
    getReferralUrlMock.mockReset()
    getReferralUrlMock.mockReturnValue(undefined)
  })

  afterEach(() => {
    invokeMock.mockReset()
  })

  it("renders a referral pill that opens the referral URL for plugins that have one", async () => {
    getReferralUrlMock.mockImplementation((id) =>
      id === "claude" ? "https://claude.ai/referral/x" : undefined
    )
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[
          { id: "claude", name: "Claude", enabled: true },
          { id: "amp", name: "Amp", enabled: false },
        ]}
      />
    )
    await openPluginsList()

    const pill = screen.getByRole("button", { name: "Open Claude referral link" })
    await userEvent.click(pill)
    expect(openUrlMock).toHaveBeenCalledWith("https://claude.ai/referral/x")
    expect(
      screen.queryByRole("button", { name: "Open Amp referral link" })
    ).not.toBeInTheDocument()
  })

  it("clicking a referral pill does not toggle the plugin", async () => {
    getReferralUrlMock.mockReturnValue("https://example.com/ref")
    const onToggle = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[{ id: "claude", name: "Claude", enabled: true }]}
        onToggle={onToggle}
      />
    )
    await openPluginsList()

    await userEvent.click(screen.getByRole("button", { name: "Open Claude referral link" }))
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/ref")
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("toggles plugins", async () => {
    const onToggle = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[
          { id: "b", name: "Beta", enabled: false },
        ]}
        onToggle={onToggle}
      />
    )
    await openPluginsList()
    await userEvent.click(screen.getByText("Beta"))
    expect(onToggle).toHaveBeenCalledWith("b")
  })

  it("opens the ClinePass key dialog when enabling ClinePass", async () => {
    const onToggle = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[{ id: "cline-pass", name: "ClinePass", enabled: false }]}
        onToggle={onToggle}
      />
    )
    await openPluginsList()

    await userEvent.click(screen.getByText("ClinePass"))

    expect(onToggle).toHaveBeenCalledWith("cline-pass")
    expect(screen.getByRole("heading", { name: "ClinePass API Key" })).toBeInTheDocument()
  })

  it("undoes ClinePass enable when the key dialog is cancelled", async () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <SettingsPage
        {...defaultProps}
        plugins={[{ id: "cline-pass", name: "ClinePass", enabled: false }]}
        onToggle={onToggle}
      />
    )
    await openPluginsList()
    await userEvent.click(screen.getByText("ClinePass"))

    rerender(
      <SettingsPage
        {...defaultProps}
        plugins={[{ id: "cline-pass", name: "ClinePass", enabled: true }]}
        onToggle={onToggle}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(onToggle).toHaveBeenCalledTimes(2)
    expect(onToggle).toHaveBeenLastCalledWith("cline-pass")
  })

  it("opens the ClinePass key dialog from the key icon without toggling", async () => {
    const onToggle = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[{ id: "cline-pass", name: "ClinePass", enabled: true }]}
        onToggle={onToggle}
      />
    )
    await openPluginsList()

    await userEvent.click(screen.getByRole("button", { name: "Manage ClinePass API key" }))

    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.getByRole("heading", { name: "ClinePass API Key" })).toBeInTheDocument()
  })

  it("keeps the plugin list closed until toggled open", async () => {
    render(<SettingsPage {...defaultProps} />)

    expect(screen.getByRole("button", { name: "Show Plugins" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument()

    await openPluginsList()

    expect(screen.getByRole("button", { name: "Hide Plugins" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Alpha")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Hide Plugins" }))
    expect(screen.getByRole("button", { name: "Show Plugins" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument()
  })

  it("closes the plugin list after Settings unmounts for a view change", async () => {
    const { unmount } = render(<SettingsPage {...defaultProps} />)

    await openPluginsList()
    expect(screen.getByText("Alpha")).toBeInTheDocument()

    unmount()
    render(<SettingsPage {...defaultProps} />)

    expect(screen.getByRole("button", { name: "Show Plugins" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument()
  })

  it("renders the full app menu at the bottom", () => {
    render(<SettingsPage {...defaultProps} />)

    const appMenu = screen.getByRole("heading", { name: "App Menu" }).closest("section")!
    expect(appMenu).toBeInTheDocument()
    expect(within(appMenu).getByRole("button", { name: "Show Stats" })).toBeInTheDocument()
    expect(within(appMenu).getByRole("button", { name: "Debug Error" })).toBeInTheDocument()
    expect(within(appMenu).queryByRole("checkbox", { name: "Get Beta Updates" })).not.toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "Debug level" })).not.toBeInTheDocument()
    expect(within(appMenu).getByRole("button", { name: "Copy Log Path" })).toBeInTheDocument()
    expect(within(appMenu).getByRole("button", { name: "About UsagePal" })).toBeInTheDocument()
    expect(within(appMenu).getByRole("button", { name: "Quit UsagePal" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Beta Updates" })).not.toBeInTheDocument()
  })

  it("opens debug level choices in a modal", async () => {
    render(<SettingsPage {...defaultProps} />)

    await userEvent.click(screen.getByRole("button", { name: "Debug Error" }))

    expect(screen.getByRole("dialog", { name: "Debug" })).toHaveAttribute("aria-modal", "true")
    expect(screen.getByRole("radiogroup", { name: "Debug level" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Error" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Trace" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Get Beta Updates" })).toBeInTheDocument()
  })

  it("keeps focus inside the debug level modal and returns it on close", async () => {
    const user = userEvent.setup()
    render(<SettingsPage {...defaultProps} />)

    const trigger = screen.getByRole("button", { name: "Debug Error" })
    await user.click(trigger)

    expect(screen.getByRole("radio", { name: "Error" })).toHaveFocus()

    await user.keyboard("{Shift>}{Tab}{/Shift}")
    expect(screen.getByRole("checkbox", { name: "Get Beta Updates" })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole("radio", { name: "Error" })).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "Debug" })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("runs app menu actions", async () => {
    const onShowStats = vi.fn()
    const onShowAbout = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onShowStats={onShowStats}
        onShowAbout={onShowAbout}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: "Show Stats" }))
    expect(onShowStats).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole("button", { name: "Debug Error" }))
    await userEvent.click(screen.getByRole("radio", { name: "Debug" }))
    expect(invokeMock).toHaveBeenCalledWith("set_log_level", { level: "debug" })
    expect(screen.queryByRole("dialog", { name: "Debug" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Debug Debug" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Copy Log Path" }))
    expect(invokeMock).toHaveBeenCalledWith("copy_log_path")

    await userEvent.click(screen.getByRole("button", { name: "About UsagePal" }))
    expect(onShowAbout).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole("button", { name: "Quit UsagePal" }))
    expect(invokeMock).toHaveBeenCalledWith("quit_app")
  })


  it("reorders plugins on drag end", async () => {
    const onReorder = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        plugins={[
          { id: "a", name: "Alpha", enabled: true },
          { id: "b", name: "Beta", enabled: true },
        ]}
        onReorder={onReorder}
      />
    )
    await openPluginsList()
    latestOnDragEnd?.({ active: { id: "a" }, over: { id: "b" } })
    expect(onReorder).toHaveBeenCalledWith(["b", "a"])
  })

  it("ignores invalid drag end", async () => {
    const onReorder = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onReorder={onReorder}
      />
    )
    await openPluginsList()
    latestOnDragEnd?.({ active: { id: "a" }, over: null })
    latestOnDragEnd?.({ active: { id: "a" }, over: { id: "a" } })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it("updates auto-update interval", async () => {
    const onAutoUpdateIntervalChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onAutoUpdateIntervalChange={onAutoUpdateIntervalChange}
      />
    )
    await userEvent.click(screen.getByText("30 min"))
    expect(onAutoUpdateIntervalChange).toHaveBeenCalledWith(30)
  })

  it("shows auto-update helper text", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("How obsessive are you")).toBeInTheDocument()
  })

  it("updates beta updates setting", async () => {
    const onBetaUpdatesEnabledChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onBetaUpdatesEnabledChange={onBetaUpdatesEnabledChange}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: "Debug Error" }))
    await userEvent.click(screen.getByRole("checkbox", { name: "Get Beta Updates" }))

    expect(onBetaUpdatesEnabledChange).toHaveBeenCalledWith(true)
  })

  it("explains beta updates without opening release downloads", async () => {
    render(<SettingsPage {...defaultProps} betaUpdatesEnabled />)
    const appMenu = screen.getByRole("heading", { name: "App Menu" }).closest("section")!

    expect(within(appMenu).queryByText("Beta updates will appear in the normal update button."))
      .not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Debug Error" }))
    expect(screen.getByText("Beta updates will appear in the normal update button."))
      .toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Download Latest Beta" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Download Latest Stable" })).not.toBeInTheDocument()
  })

  it("renders app theme section with theme options", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("App Theme")).toBeInTheDocument()
    expect(screen.getByText("How it looks around here")).toBeInTheDocument()
    expect(screen.getByText("System")).toBeInTheDocument()
    expect(screen.getByText("Light")).toBeInTheDocument()
    expect(screen.getByText("Dark")).toBeInTheDocument()
  })

  it("updates theme mode", async () => {
    const onThemeModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onThemeModeChange={onThemeModeChange}
      />
    )
    await userEvent.click(screen.getByText("Dark"))
    expect(onThemeModeChange).toHaveBeenCalledWith("dark")
  })

  it("updates display mode", async () => {
    const onDisplayModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onDisplayModeChange={onDisplayModeChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Left" }))
    expect(onDisplayModeChange).toHaveBeenCalledWith("left")
  })

  it("updates reset timer display mode", async () => {
    const onResetTimerDisplayModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onResetTimerDisplayModeChange={onResetTimerDisplayModeChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: /Absolute/ }))
    expect(onResetTimerDisplayModeChange).toHaveBeenCalledWith("absolute")
  })

  it("renders renamed usage section heading", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Usage Mode")).toBeInTheDocument()
  })

  it("renders reset timers section heading", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Reset Timers")).toBeInTheDocument()
  })

  it("renders time format section heading", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Time Format")).toBeInTheDocument()
    expect(screen.getByText("12-hour or 24-hour clock")).toBeInTheDocument()
  })

  it("updates time format mode to 12h", async () => {
    const onTimeFormatModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onTimeFormatModeChange={onTimeFormatModeChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "12-hour" }))
    expect(onTimeFormatModeChange).toHaveBeenCalledWith("12h")
  })

  it("updates time format mode to 24h", async () => {
    const onTimeFormatModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onTimeFormatModeChange={onTimeFormatModeChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "24-hour" }))
    expect(onTimeFormatModeChange).toHaveBeenCalledWith("24h")
  })

  it("renders menubar icon section", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Menubar Icon")).toBeInTheDocument()
    expect(screen.getByText("What shows in the menu bar")).toBeInTheDocument()
  })

  it("renders three style buttons on the first menubar icon row", () => {
    render(<SettingsPage {...defaultProps} />)

    const styleGroup = screen.getByRole("radiogroup", { name: "Menubar icon style" })
    expect(within(styleGroup).getByRole("radio", { name: "Plugin" })).toBeInTheDocument()
    expect(within(styleGroup).getByRole("radio", { name: "Donut" })).toBeInTheDocument()
    expect(within(styleGroup).getByRole("radio", { name: "Bars" })).toBeInTheDocument()
    expect(within(styleGroup).getAllByRole("radio")).toHaveLength(4)
  })

  it("clicking Bars triggers onMenubarIconStyleChange(\"bars\")", async () => {
    const onMenubarIconStyleChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onMenubarIconStyleChange={onMenubarIconStyleChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Bars" }))
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("bars")
  })

  it("clicking Donut triggers onMenubarIconStyleChange(\"donut\")", async () => {
    const onMenubarIconStyleChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onMenubarIconStyleChange={onMenubarIconStyleChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Donut" }))
    expect(onMenubarIconStyleChange).toHaveBeenCalledWith("donut")
  })

  it("renders the menubar metric control", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.getByText("Metric")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Default" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Weekly" })).toBeInTheDocument()
  })

  it("clicking Weekly triggers onMenubarMetricChange(\"weekly\")", async () => {
    const onMenubarMetricChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onMenubarMetricChange={onMenubarMetricChange}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Weekly" }))
    expect(onMenubarMetricChange).toHaveBeenCalledWith("weekly")
  })

  it("hides the menubar metric control when multi style is selected", () => {
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="multi"
      />
    )
    expect(screen.queryByText("Metric")).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "Default" })).not.toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "Weekly" })).not.toBeInTheDocument()
  })

  it("uses live provider percent fallback in plugin preview when probe has no fraction yet", () => {
    render(
      <SettingsPage
        {...defaultProps}
        traySettingsPreview={{
          ...defaultProps.traySettingsPreview,
          providerBars: [],
          providerIconUrl: undefined,
          providerPercentText: "--%",
          multiProviders: [
            { id: "claude", iconUrl: "claude-icon", sessionText: "55%" },
          ],
        }}
      />
    )

    const pluginRow = screen.getByRole("radio", { name: "Plugin" })
    expect(within(pluginRow).getByText("55%")).toBeInTheDocument()
    expect(screen.queryByText("--%")).not.toBeInTheDocument()
  })

  it("shows multi preview row with live provider data", () => {
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="multi"
        traySettingsPreview={{
          ...defaultProps.traySettingsPreview,
          multiProviders: [
            { id: "claude", iconUrl: "claude-icon", sessionText: "70%", weeklyText: "36%" },
            { id: "cursor", iconUrl: "cursor-icon", sessionText: "42%" },
          ],
        }}
      />
    )

    const multiRow = screen.getByRole("radio", { name: "Multi (3)" })
    expect(multiRow).toHaveAttribute("aria-checked", "true")
    expect(within(multiRow).getByText("70%")).toBeInTheDocument()
    expect(within(multiRow).getByText("36%")).toBeInTheDocument()
    expect(within(multiRow).getByText("42%")).toBeInTheDocument()
    expect(screen.queryByText("100%")).not.toBeInTheDocument()
    expect(screen.queryByText("Enable providers to preview")).not.toBeInTheDocument()
  })

  it("shows empty state in multi preview row when no providers are enabled", () => {
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="provider"
        traySettingsPreview={{
          ...defaultProps.traySettingsPreview,
          multiProviders: [],
        }}
      />
    )

    const multiRow = screen.getByRole("radio", { name: "Multi (3)" })
    expect(within(multiRow).getByText("Enable providers to preview")).toBeInTheDocument()
    expect(multiRow).toHaveAttribute("aria-checked", "false")
    expect(screen.queryByText("100%")).not.toBeInTheDocument()
  })

  it("always shows multi preview row even when another menubar style is selected", () => {
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="provider"
        traySettingsPreview={{
          ...defaultProps.traySettingsPreview,
          providerPercentText: "12%",
          multiProviders: [
            { id: "claude", iconUrl: "claude-icon", sessionText: "55%", weeklyText: "36%" },
          ],
        }}
      />
    )

    const multiRow = screen.getByRole("radio", { name: "Multi (3)" })
    expect(multiRow).toHaveAttribute("aria-checked", "false")
    expect(within(multiRow).getByText("55%")).toBeInTheDocument()
    expect(within(multiRow).getByText("36%")).toBeInTheDocument()
    expect(screen.getByText("12%")).toBeInTheDocument()
  })

  it("clicking Multi from another style selects multi without cycling count", async () => {
    const onMultiMenubarClick = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onMultiMenubarClick={onMultiMenubarClick}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Multi (3)" }))
    expect(onMultiMenubarClick).toHaveBeenCalledTimes(1)
  })

  it("clicking Multi while already selected cycles provider count", async () => {
    const onMultiMenubarClick = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="multi"
        multiTrayProviderCount={3}
        onMultiMenubarClick={onMultiMenubarClick}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Multi (3)" }))
    expect(onMultiMenubarClick).toHaveBeenCalledTimes(1)
  })

  it("renders Numbers and Bars toggle when multi style is selected", () => {
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="multi"
        multiTrayDisplayMode="bars"
        traySettingsPreview={{
          ...defaultProps.traySettingsPreview,
          multiProviders: [
            {
              id: "claude",
              iconUrl: "claude-icon",
              sessionText: "70%",
              weeklyText: "36%",
              sessionFraction: 0.7,
              weeklyFraction: 0.36,
            },
          ],
        }}
      />
    )

    const displayModeGroup = screen.getByRole("radiogroup", { name: "Multi display mode" })
    expect(within(displayModeGroup).getByRole("radio", { name: "Bars" })).toHaveAttribute("aria-checked", "true")
    expect(within(displayModeGroup).getByRole("radio", { name: "Numbers" })).toHaveAttribute("aria-checked", "false")
    const multiRow = screen.getByRole("radio", { name: "Multi (3)" })
    expect(within(multiRow).queryByText("70%")).not.toBeInTheDocument()
  })

  it("clicking Numbers in multi display mode calls onMultiTrayDisplayModeChange", async () => {
    const onMultiTrayDisplayModeChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="multi"
        multiTrayDisplayMode="bars"
        onMultiTrayDisplayModeChange={onMultiTrayDisplayModeChange}
      />
    )

    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Multi display mode" })).getByRole("radio", { name: "Numbers" }))
    expect(onMultiTrayDisplayModeChange).toHaveBeenCalledWith("percent")
  })

  it("multi preview respects configured provider count", () => {
    render(
      <SettingsPage
        {...defaultProps}
        menubarIconStyle="multi"
        multiTrayProviderCount={2}
        traySettingsPreview={{
          ...defaultProps.traySettingsPreview,
          multiProviders: [
            { id: "claude", iconUrl: "claude-icon", sessionText: "70%", weeklyText: "36%" },
            { id: "cursor", iconUrl: "cursor-icon", sessionText: "42%" },
            { id: "codex", iconUrl: "codex-icon", sessionText: "12%" },
          ],
        }}
      />
    )

    const multiRow = screen.getByRole("radio", { name: "Multi (2)" })
    expect(within(multiRow).getByText("70%")).toBeInTheDocument()
    expect(within(multiRow).getByText("42%")).toBeInTheDocument()
    expect(within(multiRow).queryByText("12%")).not.toBeInTheDocument()
    expect(within(multiRow).getByText("2")).toBeInTheDocument()
  })

  it("clicking Multi triggers onMenubarIconStyleChange(\"multi\")", async () => {
    const onMenubarIconStyleChange = vi.fn()
    const onMultiMenubarClick = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onMenubarIconStyleChange={onMenubarIconStyleChange}
        onMultiMenubarClick={onMultiMenubarClick}
      />
    )
    await userEvent.click(screen.getByRole("radio", { name: "Multi (3)" }))
    expect(onMultiMenubarClick).toHaveBeenCalledTimes(1)
    expect(onMenubarIconStyleChange).not.toHaveBeenCalled()
  })

  it("does not render removed bar icon controls", () => {
    render(<SettingsPage {...defaultProps} />)
    expect(screen.queryByText("Bar Icon")).not.toBeInTheDocument()
    expect(screen.queryByText("Show percentage")).not.toBeInTheDocument()
  })

  it("toggles start on login checkbox", async () => {
    const onStartOnLoginChange = vi.fn()
    render(
      <SettingsPage
        {...defaultProps}
        onStartOnLoginChange={onStartOnLoginChange}
      />
    )
    await userEvent.click(screen.getByText("Start on login"))
    expect(onStartOnLoginChange).toHaveBeenCalledWith(true)
  })
})
