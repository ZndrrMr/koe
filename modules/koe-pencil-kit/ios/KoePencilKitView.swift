import ExpoModulesCore
import PencilKit
import UIKit
import Vision

final class KoePencilKitView: ExpoView, PKCanvasViewDelegate {
  private let canvasView = PKCanvasView()
  private var clearRevision = 0
  private var undoRevision = 0
  private var recognitionRevision = 0
  private var pendingDrawingChange: DispatchWorkItem?
  private var inkColor = UIColor(red: 0.09, green: 0.13, blue: 0.13, alpha: 1)

  let onDrawingChange = EventDispatcher()
  let onRecognition = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .clear

    canvasView.backgroundColor = .clear
    canvasView.isOpaque = false
    canvasView.isScrollEnabled = false
    canvasView.bounces = false
    canvasView.drawingPolicy = .anyInput
    canvasView.tool = PKInkingTool(.pen, color: inkColor, width: 5)
    canvasView.delegate = self
    addSubview(canvasView)

    isAccessibilityElement = true
    accessibilityLabel = "Japanese handwriting field"
    accessibilityHint = "Draw with Apple Pencil or one finger. The toolbar above the field can check or clear the writing."
    accessibilityTraits = [.allowsDirectInteraction]
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    canvasView.frame = bounds
  }

  func setAllowsFingerDrawing(_ value: Bool) {
    canvasView.drawingPolicy = value ? .anyInput : .pencilOnly
    accessibilityHint = value
      ? "Draw with Apple Pencil or one finger. The toolbar above the field can check or clear the writing."
      : "Draw with Apple Pencil. Turn on finger drawing with the control above the field."
  }

  func setInkColor(_ value: String) {
    guard let parsedColor = UIColor(koeHex: value) else { return }
    inkColor = parsedColor
    canvasView.tool = PKInkingTool(.pen, color: inkColor, width: 5)
  }

  func applyClear(revision: Int) {
    guard revision > clearRevision else { return }
    clearRevision = revision
    canvasView.drawing = PKDrawing()
    canvasView.undoManager?.removeAllActions()
    emitDrawingChange()
  }

  func applyUndo(revision: Int) {
    guard revision > undoRevision else { return }
    undoRevision = revision
    canvasView.undoManager?.undo()
    emitDrawingChange()
  }

  func applyRecognition(revision: Int) {
    guard revision > recognitionRevision else { return }
    recognitionRevision = revision

    let drawing = canvasView.drawing
    let geometry = geometryPayload(for: drawing)
    guard !drawing.strokes.isEmpty, let image = recognitionImage(for: drawing) else {
      onRecognition([
        "revision": revision,
        "hasInk": false,
        "strokeCount": 0,
        "candidates": [],
        "strokes": geometry.strokes,
        "contentBounds": geometry.contentBounds,
        "error": "emptyDrawing"
      ])
      return
    }

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["ja-JP"]
      request.usesLanguageCorrection = false
      request.minimumTextHeight = 0.18

      do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let observations = request.results ?? []
        var seen = Set<String>()
        let candidates = observations
          .flatMap { $0.topCandidates(3) }
          .filter { candidate in
            let text = candidate.string.replacingOccurrences(of: " ", with: "")
            guard !text.isEmpty, !seen.contains(text) else { return false }
            seen.insert(text)
            return true
          }
          .prefix(4)
          .map { candidate in
            [
              "text": candidate.string.replacingOccurrences(of: " ", with: ""),
              "confidence": Double(candidate.confidence)
            ] as [String: Any]
          }

        DispatchQueue.main.async {
          self?.onRecognition([
            "revision": revision,
            "hasInk": true,
            "strokeCount": drawing.strokes.count,
            "candidates": Array(candidates),
            "strokes": geometry.strokes,
            "contentBounds": geometry.contentBounds
          ])
        }
      } catch {
        DispatchQueue.main.async {
          self?.onRecognition([
            "revision": revision,
            "hasInk": true,
            "strokeCount": drawing.strokes.count,
            "candidates": [],
            "strokes": geometry.strokes,
            "contentBounds": geometry.contentBounds,
            "error": String(describing: error)
          ])
        }
      }
    }
  }

  func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) {
    pendingDrawingChange?.cancel()
    emitDrawingChange()
  }

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    pendingDrawingChange?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.emitDrawingChange()
    }
    pendingDrawingChange = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: workItem)
  }

  private func emitDrawingChange() {
    let payload = geometryPayload(for: canvasView.drawing)
    onDrawingChange([
      "hasInk": !canvasView.drawing.strokes.isEmpty,
      "strokeCount": canvasView.drawing.strokes.count,
      "strokes": payload.strokes,
      "contentBounds": payload.contentBounds
    ])
  }

  private func geometryPayload(for drawing: PKDrawing) -> (
    strokes: [[String: Any]],
    contentBounds: [String: Double]
  ) {
    let width = max(canvasView.bounds.width, 1)
    let height = max(canvasView.bounds.height, 1)
    let strokes = drawing.strokes.compactMap { stroke -> [String: Any]? in
      guard let first = stroke.path.first, let last = stroke.path.last else { return nil }
      return [
        "start": ["x": first.location.x / width, "y": first.location.y / height],
        "end": ["x": last.location.x / width, "y": last.location.y / height]
      ]
    }
    let drawingBounds = drawing.bounds
    let contentBounds: [String: Double]
    if drawingBounds.isNull || drawingBounds.isEmpty {
      contentBounds = ["x": 0, "y": 0, "width": 0, "height": 0]
    } else {
      contentBounds = [
        "x": drawingBounds.minX / width,
        "y": drawingBounds.minY / height,
        "width": drawingBounds.width / width,
        "height": drawingBounds.height / height
      ]
    }
    return (strokes, contentBounds)
  }

  private func recognitionImage(for drawing: PKDrawing) -> CGImage? {
    let sourceBounds = drawing.bounds.insetBy(dx: -20, dy: -20)
    guard !sourceBounds.isNull, !sourceBounds.isEmpty else { return nil }
    let inkImage = drawing.image(from: sourceBounds, scale: 2)
    let renderer = UIGraphicsImageRenderer(size: inkImage.size)
    let image = renderer.image { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: inkImage.size))
      inkImage.draw(at: .zero)
    }
    return image.cgImage
  }
}

private extension UIColor {
  convenience init?(koeHex: String) {
    let value = koeHex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    guard value.count == 6, let number = Int(value, radix: 16) else { return nil }
    self.init(
      red: CGFloat((number >> 16) & 0xff) / 255,
      green: CGFloat((number >> 8) & 0xff) / 255,
      blue: CGFloat(number & 0xff) / 255,
      alpha: 1
    )
  }
}
