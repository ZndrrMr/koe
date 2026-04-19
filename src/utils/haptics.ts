import * as Haptics from 'expo-haptics';

export const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
export const press = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
export const success = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
export const warn = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
export const fail = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
