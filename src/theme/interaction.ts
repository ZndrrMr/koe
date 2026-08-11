export const MINIMUM_TOUCH_TARGET = 44;

/**
 * Shared dimensions for conversation controls. Keeping these named makes the
 * visible affordance and its interactive region the same measurable object.
 */
export const CONVERSATION_TARGET = {
  minimum: MINIMUM_TOUCH_TARGET,
  roundIcon: 48,
  direction: 50,
  action: 52,
  codaAction: 56,
  microphone: 68,
} as const;

export function meetsMinimumTouchTarget(size: number): boolean {
  return size >= MINIMUM_TOUCH_TARGET;
}
