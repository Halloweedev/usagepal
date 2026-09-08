import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { AgentSession } from "@/bindings"

const { useAgentsMock } = vi.hoisted(() => ({
  useAgentsMock: vi.fn(),
}))

vi.mock("@/hooks/app/use-agents", () => ({
  useAgents: useAgentsMock,
}))

import { AgentsPage } from "@/pages/agents"

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    providerId: "claude",
    providerName: "Claude Code",
    projectName: "usagepal",
    sessionId: "abc123def456",
    cwd: "/Users/me/usagepal",
    title: null,
    lastActiveMs: Date.now(),
    status: "active",
    ...overrides,
  }
}

function mockState(state: {
  sessions?: AgentSession[]
  loading?: boolean
  error?: string | null
  lastUpdatedAt?: number | null
  refresh?: () => void
}) {
  useAgentsMock.mockReturnValue({
    sessions: [],
    loading: false,
    error: null,
    lastUpdatedAt: null,
    refresh: vi.fn(),
    ...state,
  })
}

describe("AgentsPage", () => {
  it("shows loading skeletons on first load", () => {
    mockState({ loading: true })
    render(<AgentsPage />)
    expect(screen.getByLabelText("Loading agent sessions")).toBeInTheDocument()
  })

  it("shows the empty state when no sessions exist", () => {
    mockState({})
    render(<AgentsPage />)
    expect(screen.getByText("No Agent Sessions Found")).toBeInTheDocument()
  })

  it("groups sessions by provider with project and recency", () => {
    mockState({
      sessions: [
        session(),
        session({
          providerId: "codex",
          providerName: "Codex",
          projectName: "kota",
          sessionId: "019d0508",
          status: "idle",
          lastActiveMs: Date.now() - 60 * 60 * 1000,
        }),
      ],
    })
    render(<AgentsPage />)
    expect(screen.getByText("usagepal")).toBeInTheDocument()
    expect(screen.getByText("kota")).toBeInTheDocument()
    expect(screen.getByText("Claude Code")).toBeInTheDocument()
    expect(screen.getByText("Codex")).toBeInTheDocument()
    expect(screen.getByText("1 Active Now · 2 Recent")).toBeInTheDocument()
  })

  it("shows the error state with a retry button", async () => {
    const refresh = vi.fn()
    mockState({ error: "Couldn't load agent sessions.", refresh })
    render(<AgentsPage />)
    expect(screen.getByText("Couldn't load agent sessions.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("refreshes when the header button is clicked", async () => {
    const refresh = vi.fn()
    mockState({ sessions: [session()], refresh })
    render(<AgentsPage />)
    await userEvent.click(screen.getByRole("button", { name: "Refresh Agents" }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("filters to only active sessions", async () => {
    mockState({
      sessions: [
        session(),
        session({
          providerId: "codex",
          providerName: "Codex",
          projectName: "kota",
          sessionId: "019d0508",
          status: "idle",
          lastActiveMs: Date.now() - 60 * 60 * 1000,
        }),
      ],
    })
    render(<AgentsPage />)
    expect(screen.getByRole("radio", { name: "Active (1)" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("radio", { name: "Active (1)" }))
    expect(screen.getByText("usagepal")).toBeInTheDocument()
    expect(screen.queryByText("kota")).not.toBeInTheDocument()
  })

  it("filters to only idle sessions", async () => {
    mockState({
      sessions: [
        session(),
        session({
          providerId: "codex",
          providerName: "Codex",
          projectName: "kota",
          sessionId: "019d0508",
          status: "idle",
          lastActiveMs: Date.now() - 60 * 60 * 1000,
        }),
      ],
    })
    render(<AgentsPage />)

    await userEvent.click(screen.getByRole("radio", { name: "Idle (1)" }))
    expect(screen.getByText("kota")).toBeInTheDocument()
    expect(screen.queryByText("usagepal")).not.toBeInTheDocument()
  })

  it("filters closed sessions", async () => {
    mockState({
      sessions: [
        session(),
        session({
          providerId: "codex",
          providerName: "Codex",
          projectName: "kota",
          sessionId: "019d0508",
          status: "closed",
          lastActiveMs: Date.now() - 24 * 60 * 60 * 1000,
        }),
      ],
    })
    render(<AgentsPage />)

    await userEvent.click(screen.getByRole("radio", { name: "Closed (1)" }))
    expect(screen.getByText("kota")).toBeInTheDocument()
    expect(screen.queryByText("usagepal")).not.toBeInTheDocument()
  })

  it("labels an all-closed provider section", () => {
    mockState({
      sessions: [
        session({
          status: "closed",
          lastActiveMs: Date.now() - 24 * 60 * 60 * 1000,
        }),
      ],
    })
    render(<AgentsPage />)
    expect(screen.getByText("1 closed")).toBeInTheDocument()
  })

  it("offers other statuses as their own filter", async () => {
    mockState({
      sessions: [
        session(),
        session({
          providerId: "opencode2",
          providerName: "OpenCode2",
          projectName: "beta",
          sessionId: "ses_v2",
          status: "archived",
        }),
      ],
    })
    render(<AgentsPage />)

    await userEvent.click(screen.getByRole("radio", { name: "Archived (1)" }))
    expect(screen.getByText("beta")).toBeInTheDocument()
    expect(screen.queryByText("usagepal")).not.toBeInTheDocument()
  })

  it("resets from an empty filter result", async () => {
    mockState({
      sessions: [session({ status: "idle", lastActiveMs: Date.now() - 60 * 60 * 1000 })],
    })
    render(<AgentsPage />)

    await userEvent.click(screen.getByRole("radio", { name: "Active (0)" }))
    expect(screen.getByText("No Active Sessions")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Show All" }))
    expect(screen.getByText("usagepal")).toBeInTheDocument()
  })

  it("collapses a provider when its header is clicked", async () => {
    mockState({ sessions: [session()] })
    render(<AgentsPage />)

    await userEvent.click(
      screen.getByRole("button", { name: "Hide Claude Code sessions" })
    )
    expect(screen.queryByText("usagepal")).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("button", { name: "Show Claude Code sessions" })
    )
    expect(screen.getByText("usagepal")).toBeInTheDocument()
  })

  it("shows meaningful titles and hides placeholder titles", () => {
    mockState({
      sessions: [
        session({ title: "Fix the login bug" }),
        session({
          providerId: "opencode2",
          providerName: "OpenCode2",
          projectName: "beta",
          sessionId: "ses_v2",
          title: "New session - 2026-08-14T14:09:14.825Z",
        }),
      ],
    })
    render(<AgentsPage />)
    expect(screen.getByText("Fix the login bug")).toBeInTheDocument()
    expect(
      screen.queryByText("New session - 2026-08-14T14:09:14.825Z")
    ).not.toBeInTheDocument()
  })
})
