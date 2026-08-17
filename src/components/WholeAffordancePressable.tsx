import React, { useState } from "react";
import { Pressable, type PressableProps } from "react-native";

import {
  WHOLE_AFFORDANCE_HIT_SLOP,
  WHOLE_AFFORDANCE_PRESS_RETENTION_OFFSET,
} from "@/theme/interaction";

/**
 * A control whose native responder owns the final laid-out region. Descendant
 * text and SVGs remain visual content rather than competing touch targets.
 */
export function WholeAffordancePressable({
  accessible = true,
  children,
  collapsable = false,
  disabled,
  focusable = !disabled,
  hitSlop = WHOLE_AFFORDANCE_HIT_SLOP,
  onHoverIn,
  onHoverOut,
  onPressIn,
  onPressOut,
  pointerEvents = "box-only",
  pressRetentionOffset = WHOLE_AFFORDANCE_PRESS_RETENTION_OFFSET,
  style,
  ...props
}: PressableProps) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const state = { pressed, hovered };
  const resolvedStyle = typeof style === "function" ? style(state) : style;
  const resolvedChildren =
    typeof children === "function" ? children(state) : children;

  return (
    <Pressable
      {...props}
      accessible={accessible}
      collapsable={collapsable}
      disabled={disabled}
      focusable={focusable}
      hitSlop={hitSlop}
      onHoverIn={(event) => {
        setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      pointerEvents={pointerEvents}
      pressRetentionOffset={pressRetentionOffset}
      style={resolvedStyle}
    >
      {resolvedChildren}
    </Pressable>
  );
}
