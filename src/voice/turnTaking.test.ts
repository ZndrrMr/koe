import assert from "node:assert/strict";
import test from "node:test";

import { HANDS_FREE_ENDPOINT, endpointDelayMs } from "./turnTaking";

test("hands-free endpoint thresholds preserve hesitation but close final speech quickly", () => {
  assert.equal(
    endpointDelayMs("interim", "昨日は京都へ行きました"),
    HANDS_FREE_ENDPOINT.interimSilenceMs,
  );
  assert.equal(
    endpointDelayMs("interim", "昨日は、えっと…"),
    HANDS_FREE_ENDPOINT.hesitationSilenceMs,
  );
  assert.equal(
    endpointDelayMs("final", "短い返事"),
    HANDS_FREE_ENDPOINT.finalResultGraceMs,
  );
  assert.equal(
    endpointDelayMs("speechEnd"),
    HANDS_FREE_ENDPOINT.speechEndGraceMs,
  );
  assert.ok(HANDS_FREE_ENDPOINT.finalResultGraceMs <= 150);
  assert.ok(HANDS_FREE_ENDPOINT.speechEndGraceMs <= 350);
  assert.ok(
    HANDS_FREE_ENDPOINT.maximumUtteranceMs >
      HANDS_FREE_ENDPOINT.initialSilenceMs,
  );
});
