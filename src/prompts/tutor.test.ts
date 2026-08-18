import assert from "node:assert/strict";
import test from "node:test";

import { CONVERSATION_BEHAVIOR_CASES, tutorSystemPrompt } from "./tutor";

test("neutral conversation is the only default", () => {
  const prompt = tutorSystemPrompt();

  assert.match(prompt, /default mode is free conversation/i);
  assert.match(
    prompt,
    /Several turns should routinely pass with no praise, correction, modeled answer/i,
  );
  assert.doesNotMatch(prompt, /Your job every single turn/i);
  assert.doesNotMatch(prompt, /optional context|preferred reply style/i);
});

test("representative conversation, teaching, roleplay, and language switching cases are included", () => {
  const prompt = tutorSystemPrompt();
  const expectedCases = [
    "natural-conversation",
    "confusion",
    "correction-request",
    "roleplay-request",
    "language-switching",
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

test("English and Japanese switch fluidly, including inside one utterance", () => {
  const prompt = tutorSystemPrompt();
  const switching = CONVERSATION_BEHAVIOR_CASES.find(
    ({ id }) => id === "language-switching",
  );

  assert.ok(switching);
  assert.match(prompt, /Choose the reply language again on every turn/i);
  assert.match(prompt, /Koe is never Japanese-only/i);
  assert.match(prompt, /English and Japanese in the same utterance/i);
  assert.match(prompt, /switch back immediately/i);
  assert.ok(switching.transcript.includes("仕事は楽しかったです"));
  assert.ok(switching.transcript.includes("日本語に戻りましょう"));
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
    /persona or roleplay only when the learner explicitly asks/,
  );
  assert.match(
    prompt,
    /then return to the conversation unless they ask to stay in teaching mode/,
  );
});
