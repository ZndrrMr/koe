export const MINIMUM_TOUCH_TARGET = 44;
export const CONTROL_MAX_FONT_SIZE_MULTIPLIER = 1.6;

export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const WHOLE_AFFORDANCE_HIT_SLOP = {
  top: 2,
  right: 2,
  bottom: 2,
  left: 2,
} as const;

export const WHOLE_AFFORDANCE_PRESS_RETENTION_OFFSET = {
  top: 12,
  right: 12,
  bottom: 12,
  left: 12,
} as const;

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
  studyMode: 58,
  studyAdvance: 66,
} as const;

export function meetsMinimumTouchTarget(size: number): boolean {
  return size >= MINIMUM_TOUCH_TARGET;
}

/**
 * Native full-screen modals can briefly report zero context insets while their
 * window is attaching. Use the largest real measurement available so controls
 * never jump under the sensor housing or home indicator during that handoff.
 */
export function resolveSafeAreaInsets(
  measured: EdgeInsets,
  initial?: EdgeInsets,
): EdgeInsets {
  return {
    top: Math.max(0, measured.top, initial?.top ?? 0),
    right: Math.max(0, measured.right, initial?.right ?? 0),
    bottom: Math.max(0, measured.bottom, initial?.bottom ?? 0),
    left: Math.max(0, measured.left, initial?.left ?? 0),
  };
}
