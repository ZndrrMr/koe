import type {
  NativeSyntheticEvent,
  StyleProp,
  ViewProps,
  ViewStyle,
} from "react-native";

export type PencilPoint = { x: number; y: number };
export type PencilStroke = { start: PencilPoint; end: PencilPoint };
export type PencilBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DrawingChangePayload = {
  hasInk: boolean;
  strokeCount: number;
  strokes: PencilStroke[];
  contentBounds: PencilBounds;
};

export type RecognitionPayload = DrawingChangePayload & {
  revision: number;
  candidates: Array<{ text: string; confidence: number }>;
  error?: string;
};

export type KoePencilKitViewProps = Omit<ViewProps, "style"> & {
  allowsFingerDrawing?: boolean;
  inkColor?: string;
  clearRevision?: number;
  undoRevision?: number;
  recognitionRevision?: number;
  onDrawingChange?: (event: NativeSyntheticEvent<DrawingChangePayload>) => void;
  onRecognition?: (event: NativeSyntheticEvent<RecognitionPayload>) => void;
  style?: StyleProp<ViewStyle>;
};
