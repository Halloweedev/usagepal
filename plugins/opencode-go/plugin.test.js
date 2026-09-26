import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx } from "../test-helpers.js";

const AUTH_PATH = "~/.local/share/opencode/auth.json";
const CONFIG_PATH = "~/.config/usagepal/opencode-go.json";
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const DB_PATH = "~/.local/share/opencode/opencode.db";

const payload = {
  usage: {
    rolling: { status: "ok", percent: 12, resetsAt: "2026-08-12T15:00:00.000Z" },
    weekly: { status: "ok", percent: 8, resetsAt: "2026-08-17T00:00:00.000Z" },
    monthly: { status: "ok", percent: 35, resetsAt: "2026-09-03T10:30:00.000Z" },
  },
};

// Rows shaped like the plugin's local-history SQL: one per assistant message.
// nowIso is 2026-02-02T00:00:00Z, so today = 02-02, yesterday = 02-01.
const localRows = [
  { createdMs: 1770026400000, cost: 0.5, modelID: "deepseek-v4-pro", tokensTotal: 1000 },
  { createdMs: 1769958000000, cost: 0.25, modelID: "deepseek-v4-pro", tokensTotal: 500 },
  { createdMs: 1768003200000, cost: 0.1, modelID: "gpt-5.2", tokensTotal: 200 },
];

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

// The plugin probes sqlite_master for the V2 `session_message` table before it
// reads history, so route each query by its SQL instead of a single canned reply.
function mockSqlite(ctx, { schema = "v2", rows = [] } = {}) {
  ctx.host.sqlite.query.mockImplementation((_dbPath, sql) => {
    if (sql.includes("sqlite_master")) {
      return JSON.stringify([{ present: schema === "v2" ? 1 : 0 }]);
    }
    return JSON.stringify(rows);
  });
}

function setSqliteRows(ctx, rows) {
  mockSqlite(ctx, { schema: "v1", rows });
}

