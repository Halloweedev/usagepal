import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx } from "../test-helpers.js";

const AUTH_PATH = "~/.local/share/opencode/auth.json";

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__openusage_plugin;
};

function setAuth(ctx, value = "go-key") {
  ctx.host.fs.writeText(
    AUTH_PATH,
    JSON.stringify({
      "opencode-go": { type: "api-key", key: value },
    }),
  );
}

function setHistoryQuery(ctx, rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  ctx.host.sqlite.query.mockImplementation((dbPath, sql) => {
    expect(dbPath).toBe("~/.local/share/opencode/opencode.db");

    if (String(sql).includes("SELECT 1 AS present")) {
      if (options.assertFilters !== false) {
        expect(String(sql)).toContain(
          "json_extract(data, '$.providerID') = 'opencode-go'",
        );
        expect(String(sql)).toContain(
          "json_extract(data, '$.role') = 'assistant'",
        );
        expect(String(sql)).toContain("$.tokens.input");
      }
      return JSON.stringify(list.length > 0 ? [{ present: 1 }] : []);
    }

    if (options.assertFilters !== false) {
      expect(String(sql)).toContain(
        "json_extract(data, '$.providerID') = 'opencode-go'",
      );
      expect(String(sql)).toContain(
        "json_extract(data, '$.role') = 'assistant'",
      );
      expect(String(sql)).toContain("$.tokens.input");
      expect(String(sql)).toContain(
        "COALESCE(json_extract(data, '$.time.created'), time_created)",
      );
      expect(String(sql)).toContain("json_extract(data, '$.modelID')");
    }

    return JSON.stringify(list);
  });
}

describe("opencode-go plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ships plugin metadata with links and expected line layout", () => {
    const manifest = JSON.parse(
      readFileSync("plugins/opencode-go/plugin.json", "utf8"),
    );

    expect(manifest.id).toBe("opencode-go");
    expect(manifest.name).toBe("OpenCode Go");
    expect(manifest.brandColor).toBe("#000000");
    expect(manifest.links).toEqual([
      { label: "Console", url: "https://opencode.ai/auth" },
      { label: "Docs", url: "https://opencode.ai/docs/go/" },
    ]);
    expect(manifest.lines).toEqual([
      { type: "progress", label: "Session", scope: "overview", primaryOrder: 1 },
      { type: "progress", label: "Weekly", scope: "overview", period: "weekly" },
      {
        type: "progress",
        label: "Monthly",
        scope: "overview",
        escalateAtPercent: 98,
      },
      { type: "text", label: "Today", scope: "detail" },
      { type: "text", label: "Yesterday", scope: "detail" },
      { type: "text", label: "Last 30 Days", scope: "detail" },
      { type: "barChart", label: "Usage Trend", scope: "detail" },
    ]);
  });

  it("throws when neither auth nor local history is present", async () => {
    const ctx = makeCtx();
    setHistoryQuery(ctx, []);

    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "OpenCode Go not detected. Log in with OpenCode Go or use it locally first.",
    );
  });

  it("enables with auth only and returns zeroed bars", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setAuth(ctx);
    setHistoryQuery(ctx, []);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.plan).toBe("Go");
    expect(result.lines.map((line) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Monthly",
    ]);
    expect(result.lines.every((line) => line.used === 0)).toBe(true);
    expect(result.lines[0].resetsAt).toBe("2026-03-06T17:00:00.000Z");
    expect(result.lines[1].resetsAt).toBe("2026-03-09T00:00:00.000Z");
    expect(result.lines[2].resetsAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("enables with history only when auth is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T11:00:00.000Z"), cost: 3 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.plan).toBe("Go");
    expect(result.lines[0].used).toBe(25);
  });

  it("uses row timestamp fallback when JSON timestamp is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T09:30:00.000Z"), cost: 1.2 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.lines[0].used).toBe(10);
    expect(result.lines[0].resetsAt).toBe("2026-03-06T14:30:00.000Z");
  });

  it("counts only the rolling 5h window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T06:30:00.000Z"), cost: 9 },
      { createdMs: Date.parse("2026-03-06T08:00:00.000Z"), cost: 2.4 },
      { createdMs: Date.parse("2026-03-06T10:00:00.000Z"), cost: 1.2 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.lines[0].used).toBe(30);
    expect(result.lines[0].resetsAt).toBe("2026-03-06T13:00:00.000Z");
  });

  it("uses UTC Monday boundaries for weekly aggregation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-01T23:59:59.000Z"), cost: 10 },
      { createdMs: Date.parse("2026-03-02T00:00:00.000Z"), cost: 6 },
      { createdMs: Date.parse("2026-03-05T09:00:00.000Z"), cost: 3 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    const weeklyLine = result.lines.find((line) => line.label === "Weekly");

    expect(weeklyLine.used).toBe(30);
    expect(weeklyLine.resetsAt).toBe("2026-03-09T00:00:00.000Z");
  });

  it("uses the earliest local usage timestamp as the monthly anchor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-02-25T07:53:16.000Z"), cost: 2.181 },
      { createdMs: Date.parse("2026-03-01T00:00:00.000Z"), cost: 0.2 },
      { createdMs: Date.parse("2026-03-04T12:00:00.000Z"), cost: 0.2904 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    const monthlyLine = result.lines.find((line) => line.label === "Monthly");

    expect(monthlyLine.used).toBe(4.5);
    expect(monthlyLine.resetsAt).toBe("2026-03-25T07:53:16.000Z");
    expect(monthlyLine.periodDurationMs).toBe(28 * 24 * 60 * 60 * 1000);
  });

  it("clamps percentages at 100", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T11:00:00.000Z"), cost: 40 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.lines[0].used).toBe(100);
  });

  it("returns a soft empty state when sqlite is unreadable but auth exists", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    ctx.host.sqlite.query.mockImplementation(() => {
      throw new Error("disk I/O error");
    });

    const plugin = await loadPlugin();
    expect(plugin.probe(ctx)).toEqual({
      plan: "Go",
      lines: [
        {
          type: "badge",
          label: "Status",
          text: "No usage data",
          color: "#a3a3a3",
        },
      ],
    });
  });

  it("returns a soft empty state when sqlite returns malformed JSON and auth exists", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    ctx.host.sqlite.query.mockReturnValue("not-json");

    const plugin = await loadPlugin();
    expect(plugin.probe(ctx)).toEqual({
      plan: "Go",
      lines: [
        {
          type: "badge",
          label: "Status",
          text: "No usage data",
          color: "#a3a3a3",
        },
      ],
    });
  });
});

