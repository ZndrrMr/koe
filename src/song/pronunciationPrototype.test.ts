import assert from "node:assert/strict";
import test from "node:test";

import {
  SONG_PROTOTYPE_LINE,
  advanceSongPrototype,
  answerSongQuestion,
  lineBoundaryAction,
  lineProgress,
} from "./pronunciationPrototype";

test("the prototype only advances and completes in the intended direction", () => {
  assert.equal(advanceSongPrototype("song", "line"), "line");
  assert.equal(advanceSongPrototype("imitate", "listen"), "imitate");
  assert.equal(advanceSongPrototype("question", "complete"), "complete");
});

test("a selected line pauses once or restarts when looping", () => {
  assert.equal(
    lineBoundaryAction({
      currentSeconds: SONG_PROTOTYPE_LINE.endSeconds - 0.01,
      endSeconds: SONG_PROTOTYPE_LINE.endSeconds,
      looping: true,
    }),
    "continue",
  );
  assert.equal(
    lineBoundaryAction({
      currentSeconds: SONG_PROTOTYPE_LINE.endSeconds,
      endSeconds: SONG_PROTOTYPE_LINE.endSeconds,
      looping: false,
    }),
    "pause",
  );
  assert.equal(
    lineBoundaryAction({
      currentSeconds: SONG_PROTOTYPE_LINE.endSeconds + 0.04,
      endSeconds: SONG_PROTOTYPE_LINE.endSeconds,
      looping: true,
    }),
    "restart",
  );
});

test("line progress clamps around the permitted excerpt", () => {
  assert.equal(lineProgress(0), 0);
  assert.equal(lineProgress(SONG_PROTOTYPE_LINE.endSeconds), 1);
  assert.equal(lineProgress(99), 1);
  assert.ok(
    lineProgress(
      (SONG_PROTOTYPE_LINE.startSeconds + SONG_PROTOTYPE_LINE.endSeconds) / 2,
    ) > 0.49,
  );
});

test("context questions return learning guidance instead of lyric expansion", () => {
  assert.match(answerSongQuestion("repeat"), /echo/);
  assert.match(answerSongQuestion("phrasing"), /one short phrase/);
});
