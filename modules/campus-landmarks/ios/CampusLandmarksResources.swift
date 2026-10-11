import Foundation

final class CampusLandmarksResourceAnchor: NSObject {}

enum CampusLandmarksResources {
  static var bundle: Bundle {
    let framework = Bundle(for: CampusLandmarksResourceAnchor.self)
    // CocoaPods static frameworks can place resource bundles beside the app or framework.
    for parent in [framework, Bundle.main] {
      if let url = parent.url(forResource: "CampusLandmarks", withExtension: "bundle"),
         let bundle = Bundle(url: url) {
        return bundle
      }
    }
    return framework
  }
}
