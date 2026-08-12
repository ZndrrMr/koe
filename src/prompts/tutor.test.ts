import assert from "node:assert/strict";
import test from "node:test";

import { CONVERSATION_BEHAVIOR_CASES, tutorSystemPrompt } from "./tutor";

test("neutral conversation is the default without selected context", () => {
  const prompt = tutorSystemPrompt();

  assert.match(prompt, /default mode is free conversation/i);
  assert.match(
    prompt,
    /Several turns should routinely pass with no praise, correction, modeled answer/i,
  );
  assert.match(prompt, /No optional context was selected/);
  assert.doesNotMatch(prompt, /Your job every single turn/i);
});

test("optional context cannot replace the conversation contract", () => {
  const prompt = tutorSystemPrompt({
    topic: "Ordering at a ramen shop",
    responseLevel: "natural everyday conversation at a measured pace",
  });

  assert.match(prompt, /Conversation topic: Ordering at a ramen shop/);
  assert.match(prompt, /Preferred reply style: natural everyday conversation/);
  assert.match(
    prompt,
    /does not authorize a character, roleplay, lesson, exercise, correction routine, or learning goal/,
  );
});

test("representative conversation, confusion, correction, and roleplay cases are included", () => {
  const prompt = tutorSystemPrompt();
  const expectedCases = [
    "natural-conversation",
    "confusion",
    "correction-request",
    "roleplay-request",
  ];

  assert.deepEqual(
    CONVERSATION_BEHAVIOR_CASES.map(({ id }) => id),
    expectedCases,
  );
  for (const example of CONVERSATION_BEHAVIOR_CASES) {
    assert.match(prompt, new RegExp(`\\[${example.id}\\]`));
    assert.ok(prompt.includes(example.transcript));
  }
});

test("natural behavior example sustains conversation without a teaching interruption", () => {
  const natural = CONVERSATION_BEHAVIOR_CASES.find(
    ({ id }) => id === "natural-conversation",
  );

  assert.ok(natural);
  assert.equal(natural.transcript.match(/Assistant:/g)?.length, 3);
  assert.doesNotMatch(
    natural.transcript,
    /正しい|直して|もう一度|練習|try again/i,
  );
});

test("explicit coaching and roleplay requests are honored without becoming defaults", () => {
  const prompt = tutorSystemPrompt();

  assert.match(
    prompt,
    /explicitly asks to be taught, translated, corrected, drilled/,
  );
  assert.match(
    prompt,
    /Enter a persona or roleplay only when the learner explicitly asks/,
  );
  assert.match(
    prompt,
    /then return to the conversation unless they ask to stay in teaching mode/,
  );
});
