import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FocusTrapDialog } from "@/components/ui/focus-trap-dialog"
import { NotificationsSection } from "@/components/notifications-section"

const DEBUG_LEVEL_OPTIONS = [
  { label: "Error", value: "error" },
  { label: "Warn", value: "warn" },
  { label: "Info", value: "info" },
  { label: "Debug", value: "debug" },
  { label: "Trace", value: "trace" },
] as const

type DebugLevel = (typeof DEBUG_LEVEL_OPTIONS)[number]["value"]

type SettingsAdvancedSectionProps = {
  onShowStats: () => void
  onShowAbout: () => void
  betaUpdatesEnabled: boolean
  onBetaUpdatesEnabledChange: (value: boolean) => void
  startOnLogin: boolean
  onStartOnLoginChange: (value: boolean) => void
}

function DebugDialog({
  selectedLevel,
  onSelect,
  onClose,
}: {
  selectedLevel: DebugLevel
  onSelect: (level: DebugLevel) => void
  onClose: () => void
}) {
  return (
    <FocusTrapDialog label="Debug" onClose={onClose}>
      <h2 className="text-lg font-semibold mb-3">Debug</h2>
      <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-label="Debug level">
        {DEBUG_LEVEL_OPTIONS.map((option) => {
          const isActive = option.value === selectedLevel
          return (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              variant={isActive ? "default" : "outline"}
              size="sm"
              className="w-full justify-start"
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
    </FocusTrapDialog>
  )
}

export function SettingsAdvancedSection({
  onShowStats,
  onShowAbout,
  betaUpdatesEnabled,
  onBetaUpdatesEnabledChange,
  startOnLogin,
  onStartOnLoginChange,
}: SettingsAdvancedSectionProps) {
  const [debugLevel, setDebugLevel] = useState<DebugLevel>("error")
  const [showDebugDialog, setShowDebugDialog] = useState(false)
  const [showAdvancedDialog, setShowAdvancedDialog] = useState(false)
  const selectedDebugLevelLabel = DEBUG_LEVEL_OPTIONS.find((option) => option.value === debugLevel)!.label

  const closeDebugDialog = () => setShowDebugDialog(false)

  const closeAdvancedDialog = () => setShowAdvancedDialog(false)

  const handleDebugLevelChange = (level: DebugLevel) => {
    setDebugLevel(level)
    closeDebugDialog()
    invoke("set_log_level", { level }).catch((error) => {
      console.error("Failed to set log level:", error)
    })
  }

  const handleCopyLogPath = () => {
    invoke("copy_log_path").catch((error) => {
      console.error("Failed to copy log path:", error)
    })
  }

  const handleQuit = () => {
    invoke("quit_app").catch((error) => {
      console.error("Failed to quit app:", error)
    })
  }

  return (
    <section>
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onShowStats}>
          Show Stats
        </Button>
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onShowAbout}>
          About UsagePal
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setShowAdvancedDialog(true)}
        >
          Advanced
        </Button>
        <NotificationsSection />
        <Button type="button" variant="destructive" size="sm" className="w-full" onClick={handleQuit}>
          Quit UsagePal
        </Button>
      </div>
      {showAdvancedDialog && (
        <FocusTrapDialog
          label="Advanced"
          focusableSelector='button, [role="checkbox"]'
          onClose={() => {
            if (!showDebugDialog) closeAdvancedDialog()
          }}
        >
          <h2 className="text-lg font-semibold mb-3">Advanced</h2>
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Debug ${selectedDebugLevelLabel}`}
              className="w-full"
              onClick={() => setShowDebugDialog(true)}
            >
              Debug
            </Button>
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={handleCopyLogPath}>
              Copy Log Path
            </Button>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2 text-left">
              <label className="flex items-center gap-2 text-sm select-none text-foreground">
                <Checkbox
                  key={`start-on-login-${startOnLogin}`}
                  aria-label="Start on login"
                  checked={startOnLogin}
                  onCheckedChange={(checked) => onStartOnLoginChange(checked === true)}
                />
                Start on login
              </label>
            </div>
            <div className="rounded-md border border-border/60 bg-background px-3 py-2 text-left">
              <label className="flex items-center gap-2 text-sm select-none text-foreground">
                <Checkbox
                  key={`beta-updates-${betaUpdatesEnabled}`}
                  aria-label="Get Beta Updates"
                  checked={betaUpdatesEnabled}
                  onCheckedChange={(checked) => onBetaUpdatesEnabledChange(checked === true)}
                />
                Get Beta Updates
              </label>
              {betaUpdatesEnabled && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Beta updates will appear in the normal update button.
                </p>
              )}
            </div>
          </div>
        </FocusTrapDialog>
      )}
      {showDebugDialog && (
        <DebugDialog
          selectedLevel={debugLevel}
          onSelect={handleDebugLevelChange}
          onClose={closeDebugDialog}
        />
      )}
    </section>
  )
}
