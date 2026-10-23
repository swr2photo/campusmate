package expo.modules.facegesturecamera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FaceGestureCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FaceGestureCamera")
    Function("isAvailable") { true }
    View(FaceGestureCameraView::class) {
      Events("onFaceUpdate", "onCameraError")
      Prop("active") { view: FaceGestureCameraView, active: Boolean -> view.setActive(active) }
      AsyncFunction("capture") { view: FaceGestureCameraView, promise: Promise -> view.capture(promise) }
      AsyncFunction("captureFrame") { view: FaceGestureCameraView, frameId: Int, promise: Promise -> view.captureFrame(frameId, promise) }
      OnViewDestroys { view: FaceGestureCameraView -> view.release() }
    }
  }
}
