import { useMemo, useState } from "react"
import { ArrowsClockwise, CaretDown, Robot } from "@phosphor-icons/react"
import type { AgentSession } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAgents } from "@/hooks/app/use-agents"
import { cn } from "@/lib/utils"

const PROVIDER_ORDER = ["claude", "codex", "cursor", "opencode", "opencode2"]

const ALL_FILTER = "all"
const KNOWN_STATUSES = ["active", "idle", "closed"]

function filterLabel(value: string): string {
  if (value === ALL_FILTER) return "All"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function meaningfulTitle(title: string | null): string | null {
  if (!title) return null
  const trimmed = title.trim()
  if (!trimmed || trimmed.startsWith("New session -")) return null
  return trimmed
}

function formatLastActive(lastActiveMs: number | null): string {
  if (typeof lastActiveMs !== "number" || lastActiveMs <= 0) return ""
  const seconds = Math.floor(Math.max(0, Date.now() - lastActiveMs) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId
}

function AgentRow({ session }: { session: AgentSession }) {
  const isActive = session.status === "active"
  const title = meaningfulTitle(session.title)
  const statusText = isActive ? "Active" : session.status === "idle" ? "Idle" : filterLabel(session.status)
  return (
    <div className="flex items-center gap-2.5 px-1 py-2">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          isActive ? "bg-green-500" : "bg-muted-foreground/40"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{session.projectName}</div>
        {title && (
          <div className="truncate text-xs text-foreground/80" title={title}>
            {title}
          </div>
        )}
        <div className="truncate text-xs text-muted-foreground">
          {session.providerName} · {shortSessionId(session.sessionId)}
          {formatLastActive(session.lastActiveMs) ? ` · ${formatLastActive(session.lastActiveMs)}` : ""}
        </div>
        {session.cwd && (
          <div className="truncate text-xs text-muted-foreground/70" title={session.cwd}>
            {session.cwd}
          </div>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{statusText}</span>
    </div>
  )
}

function ProviderSection({
  providerId,
  providerName,
  sessions,
  collapsed,
  onToggle,
}: {
  providerId: string
  providerName: string
  sessions: AgentSession[]
  collapsed: boolean
  onToggle: (providerId: string) => void
}) {
  const activeCount = sessions.filter((session) => session.status === "active").length
  const closedCount = sessions.filter((session) => session.status === "closed").length
  const summary =
    activeCount > 0
      ? `${activeCount} active`
      : closedCount === sessions.length
        ? `${sessions.length} closed`
        : `${sessions.length} idle`
  return (
    <section className="mb-3">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Show" : "Hide"} ${providerName} sessions`}
        onClick={() => onToggle(providerId)}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted/60"
      >
        <CaretDown
          aria-hidden="true"
          className={cn("size-4 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
        />
        <h3 className="text-lg font-semibold">{providerName}</h3>
        <span className="ml-auto text-sm font-normal text-muted-foreground">{summary}</span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/60">
          {sessions.map((session) => (
            <AgentRow key={`${session.providerId}-${session.sessionId}`} session={session} />
          ))}
        </div>
      )}
    </section>
  )
}

export function AgentsPage() {
  const { sessions, loading, error, lastUpdatedAt, refresh } = useAgents()
  const [statusFilter, setStatusFilter] = useState<string>(ALL_FILTER)
  const [collapsedProviders, setCollapsedProviders] = useState<ReadonlySet<string>>(new Set())

  const toggleProvider = (providerId: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(providerId)) {
        next.delete(providerId)
      } else {
        next.add(providerId)
      }
      return next
    })
  }

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions) {
      counts.set(session.status, (counts.get(session.status) ?? 0) + 1)
    }
    const options = [{ value: ALL_FILTER, count: sessions.length }]
    for (const status of KNOWN_STATUSES) {
      options.push({ value: status, count: counts.get(status) ?? 0 })
    }
    for (const [status, count] of counts) {
      if (!KNOWN_STATUSES.includes(status)) {
        options.push({ value: status, count })
      }
    }
    return options
  }, [sessions])

  const visibleSessions = useMemo(
    () =>
      statusFilter === ALL_FILTER
        ? sessions
        : sessions.filter((session) => session.status === statusFilter),
    [sessions, statusFilter]
  )

  const groups = useMemo(() => {
    const byProvider = new Map<string, { id: string; name: string; sessions: AgentSession[] }>()
    for (const session of visibleSessions) {
      const group = byProvider.get(session.providerId)
      if (group) {
        group.sessions.push(session)
      } else {
        byProvider.set(session.providerId, {
          id: session.providerId,
          name: session.providerName,
          sessions: [session],
        })
      }
    }
    return [...byProvider.entries()]
      .sort(([a], [b]) => {
        const orderA = PROVIDER_ORDER.indexOf(a)
        const orderB = PROVIDER_ORDER.indexOf(b)
        return (orderA === -1 ? PROVIDER_ORDER.length : orderA) - (orderB === -1 ? PROVIDER_ORDER.length : orderB)
      })
      .map(([, group]) => group)
  }, [visibleSessions])

  const activeCount = sessions.filter((session) => session.status === "active").length
  const hasSessions = sessions.length > 0

  return (
    <div className="pb-3">
      <div className="flex items-center justify-between pt-2 mb-1">
        <h3 className="text-lg font-semibold">Agents</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh Agents"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <ArrowsClockwise className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {!hasSessions
          ? "Claude Code, Codex, Cursor, and OpenCode sessions on this Mac"
          : `${activeCount} Active Now · ${sessions.length} Recent`}
        {lastUpdatedAt != null ? ` · Updated ${formatLastActive(lastUpdatedAt)}` : ""}
      </p>

      {loading && !hasSessions ? (
        <div className="space-y-2" aria-label="Loading agent sessions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error && !hasSessions ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Try Again
          </Button>
        </div>
      ) : !hasSessions ? (
        <div className="text-center py-8">
          <Robot className="size-8 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium mb-1">No Agent Sessions Found</p>
          <p className="text-xs text-muted-foreground">
            Start a Claude Code, Codex, Cursor, or OpenCode session and it will show up here.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-muted/50 rounded-lg p-1 mb-3">
            <div className="flex gap-1" role="radiogroup" aria-label="Status Filter">
              {statusOptions.map((option) => {
                const isActive = option.value === statusFilter
                return (
                  <Button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setStatusFilter(option.value)}
                  >
                    {filterLabel(option.value)} ({option.count})
                  </Button>
                )
              })}
            </div>
          </div>
          {visibleSessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm font-medium mb-1">No {filterLabel(statusFilter)} Sessions</p>
              <p className="text-xs text-muted-foreground mb-3">
                Nothing with this status right now.
              </p>
              <Button variant="outline" size="sm" onClick={() => setStatusFilter(ALL_FILTER)}>
                Show All
              </Button>
            </div>
          ) : (
            groups.map((group) => (
              <ProviderSection
                key={group.id}
                providerId={group.id}
                providerName={group.name}
                sessions={group.sessions}
                collapsed={collapsedProviders.has(group.id)}
                onToggle={toggleProvider}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
