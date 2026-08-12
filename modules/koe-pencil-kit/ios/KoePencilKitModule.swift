import ExpoModulesCore

public final class KoePencilKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KoePencilKit")

    View(KoePencilKitView.self) {
      Events("onDrawingChange", "onRecognition")

      Prop("allowsFingerDrawing") { (view: KoePencilKitView, allowsFingerDrawing: Bool) in
        view.setAllowsFingerDrawing(allowsFingerDrawing)
      }

      Prop("inkColor") { (view: KoePencilKitView, inkColor: String) in
        view.setInkColor(inkColor)
      }

      Prop("clearRevision") { (view: KoePencilKitView, revision: Int) in
        view.applyClear(revision: revision)
      }

      Prop("undoRevision") { (view: KoePencilKitView, revision: Int) in
        view.applyUndo(revision: revision)
      }

      Prop("recognitionRevision") { (view: KoePencilKitView, revision: Int) in
        view.applyRecognition(revision: revision)
      }
    }
  }
}
