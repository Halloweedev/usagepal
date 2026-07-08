import { useCallback, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FocusTrapDialog } from "@/components/ui/focus-trap-dialog"

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
  const selectedRadioRef = useRef<HTMLButtonElement | null>(null)

  return (
    <FocusTrapDialog label="Debug" onClose={onClose} initialFocusRef={selectedRadioRef}>
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
              ref={isActive ? selectedRadioRef : undefined}
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
}: SettingsAdvancedSectionProps) {
  const [debugLevel, setDebugLevel] = useState<DebugLevel>("error")
  const [showDebugDialog, setShowDebugDialog] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const debugLevelButtonRef = useRef<HTMLButtonElement>(null)
  const selectedDebugLevelLabel = DEBUG_LEVEL_OPTIONS.find((option) => option.value === debugLevel)!.label

  const closeDebugDialog = useCallback(() => {
    setShowDebugDialog(false)
    debugLevelButtonRef.current?.focus()
  }, [])

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
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold mb-0">Advanced</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={advancedOpen}
          aria-controls="settings-advanced-content"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? "Hide Advanced" : "Show Advanced"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-2">Debugging and diagnostics</p>
      {advancedOpen && (
        <div id="settings-advanced-content" className="bg-muted/50 rounded-lg p-1 space-y-2 mb-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Debug ${selectedDebugLevelLabel}`}
            className="w-full justify-center"
            ref={debugLevelButtonRef}
            onClick={() => setShowDebugDialog(true)}
          >
            <span>Debug</span>
          </Button>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={handleCopyLogPath}>
            Copy Log Path
          </Button>
          {!showDebugDialog && (
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
          )}
        </div>
      )}
      <div className="space-y-2">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onShowStats}>
          Show Stats
        </Button>
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onShowAbout}>
          About UsagePal
        </Button>
        <Button type="button" variant="destructive" size="sm" className="w-full" onClick={handleQuit}>
          Quit UsagePal
        </Button>
      </div>
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
