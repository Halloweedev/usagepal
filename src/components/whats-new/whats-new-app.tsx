import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { LoaderCircle } from "lucide-react"
import type { ReleaseNotes } from "@/bindings"
import { ChromelessWindowShell } from "@/components/chromeless-window-shell"
import { StepShell } from "@/components/onboarding/step-shell"
import { Button } from "@/components/ui/button"

function WhatsNewApp() {
  const [notes, setNotes] = useState<ReleaseNotes[] | null>(null)

  useEffect(() => {
    if (!isTauri()) {
      setNotes([])
      return
    }
    let cancelled = false
    invoke<ReleaseNotes[]>("get_release_notes")
      .then((result) => {
        if (!cancelled) setNotes(result)
      })
      .catch((error) => {
        console.error("Failed to load release notes:", error)
        if (!cancelled) setNotes([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function dismiss() {
    try {
      if (isTauri()) await invoke("dismiss_whats_new")
    } catch (error) {
      console.error("Failed to dismiss what's new:", error)
    }
  }

  // Escape dismisses, matching the onboarding window pattern.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void dismiss()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ChromelessWindowShell>
      <StepShell
        title="What's New"
        actions={
          <Button size="sm" onClick={dismiss}>
            Open UsagePal
          </Button>
        }
      >
        {notes === null ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle
              className="size-6 animate-spin text-muted-foreground"
              aria-hidden
            />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No release notes available.
          </div>
        ) : (
          <div className="space-y-6">
            {notes.map((release) => (
              <div key={release.version} className="space-y-2">
                <h2 className="text-lg font-semibold">v{release.version}</h2>
                {release.summary && (
                  <p className="text-sm text-muted-foreground">{release.summary}</p>
                )}
                {release.sections.map((section) => (
                  <div key={section.title} className="space-y-1">
                    <h3 className="text-sm font-medium">{section.title}</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {section.items.map((item, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-primary" aria-hidden>
                            ·
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </StepShell>
    </ChromelessWindowShell>
  )
}

export { WhatsNewApp }
