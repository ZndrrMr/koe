export function shouldAutoSendFirstTranscript(input: {
  intro?: string;
  existingTurnCount: number;
  transcript: string;
}): boolean {
  return (
    input.intro === "1" &&
    input.existingTurnCount === 0 &&
    input.transcript.trim().length > 0
  );
}
