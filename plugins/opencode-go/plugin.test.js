import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx } from "../test-helpers.js";

const AUTH_PATH = "~/.local/share/opencode/auth.json";
const CONFIG_PATH = "~/.config/usagepal/opencode-go.json";
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const payload = {
  usage: {
    rolling: { status: "ok", percent: 12, resetsAt: "2026-08-12T15:00:00.000Z" },
    weekly: { status: "ok", percent: 8, resetsAt: "2026-08-17T00:00:00.000Z" },
    monthly: { status: "ok", percent: 35, resetsAt: "2026-09-03T10:30:00.000Z" },
  },
};

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__usagepal_plugin;
};

function setAuth(ctx, key = "go-auth-key") {
  ctx.host.fs.writeText(AUTH_PATH, JSON.stringify({ "opencode-go": { type: "api", key } }));
}

function setSuccess(ctx) {
  ctx.host.http.request.mockReturnValue({ status: 200, bodyText: JSON.stringify(payload), headers: {} });
}

describe("opencode-go plugin", () => {
  beforeEach(() => {
    delete globalThis.__usagepal_plugin;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ships API-only metadata", () => {
    const manifest = JSON.parse(readFileSync("plugins/opencode-go/plugin.json", "utf8"));
    expect(manifest.detect).toEqual([
      { file: "~/.config/usagepal/opencode-go.json" },
      { file: "~/.local/share/opencode/auth.json" },
      { env: "OPENCODE_API_KEY" },
    ]);
    expect(manifest.lines).toEqual([
      { type: "progress", label: "Session", scope: "overview", primaryOrder: 1 },
      { type: "progress", label: "Weekly", scope: "overview", period: "weekly" },
      { type: "progress", label: "Monthly", scope: "overview", escalateAtPercent: 98 },
    ]);
  });

  it("fetches authoritative usage with the OpenCode login key", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);

    const result = (await loadPlugin()).probe(ctx);

    expect(ctx.host.http.request).toHaveBeenCalledWith({
      method: "GET",
      url: USAGE_URL,
      headers: { Authorization: "Bearer go-auth-key", Accept: "application/json" },
      timeoutMs: 15000,
    });
    expect(result.plan).toBe("Go");
    expect(result.lines).toEqual([
      expect.objectContaining({ label: "Session", used: 12, limit: 100, resetsAt: "2026-08-12T15:00:00.000Z" }),
      expect.objectContaining({ label: "Weekly", used: 8, limit: 100, resetsAt: "2026-08-17T00:00:00.000Z" }),
      expect.objectContaining({ label: "Monthly", used: 35, limit: 100, resetsAt: "2026-09-03T10:30:00.000Z" }),
    ]);
  });

  it("prefers a UsagePal-managed key over OpenCode auth and the environment", async () => {
    const ctx = makeCtx();
    ctx.host.fs.writeText(CONFIG_PATH, JSON.stringify({ apiKey: "settings-key" }));
    setAuth(ctx);
    ctx.host.env.get.mockReturnValue("env-key");
    setSuccess(ctx);

    (await loadPlugin()).probe(ctx);
    expect(ctx.host.http.request.mock.calls[0][0].headers.Authorization).toBe("Bearer settings-key");
  });

  it("falls back to OPENCODE_API_KEY", async () => {
    const ctx = makeCtx();
    ctx.host.env.get.mockImplementation((name) => name === "OPENCODE_API_KEY" ? " env-key " : null);
    setSuccess(ctx);

    (await loadPlugin()).probe(ctx);
    expect(ctx.host.http.request.mock.calls[0][0].headers.Authorization).toBe("Bearer env-key");
  });

  it("requires a key instead of using local history", async () => {
    const ctx = makeCtx();
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "No OpenCode API key. Log in to OpenCode, add one in Settings, or set OPENCODE_API_KEY.",
    );
    expect(ctx.host.sqlite.query).not.toHaveBeenCalled();
  });

  it.each([
    [401, "OpenCode API key invalid. Log in again or update the key in Settings."],
    [403, "An OpenCode Go subscription is required."],
    [500, "Couldn't update OpenCode Go usage."],
  ])("fails loudly for HTTP %s so the app keeps stale data", async (status, message) => {
    const ctx = makeCtx();
    setAuth(ctx);
    ctx.host.http.request.mockReturnValue({ status, bodyText: "{}", headers: {} });
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(message);
  });

  it("rejects malformed usage instead of restoring local estimates", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    ctx.host.http.request.mockReturnValue({ status: 200, bodyText: '{"usage":{}}', headers: {} });
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "OpenCode returned invalid usage data.",
    );
    expect(ctx.host.sqlite.query).not.toHaveBeenCalled();
  });

  it("does not treat a null percentage as zero", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    ctx.host.http.request.mockReturnValue({
      status: 200,
      bodyText: JSON.stringify({
        usage: {
          ...payload.usage,
          rolling: { ...payload.usage.rolling, percent: null },
        },
      }),
      headers: {},
    });
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "OpenCode returned invalid usage data.",
    );
  });

  it("turns request failures into a stale-data error", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    ctx.host.http.request.mockImplementation(() => { throw new Error("offline"); });
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "Couldn't reach OpenCode. Check your connection.",
    );
  });
});
