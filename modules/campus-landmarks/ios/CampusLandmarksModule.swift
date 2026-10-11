import ExpoModulesCore
import ExpoUI

public final class CampusLandmarksModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CampusLandmarks")

    Function("isSupported") { true }

    ExpoUIView(CampusLandmarksView.self)
  }
}
