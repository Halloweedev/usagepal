import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { LoaderCircle } from "lucide-react"
import type { ReleaseNotes } from "@/bindings"
import { ChromelessWindowShell } from "@/components/chromeless-window-shell"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"

/** Tinted badge style per category. Falls back to muted for unknown labels. */
const CATEGORY_STYLES: Record<string, string> = {
  "New Features": "bg-green-500/10 text-green-500",
  "Bug Fixes": "bg-red-500/10 text-red-500",
  Improvements: "bg-yellow-500/10 text-yellow-500",
}

function CategoryBadge({ title }: { title: string }) {
  const style = CATEGORY_STYLES[title] ?? "bg-muted text-muted-foreground"
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide ${style}`}
    >
      {title}
    </span>
  )
}

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
      <div className="flex h-full min-h-0 flex-col">
        {/* Title */}
        <div className="mx-auto w-full max-w-md shrink-0 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h1 className="text-2xl font-semibold tracking-tight">What's New</h1>
        </div>

        {/* Scrollable release notes */}
        <div
          className="min-h-0 flex-1 overflow-y-auto py-5 animate-in fade-in duration-300"
          style={{ animationDelay: "120ms", animationFillMode: "both" }}
        >
          <div className="mx-auto w-full max-w-md">
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
              <div className="space-y-5">
                {notes.map((release, releaseIdx) => (
                  <div key={release.version} className="space-y-3">
                    {releaseIdx > 0 && <Separator />}

                    {/* Version header + summary */}
                    <div className="space-y-1">
                      <h2 className="text-base font-semibold">
                        v{release.version}
                      </h2>
                      {release.summary && (
                        <p className="text-sm leading-5 text-muted-foreground">
                          {release.summary}
                        </p>
                      )}
                    </div>

                    {/* Category sections */}
                    <div className="space-y-3">
                      {release.sections.map((section) => (
                        <div key={section.title} className="space-y-1.5">
                          <CategoryBadge title={section.title} />
                          <ul className="space-y-1 text-sm leading-5 text-muted-foreground">
                            {section.items.map((item, i) => (
                              <li key={i} className="flex gap-2">
                                <span
                                  className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/30"
                                  aria-hidden
                                />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="shrink-0 border-t pt-3 animate-in fade-in duration-300"
          style={{ animationDelay: "240ms", animationFillMode: "both" }}
        >
          <div className="flex items-center justify-end gap-3">
            <Button size="sm" onClick={dismiss}>
              Open UsagePal
            </Button>
          </div>
        </div>
      </div>
    </ChromelessWindowShell>
  )
}

export { WhatsNewApp }
