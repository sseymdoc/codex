// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of context.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { autoCompactAt, contextBreakdown, mcpToolTokens } from "./context.ts";

test("Codex compacts at 90% of the raw window it reports 95% of, or earlier when configured", () => {
  assert.equal(autoCompactAt(475_000), 450_000);
  assert.equal(autoCompactAt(996_147), 943_718);
  assert.equal(autoCompactAt(475_000, 300_000), 300_000);
  assert.equal(autoCompactAt(475_000, 600_000), 450_000);
  assert.equal(autoCompactAt(null, 300_000), 300_000);
  assert.equal(autoCompactAt(null), null);
});

test("lays the parts out as Claude does: four colors, Other, the buffer, then free and deferred", () => {
  const parts = { usedTokens: 314_600, windowTokens: 500_000, mcpDeferred: true, system: 9_700, tools: 21_400, skills: 9_500, agents: 500, memory: 224, mcp: 14_800, apps: 1_600 };
  const tools = [
    { name: "github · search", tokens: 200_000 },
    { name: "linear · issues", tokens: 79_200 },
  ];
  const { legend, meter, total, lists } = contextBreakdown(parts, 500_000, 450_000, tools);
  assert.deepEqual(
    legend.map(({ name, tokens, color }) => [name, tokens, color]),
    [
      ["Messages", 256_876, "var(--cds-chart-1)"],
      ["System tools", 21_400, "var(--cds-chart-2)"],
      ["MCP tools", 14_800, "var(--cds-chart-3)"],
      ["System prompt", 9_700, "var(--cds-chart-4)"],
      ["Skills", 9_500, "var(--cds-chart-reference)"],
      ["MCP server instructions", 1_600, "var(--cds-chart-reference)"],
      ["Memory files", 724, "var(--cds-chart-reference)"],
      ["Autocompact buffer", 50_000, "var(--cds-chart-muted)"],
      ["Free space", 135_400, "var(--cds-chart-reference-tint)"],
      ["MCP tools (deferred)", 279_200, "var(--cds-chart-muted)"],
    ],
  );
  assert.deepEqual(
    meter.map(({ name, tokens }) => [name, tokens]),
    [["Messages", 256_876], ["System tools", 21_400], ["MCP tools", 14_800], ["System prompt", 9_700], ["Other", 11_824], ["Autocompact buffer", 50_000]],
  );
  assert.equal(total, 500_000);
  assert.deepEqual(lists.map((list) => [list.label, list.rows.length]), [["MCP 工具", 2], ["记忆文件", 2]]);

  // Few parts each keep a color; a compaction that reset the count leaves Messages out.
  const small = contextBreakdown({ ...parts, usedTokens: 0, mcpDeferred: false, skills: 0, agents: 0, memory: 0, apps: 0 }, 500_000, null, tools);
  assert.deepEqual(small.meter.map(({ name, color }) => [name, color]), [["System tools", "var(--cds-chart-1)"], ["MCP tools", "var(--cds-chart-2)"], ["System prompt", "var(--cds-chart-3)"]]);
  assert.deepEqual(small.legend.at(-1), { id: "free", name: "Free space", tokens: 454_100, color: "var(--cds-chart-reference-tint)" });
});

test("what the live count grew past the read is 自上次更新以来, out of the free space, then the buffer", () => {
  const parts = { usedTokens: 314_600, windowTokens: 500_000, mcpDeferred: false, system: 9_700, tools: 21_400, skills: 9_500, agents: 500, memory: 224, mcp: 14_800, apps: 1_600 };
  const tail = (breakdown) => breakdown.legend.slice(-3).map(({ name, tokens }) => [name, tokens]);
  const grown = contextBreakdown(parts, 500_000, 450_000, [], 400_000);
  assert.deepEqual(tail(grown), [["自上次更新以来", 85_400], ["Autocompact buffer", 50_000], ["Free space", 50_000]]);
  // It and the buffer leave room for three colors before Other.
  assert.deepEqual(grown.meter.map(({ name }) => name), ["Messages", "System tools", "MCP tools", "Other", "自上次更新以来", "Autocompact buffer"]);
  const over = contextBreakdown(parts, 500_000, 450_000, [], 520_000);
  assert.deepEqual(tail(over), [["自上次更新以来", 205_400], ["Autocompact buffer", 0], ["Free space", 0]]);
  assert.equal(over.total, 520_000);
  // A count the read already covers adds nothing.
  assert.equal(contextBreakdown(parts, 500_000, 450_000, [], 300_000).legend.some((row) => row.id === "since"), false);
});

test("an MCP tool counts as Codex sends it", () => {
  assert.equal(mcpToolTokens("s", { name: "t", inputSchema: {} }), Math.ceil('{"name":"mcp__s__t","description":"","parameters":{}}'.length / 4));
});
