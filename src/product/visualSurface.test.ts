import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("the production surface implements the approved Blue Marginalia tokens", async () => {
  const palette = await source("src/theme/colors.ts");
  for (const token of [
    "#F4EFE4",
    "#FBF8F0",
    "#191D20",
    "#2F5F8F",
    "#1D4A6D",
    "#D7AD4B",
    "#B7AB96",
    "#8E3F34",
    "#111B25",
    "#A9C6D5",
  ]) {
    assert.match(palette, new RegExp(token, "i"), token);
  }
});

test("only the four approved production states use generated artwork", async () => {
  const [onboarding, home, session, plate, presentation] = await Promise.all([
    source("app/onboarding/welcome.tsx"),
    source("app/index.tsx"),
    source("app/session/[id].tsx"),
    source("src/components/AcousticVoiceForm.tsx"),
    source("src/voice/acousticVisual.ts"),
  ]);

  assert.match(onboarding, /useKoeIllustration\("microphoneEducation"\)/);
  assert.match(home, /useKoeIllustration\("homeStart"\)/);
  assert.match(session, /useKoeIllustration\("recovery"\)/);
  assert.match(session, /useKoeIllustration\("coda"\)/);
  assert.doesNotMatch(plate, /Image|useKoeIllustration|\.webp/);
  assert.match(plate, /kind=\{presentation\.plate\}/);
  assert.match(
    presentation,
    /Record<VoicePhase, AcousticPresentation>/,
  );
});

test("production UI stays calm and review state injection stays development-only", async () => {
  const [home, session, feedback] = await Promise.all([
    source("app/index.tsx"),
    source("app/session/[id].tsx"),
    source("src/components/PronunciationFeedbackCard.tsx"),
  ]);

  assert.doesNotMatch(
    `${home}\n${session}`,
    /ambientDisc|ambientCircle|latency/,
  );
  assert.doesNotMatch(feedback, /scoreSeal|breakdown|PitchContour/);
  assert.match(
    session,
    /if \(!__DEV__ \|\| reviewStateAppliedRef\.current\) return;/,
  );
  assert.match(session, /EXPO_PUBLIC_KOE_REVIEW_PHASE/);
  assert.match(session, /session\.voice\.phase/);
  assert.match(session, /CloseoutStage = "ending" \| "coda"/);
});
