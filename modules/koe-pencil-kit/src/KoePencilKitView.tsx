import { requireNativeView, requireOptionalNativeModule } from "expo";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import type { KoePencilKitViewProps } from "./KoePencilKit.types";

const hasNativeView =
  Platform.OS === "ios" && Boolean(requireOptionalNativeModule("KoePencilKit"));
const NativeView = hasNativeView
  ? (requireNativeView(
      "KoePencilKit",
    ) as React.ComponentType<KoePencilKitViewProps>)
  : undefined;

export default function KoePencilKitView(props: KoePencilKitViewProps) {
  if (NativeView) return <NativeView {...props} />;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Handwriting canvas unavailable"
      style={[styles.fallback, props.style]}
    >
      <Text style={styles.fallbackText}>
        Handwriting needs Koe’s iOS development build. Stroke directions remain
        available below as an accessibility fallback.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  fallbackText: {
    color: "#68736E",
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 320,
    textAlign: "center",
  },
});
