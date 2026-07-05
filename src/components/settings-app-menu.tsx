import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const DEBUG_LEVEL_OPTIONS = [
  { label: "Error", value: "error" },
  { label: "Warn", value: "warn" },
  { label: "Info", value: "info" },
  { label: "Debug", value: "debug" },
  { label: "Trace", value: "trace" },
] as const;

type DebugLevel = (typeof DEBUG_LEVEL_OPTIONS)[number]["value"];

type SettingsAppMenuProps = {
  onShowStats: () => void;
  onShowAbout: () => void;
  betaUpdatesEnabled: boolean;
  onBetaUpdatesEnabledChange: (value: boolean) => void;
};

function DebugDialog({
  selectedLevel,
  betaUpdatesEnabled,
  onSelect,
  onBetaUpdatesEnabledChange,
  onClose,
}: {
  selectedLevel: DebugLevel;
  betaUpdatesEnabled: boolean;
  onSelect: (level: DebugLevel) => void;
  onBetaUpdatesEnabledChange: (value: boolean) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectedRadioRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRadioRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableControls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]') ?? []
      );
      const firstControl = focusableControls[0];
      const lastControl = focusableControls[focusableControls.length - 1];

      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault();
        lastControl?.focus();
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault();
        firstControl?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Debug"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-4 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-lg font-semibold mb-3">Debug</h2>
        <div className="grid grid-cols-1 gap-1" role="radiogroup" aria-label="Debug level">
          {DEBUG_LEVEL_OPTIONS.map((option) => {
            const isActive = option.value === selectedLevel;
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
            );
          })}
        </div>
        <div className="mt-3 rounded-md border border-border/60 bg-background px-3 py-2 text-left">
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
    </div>
  );
}

export function SettingsAppMenu({
  onShowStats,
  onShowAbout,
  betaUpdatesEnabled,
  onBetaUpdatesEnabledChange,
}: SettingsAppMenuProps) {
  const [debugLevel, setDebugLevel] = useState<DebugLevel>("error");
  const [showDebugDialog, setShowDebugDialog] = useState(false);
  const debugLevelButtonRef = useRef<HTMLButtonElement>(null);
  const selectedDebugLevelLabel = DEBUG_LEVEL_OPTIONS.find((option) => option.value === debugLevel)!.label;

  const closeDebugDialog = useCallback(() => {
    setShowDebugDialog(false);
    debugLevelButtonRef.current?.focus();
  }, []);

  const handleDebugLevelChange = (level: DebugLevel) => {
    setDebugLevel(level);
    closeDebugDialog();
    invoke("set_log_level", { level }).catch((error) => {
      console.error("Failed to set log level:", error);
    });
  };

  const handleCopyLogPath = () => {
    invoke("copy_log_path").catch((error) => {
      console.error("Failed to copy log path:", error);
    });
  };

  const handleQuit = () => {
    invoke("quit_app").catch((error) => {
      console.error("Failed to quit app:", error);
    });
  };

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">App Menu</h3>
      <p className="text-sm text-muted-foreground mb-2">Old menu bar actions</p>
      <div className="bg-muted/50 rounded-lg p-1 space-y-2">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onShowStats}>
          Show Stats
        </Button>
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
          betaUpdatesEnabled={betaUpdatesEnabled}
          onSelect={handleDebugLevelChange}
          onBetaUpdatesEnabledChange={onBetaUpdatesEnabledChange}
          onClose={closeDebugDialog}
        />
      )}
    </section>
  );
}
