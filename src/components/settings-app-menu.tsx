import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

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
};

function DebugLevelDialog({
  selectedLevel,
  onSelect,
  onClose,
}: {
  selectedLevel: DebugLevel;
  onSelect: (level: DebugLevel) => void;
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

      const radioButtons = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []
      );
      const firstRadioButton = radioButtons[0];
      const lastRadioButton = radioButtons[radioButtons.length - 1];

      if (event.shiftKey && document.activeElement === firstRadioButton) {
        event.preventDefault();
        lastRadioButton?.focus();
      } else if (!event.shiftKey && document.activeElement === lastRadioButton) {
        event.preventDefault();
        firstRadioButton?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Debug Level"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-4 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-lg font-semibold mb-3">Debug Level</h2>
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
      </div>
    </div>
  );
}

export function SettingsAppMenu({ onShowStats, onShowAbout }: SettingsAppMenuProps) {
  const [debugLevel, setDebugLevel] = useState<DebugLevel>("error");
  const [showDebugLevelDialog, setShowDebugLevelDialog] = useState(false);
  const debugLevelButtonRef = useRef<HTMLButtonElement>(null);
  const selectedDebugLevelLabel = DEBUG_LEVEL_OPTIONS.find((option) => option.value === debugLevel)!.label;

  const closeDebugLevelDialog = useCallback(() => {
    setShowDebugLevelDialog(false);
    debugLevelButtonRef.current?.focus();
  }, []);

  const handleDebugLevelChange = (level: DebugLevel) => {
    setDebugLevel(level);
    closeDebugLevelDialog();
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
          aria-label={`Debug Level ${selectedDebugLevelLabel}`}
          className="w-full justify-between"
          ref={debugLevelButtonRef}
          onClick={() => setShowDebugLevelDialog(true)}
        >
          <span>Debug Level</span>
          <span className="text-muted-foreground">{selectedDebugLevelLabel}</span>
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
      {showDebugLevelDialog && (
        <DebugLevelDialog
          selectedLevel={debugLevel}
          onSelect={handleDebugLevelChange}
          onClose={closeDebugLevelDialog}
        />
      )}
    </section>
  );
}
