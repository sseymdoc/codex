import assert from "node:assert/strict";
import test from "node:test";
import { applyChatDelta, mergeChat } from "./chat-state.ts";

test("late snapshots cannot roll back completed output; delta offsets avoid duplicate text", () => {
  const initial = { id: "chat", profileId: "a", title: "chat", model: "m", updatedAt: 1,
    turns: [{ id: "turn", user: "问题", assistant: "", model: "m", status: "running" }] };
  const delta = { id: "chat", profileId: "a", turnId: "turn", offset: 0, text: "回答" };
  const streamed = applyChatDelta(initial, delta);
  assert.equal(applyChatDelta(streamed, delta).turns[0].assistant, "回答");
  assert.equal(mergeChat(streamed, initial).turns[0].assistant, "回答");
  const finished = { ...streamed, turns: [{ ...streamed.turns[0], status: "completed" }] };
  assert.equal(mergeChat(finished, initial).turns[0].status, "completed");
  assert.deepEqual(applyChatDelta(initial, { ...delta, profileId: "b" }), initial);
});
