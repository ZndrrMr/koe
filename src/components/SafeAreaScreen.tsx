import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import {
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { resolveSafeAreaInsets } from "@/theme/interaction";

/**
 * A screen root that applies the device's measured safe-area padding itself.
 * Keeping the padding on the final root also makes native-modal handoffs safe.
 */
export function SafeAreaScreen({ style, ...props }: ViewProps) {
  const measuredInsets = useSafeAreaInsets();
  const insets = resolveSafeAreaInsets(
    measuredInsets,
    initialWindowMetrics?.insets,
  );

  return (
    <View
      {...props}
      style={[
        styles.screen,
        style,
        {
          paddingTop: insets.top,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