// Every probe starts with a sqlite_master schema check, so the history SQL is
// what the row-shape assertions should look at.
const historySql = (ctx) => ctx.host.sqlite.query.mock.calls
  .map((call) => call[1])
  .filter((sql) => !sql.includes("sqlite_master"))
  .join("\n");

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
      { type: "text", label: "Today", scope: "detail" },
      { type: "text", label: "Yesterday", scope: "detail" },
      { type: "text", label: "Last 30 Days", scope: "detail" },
      { type: "barChart", label: "Usage Trend", scope: "detail" },
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
    // The default sqlite mock returns an empty result set, which is "no local
    // spend" and now renders as $0.00 rows rather than being dropped.
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Session", used: 12, limit: 100, resetsAt: "2026-08-12T15:00:00.000Z" }),
      expect.objectContaining({ label: "Weekly", used: 8, limit: 100, resetsAt: "2026-08-17T00:00:00.000Z" }),
      expect.objectContaining({ label: "Monthly", used: 35, limit: 100, resetsAt: "2026-09-03T10:30:00.000Z" }),
    ]));
  });

  it("prefers a UsagePal-managed key over OpenCode auth and the environment", async () => {
    const ctx = makeCtx();
    ctx.host.fs.writeText(CONFIG_PATH, JSON.stringify({ apiKey: "settings-key" }));
    setAuth(ctx);
    ctx.host.env.get.mockImplementation((name) => name === "OPENCODE_API_KEY" ? "env-key" : null);
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

  it("prefers a per-account managed key over all shared sources", async () => {
    const ctx = makeCtx();
    ctx.host.fs.writeText(CONFIG_PATH, JSON.stringify({ apiKey: "settings-key" }));
    setAuth(ctx);
    ctx.host.env.get.mockImplementation((name) =>
      name === "USAGEPAL_OPENCODE_GO_API_KEY" ? "account-key" : "env-key"
    );
    setSuccess(ctx);

    (await loadPlugin()).probe(ctx);
    expect(ctx.host.http.request.mock.calls[0][0].headers.Authorization).toBe("Bearer account-key");
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

  it("renders local spend lines from the OpenCode database for the local login", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    setSqliteRows(ctx, localRows);

    const result = (await loadPlugin()).probe(ctx);

    expect(ctx.host.sqlite.query).toHaveBeenCalledWith(
      DB_PATH,
      expect.stringContaining("'opencode-go'"),
    );
    expect(result.lines).toEqual([
      expect.objectContaining({ label: "Session" }),
      expect.objectContaining({ label: "Weekly" }),
      expect.objectContaining({ label: "Monthly" }),
      expect.objectContaining({ label: "Today", value: "$0.50 · 1K" }),
      expect.objectContaining({ label: "Yesterday", value: "$0.25 · 500" }),
      expect.objectContaining({ label: "Last 30 Days", value: "$0.85 · 1.7K" }),
      expect.objectContaining({
        type: "barChart",
        label: "Usage Trend",
        points: expect.arrayContaining([
          expect.objectContaining({ label: "2/2", value: 1000, valueLabel: "1K" }),
          expect.objectContaining({ label: "2/1", value: 500, valueLabel: "500" }),
        ]),
      }),
      expect.objectContaining({ label: "DeepSeek V4 Pro", value: "88.2% · 30d $0.75" }),
      expect.objectContaining({ label: "GPT-5.2", value: "11.8% · 30d $0.10" }),
    ]);
  });

  it("reads V2 session_message rows when the V2 schema is present", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    mockSqlite(ctx, { schema: "v2", rows: localRows });

    const result = (await loadPlugin()).probe(ctx);

    const sql = historySql(ctx);
    expect(sql).toContain("FROM session_message");
    expect(sql).toContain("type = 'assistant'");
    expect(sql).toContain("'$.model.providerID') = 'opencode-go'");
    expect(sql).toContain("$.model.id");
    // The V1 paths address fields V2 moved, so they must not be used here.
    expect(sql).not.toContain("$.providerID");
    expect(sql).not.toContain("$.modelID");
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Today", value: "$0.50 · 1K" }),
      expect.objectContaining({ label: "Yesterday", value: "$0.25 · 500" }),
      expect.objectContaining({ label: "Last 30 Days", value: "$0.85 · 1.7K" }),
    ]));
  });

  it("sums V2 nested cache tokens and filters on the indexed time_created column", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    mockSqlite(ctx, { schema: "v2", rows: localRows });

    (await loadPlugin()).probe(ctx);

    const sql = historySql(ctx);
    // V2 nests cache reads under tokens.cache; the flat V1 names read 0 here and
    // cache reads are the bulk of the token count.
    expect(sql).toContain("$.tokens.cache.read");
    expect(sql).toContain("$.tokens.cache.write");
    // Wrapping time_created in a function defeats session_message_time_created_idx
    // and pushed the 30-day scan past the host's 15s sqlite deadline.
    expect(sql).toMatch(/WHERE time_created >= \d+/);
    expect(sql).not.toMatch(/CAST\(COALESCE\(json_extract\(data, '\$\.time\.created'\), time_created\) AS INTEGER\) >=/);
  });

  it("falls back to the V1 message table when session_message is absent", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    mockSqlite(ctx, { schema: "v1", rows: localRows });

    const result = (await loadPlugin()).probe(ctx);

    const sql = historySql(ctx);
    expect(sql).toContain("FROM message");
    expect(sql).toContain("$.providerID");
    expect(sql).toContain("$.modelID");
    expect(sql).not.toContain("session_message");
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Today", value: "$0.50 · 1K" }),
      expect.objectContaining({ label: "Yesterday", value: "$0.25 · 500" }),
      expect.objectContaining({ label: "Last 30 Days", value: "$0.85 · 1.7K" }),
    ]));
  });

  it("renders zeroed day rows for days inside the window that have no usage", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    // 2026-01-10: inside the 30-day window, but neither today (02-02) nor
    // yesterday (02-01).
    mockSqlite(ctx, {
      schema: "v2",
      rows: [{ createdMs: 1768003200000, cost: 0.1, modelID: "gpt-5.2", tokensTotal: 200 }],
    });

    const result = (await loadPlugin()).probe(ctx);

    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Today", value: "$0.00" }),
      expect.objectContaining({ label: "Yesterday", value: "$0.00" }),
      expect.objectContaining({ label: "Last 30 Days", value: "$0.10 · 200" }),
    ]));
  });

  it("renders zeroed spend rows when the window has no history", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    mockSqlite(ctx, { schema: "v2", rows: [] });

    const result = (await loadPlugin()).probe(ctx);

    // An empty window means "no spend", not "no data" — dropping the rows is what
    // let the V2 schema break hide for weeks.
    expect(result.lines).toEqual([
      expect.objectContaining({ label: "Session" }),
      expect.objectContaining({ label: "Weekly" }),
      expect.objectContaining({ label: "Monthly" }),
      expect.objectContaining({ label: "Today", value: "$0.00" }),
      expect.objectContaining({ label: "Yesterday", value: "$0.00" }),
      expect.objectContaining({ label: "Last 30 Days", value: "$0.00" }),
    ]);
  });

  it("skips the local database for accounts without local logs and renders dash rows", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    ctx.host.env.get.mockImplementation((name) =>
      name === "USAGEPAL_LOCAL_LOGS_UNAVAILABLE" ? "1" : null
    );

    const result = (await loadPlugin()).probe(ctx);

    expect(ctx.host.sqlite.query).not.toHaveBeenCalled();
    expect(result.lines).toEqual([
      expect.objectContaining({ label: "Session" }),
      expect.objectContaining({ label: "Weekly" }),
      expect.objectContaining({ label: "Monthly" }),
      expect.objectContaining({ label: "Today", value: "—" }),
      expect.objectContaining({ label: "Yesterday", value: "—" }),
      expect.objectContaining({ label: "Last 30 Days", value: "—" }),
    ]);
  });

  it("keeps quota lines when the local database query fails", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setSuccess(ctx);
    ctx.host.sqlite.query.mockImplementation(() => {
      throw new Error("sqlite3 error: database is locked");
    });

    const result = (await loadPlugin()).probe(ctx);

    expect(result.lines).toEqual([
      expect.objectContaining({ label: "Session" }),
      expect.objectContaining({ label: "Weekly" }),
      expect.objectContaining({ label: "Monthly" }),
    ]);
    expect(ctx.host.log.warn).toHaveBeenCalled();
  });

  it("prettifies raw local-history model ids into friendly display names", async () => {
    const plugin = await loadPlugin();
    const prettify = plugin.__test.prettifyModelName;
    // GPT-family ids reuse Codex's shape so the same model merges across
    // providers downstream (e.g. no separate "gpt-5.6-luna" row).
    expect(prettify("gpt-5.6-luna")).toBe("GPT-5.6 Luna");
    expect(prettify("gpt-5.2")).toBe("GPT-5.2");
    expect(prettify("deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
    expect(prettify("deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
    expect(prettify("kimi-k3")).toBe("Kimi K3");
    expect(prettify("kimi-k2.6")).toBe("Kimi K2.6");
    expect(prettify("kimi-k2.7-code")).toBe("Kimi K2.7 Code");
    expect(prettify("glm-5.1")).toBe("GLM 5.1");
    expect(prettify("minimax-m3")).toBe("MiniMax M3");
    expect(prettify("some-unknown-model")).toBe("Some Unknown Model");
  });
});
