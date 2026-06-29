import { useEffect } from "react";

interface AboutDialogProps {
  version: string;
  onClose: () => void;
}

export function AboutDialog({ version, onClose }: AboutDialogProps) {
  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close when panel hides (loses visibility)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        onClose();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-xl"
      onClick={handleBackdropClick}
    >
      <div className="bg-card rounded-lg border shadow-xl p-6 max-w-xs w-full mx-4 text-center animate-in fade-in zoom-in-95 duration-200">
        <img
          src="/icon.png"
          alt="UsagePal"
          className="w-16 h-16 mx-auto mb-3 rounded-xl"
        />

        <h2 className="text-xl font-semibold mb-1">UsagePal</h2>

        <div className="flex flex-col items-center gap-2 mb-4">
          <span className="inline-block text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            v{version}
          </span>
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            Built by Nicolas Demanez
          </p>
          <p className="text-xs">
            An open-source fork of OpenUsage
          </p>
        </div>
      </div>
    </div>
  );
}

