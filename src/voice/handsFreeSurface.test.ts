import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("the default conversation surface has one-tap hands-free copy and no hold/release handlers", async () => {
  const [button, session, lifecycle, acousticVisual, home] = await Promise.all(
    [
      "src/components/MicButton.tsx",
      "app/session/[id].tsx",
      "src/voice/lifecycle.ts",
      "src/voice/acousticVisual.ts",
      "app/index.tsx",
    ].map((relativePath) =>
      readFile(path.resolve(process.cwd(), relativePath), "utf8"),
    ),
  );

  assert.match(button, /hands-free-control/);
  assert.match(button, /One tap starts continuous turn-taking/);
  assert.doesNotMatch(button, /onPressIn|onPressOut|hold-to-speak/);
  assert.doesNotMatch(
    `${button}\n${session}\n${lifecycle}\n${acousticVisual}`,
    /\bhold\b|\brelease\b/iu,
  );
  assert.match(session, /engine\.startHandsFree\(\)/);
  assert.match(session, /EXPO_PUBLIC_KOE_INJECT_AUDIO_URIS/);
  assert.match(home, /autostart: "1"/);
});