describe("opencode-go spend aggregation", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prettifies model IDs like glm-5.1", async () => {
    const plugin = await loadPlugin();
    expect(plugin.__test.prettifyModelName("glm-5.1")).toBe("GLM 5.1");
    expect(plugin.__test.prettifyModelName("gpt-5.4")).toBe("GPT 5.4");
  });

  it("aggregates daily spend and tokens by UTC day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const plugin = await loadPlugin();
    const nowMs = Date.now();
    const rows = [
      {
        createdMs: Date.parse("2026-07-01T01:00:00.000Z"),
        cost: 1.5,
        modelID: "glm-5.1",
        tokens: 1_000_000,
      },
      {
        createdMs: Date.parse("2026-06-30T01:00:00.000Z"),
        cost: 2.0,
        modelID: "glm-5.1",
        tokens: 2_000_000,
      },
    ];

    const daily = plugin.__test.aggregateDailyFromRows(rows, nowMs);
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ date: "2026-06-30", costUSD: 2, totalTokens: 2_000_000 });
    expect(daily[1]).toMatchObject({ date: "2026-07-01", costUSD: 1.5, totalTokens: 1_000_000 });
  });

  it("aggregates per-model Today/Yesterday/7d/30d buckets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const plugin = await loadPlugin();
    const nowMs = Date.now();
    const rows = [
      {
        createdMs: Date.parse("2026-07-01T01:00:00.000Z"),
        cost: 1.5,
        modelID: "glm-5.1",
        tokens: 1_000_000,
      },
      {
        createdMs: Date.parse("2026-06-30T01:00:00.000Z"),
        cost: 2.0,
        modelID: "gpt-5.4",
        tokens: 2_000_000,
      },
    ];

    const result = plugin.__test.aggregateModelUsageFromRows(rows, nowMs);
    expect(result.models).toHaveLength(2);
    const glm = result.models.find((m) => m.name === "glm-5.1");
    expect(glm.costUSD.Today).toBeCloseTo(1.5);
    expect(glm.tokens.Today).toBe(1_000_000);
    const gpt = result.models.find((m) => m.name === "gpt-5.4");
    expect(gpt.costUSD.Yesterday).toBeCloseTo(2);
    expect(gpt.tokens["30d"]).toBe(2_000_000);
  });

  it("emits a single OpenCode Go line at 100% when model IDs are absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const plugin = await loadPlugin();
    const nowMs = Date.now();
    const rows = [
      {
        createdMs: Date.parse("2026-07-01T01:00:00.000Z"),
        cost: 3,
        modelID: null,
        tokens: 500_000,
      },
    ];

    const result = plugin.__test.aggregateModelUsageFromRows(rows, nowMs);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe("OpenCode Go");
    expect(result.models[0].percent).toBe(100);
  });

  it("appendSpendHistory adds Today/Yesterday/Last 30 Days + Usage Trend", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const ctx = makeCtx();
    const plugin = await loadPlugin();
    const lines = [];
    plugin.__test.appendSpendHistory(
      ctx,
      lines,
      [
        {
          createdMs: Date.parse("2026-07-01T01:00:00.000Z"),
          cost: 1.5,
          modelID: "glm-5.1",
          tokens: 1_000_000,
        },
        {
          createdMs: Date.parse("2026-06-30T01:00:00.000Z"),
          cost: 2.0,
          modelID: "glm-5.1",
          tokens: 2_000_000,
        },
      ],
      Date.now(),
    );

    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));
    expect(byLabel["Today"].type).toBe("text");
    expect(byLabel["Today"].value).toContain("1M");
    expect(byLabel["Yesterday"].value).toContain("2M");
    expect(byLabel["Last 30 Days"].value).toContain("3M");
    expect(byLabel["Usage Trend"].type).toBe("barChart");
    expect(byLabel["Usage Trend"].points).toHaveLength(2);
    expect(byLabel["GLM 5.1"].value).toContain("100%");
  });

  it("selects Today's bucket by UTC day, not local timezone", async () => {
    vi.stubEnv("TZ", "America/New_York");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T02:00:00.000Z"));

    try {
      const ctx = makeCtx();
      const plugin = await loadPlugin();
      const lines = [];
      plugin.__test.appendSpendHistory(
        ctx,
        lines,
        [
          {
            createdMs: Date.parse("2026-07-01T02:00:00.000Z"),
            cost: 1,
            modelID: "glm-5.1",
            tokens: 3_000_000,
          },
        ],
        Date.now(),
      );

      const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));
      expect(byLabel["Today"].value).toContain("3M");
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("appends share-graph lines to a successful probe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      {
        createdMs: Date.parse("2026-07-01T01:00:00.000Z"),
        cost: 1.5,
        modelID: "glm-5.1",
        tokensTotal: 1_000_000,
      },
      {
        createdMs: Date.parse("2026-06-30T01:00:00.000Z"),
        cost: 2.0,
        modelID: "gpt-5.4",
        tokensTotal: 2_000_000,
      },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    const labels = result.lines.map((line) => line.label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "Today",
        "Yesterday",
        "Last 30 Days",
        "Usage Trend",
        "GLM 5.1",
        "GPT 5.4",
      ]),
    );
  });

  it("estimates spend from tokens when stored cost is zero", async () => {
    const plugin = await loadPlugin();
    const ctx = { host: { log: { info: vi.fn(), warn: vi.fn() } } };
    const row = {
      cost: 0,
      modelID: "glm-5.1",
      tokensInput: 1_000_000,
      tokensOutput: 500_000,
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      tokensTotal: 1_500_000,
    };
    const estimated = plugin.__test.rowCostUsd(row, ctx);
    // $1.40/M input + $4.40/M output
    expect(estimated).toBeCloseTo(1.4 + 2.2);
    expect(ctx.host.log.info).not.toHaveBeenCalled();
  });

  it("keeps stored cost when it is already positive", async () => {
    const plugin = await loadPlugin();
    const ctx = { host: { log: { info: vi.fn(), warn: vi.fn() } } };
    const row = {
      cost: 2.5,
      modelID: "glm-5.1",
      tokensInput: 1_000_000,
      tokensOutput: 0,
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      tokensTotal: 1_000_000,
    };
    expect(plugin.__test.rowCostUsd(row, ctx)).toBe(2.5);
  });
});

describe("opencode-go pricing fallthrough", () => {
  it("does not let an unlisted minimax version fall through to minimax-m3's rates", async () => {
    const plugin = await loadPlugin();
    // Regression: `^minimax-m3` was an unanchored prefix, so a future
    // minimax-m3.x matched it and silently inherited minimax-m3's price.
    const base = plugin.__test.estimatedCostDollars("minimax-m3", 1_000_000, 0, 0, 0, 0);
    expect(base).toBeGreaterThan(0);
    expect(
      plugin.__test.estimatedCostDollars("minimax-m3.5", 1_000_000, 0, 0, 0, 0),
    ).toBeNull();
  });

  it("still prices the listed minimax versions", async () => {
    const plugin = await loadPlugin();
    expect(plugin.__test.estimatedCostDollars("minimax-m3", 1_000_000, 0, 0, 0, 0)).toBeGreaterThan(0);
    expect(plugin.__test.estimatedCostDollars("minimax-m2.7", 1_000_000, 0, 0, 0, 0)).toBeGreaterThan(0);
    expect(plugin.__test.estimatedCostDollars("minimax-m2.5", 1_000_000, 0, 0, 0, 0)).toBeGreaterThan(0);
  });
});
