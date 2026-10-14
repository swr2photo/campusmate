import AWSPluginsCore
import AVFoundation
import ExpoModulesCore
import FaceLiveness
import SwiftUI

// Bridge to the AWS-maintained SwiftUI liveness detector. The JS side gets
// only "the stream finished" or a safe error code: never images or scores.
// The server decides the verification result.
//
// SPIKE STATUS: written against amplify-ui-swift-liveness 1.x public API and
// not yet compiled. Verify every symbol on Xcode 26 before enabling.
//
// The challenge (movement + light, or movement only for photosensitive
// people) is chosen by the server's CreateFaceLivenessSession preferences;
// the detector's default options use the front camera for both. Confirm the
// pinned Amplify UI version supports FaceMovementChallenge before release.

private struct LivenessCredentials: AWSTemporaryCredentials {
  let accessKeyId: String
  let secretAccessKey: String
  let sessionToken: String
  let expiration: Date
}

/// Serves the short-lived STS credentials issued by the Rust backend for this
/// one session. They live in memory only and are never written or logged.
private struct SessionCredentialsProvider: AWSCredentialsProvider {
  let credentials: LivenessCredentials
  func fetchAWSCredentials() async throws -> AWSCredentials { credentials }
}

struct PresentOptions: Record {
  @Field var sessionId: String = ""
  @Field var region: String = ""
  @Field var credentials: [String: String] = [:]
}

private struct LivenessScreen: View {
  let sessionId: String
  let region: String
  let provider: SessionCredentialsProvider
  let onFinish: (Result<Void, FaceLivenessDetectionError>) -> Void
  @State private var isPresented = true

  var body: some View {
    FaceLivenessDetectorView(
      sessionID: sessionId,
      credentialsProvider: provider,
      region: region,
      isPresented: $isPresented,
      onCompletion: onFinish
    )
  }
}

private func safeCode(_ error: FaceLivenessDetectionError) -> String {
  switch error {
  case .userCancelled: return "CANCELLED"
  case .cameraPermissionDenied: return "CAMERA_UNAVAILABLE"
  case .sessionTimedOut, .sessionNotFound: return "SESSION_EXPIRED"
  default: return "SERVICE_UNAVAILABLE"
  }
}

public class FaceLivenessModule: Module {
  private var presenting = false // Accessed only on the main queue.
  public func definition() -> ModuleDefinition {
    Name("FaceLiveness")

    AsyncFunction("present") { (options: PresentOptions, promise: Promise) in
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let fallback = ISO8601DateFormatter()
      guard
        !options.sessionId.isEmpty, options.sessionId.count <= 128,
        options.region == "ap-southeast-7",
        let accessKeyId = options.credentials["accessKeyId"],
        let secretAccessKey = options.credentials["secretAccessKey"],
        let sessionToken = options.credentials["sessionToken"],
        let rawExpiration = options.credentials["expiration"],
        let expiration = formatter.date(from: rawExpiration) ?? fallback.date(from: rawExpiration),
        expiration > Date(), !accessKeyId.isEmpty, !secretAccessKey.isEmpty, !sessionToken.isEmpty
      else {
        promise.reject("SERVICE_UNAVAILABLE", "Invalid liveness session")
        return
      }
      let provider = SessionCredentialsProvider(credentials: LivenessCredentials(
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
        sessionToken: sessionToken,
        expiration: expiration
      ))

      DispatchQueue.main.async {
        guard !self.presenting else {
          promise.reject("SERVICE_UNAVAILABLE", "A liveness check is already open")
          return
        }
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject("SERVICE_UNAVAILABLE", "No screen to present on")
          return
        }
        self.presenting = true
        let presentCamera = {
        var host: UIViewController?
        var finished = false
        let screen = LivenessScreen(
          sessionId: options.sessionId,
          region: options.region,
          provider: provider,
          onFinish: { result in
            DispatchQueue.main.async {
            guard !finished else { return }
            finished = true
            host?.dismiss(animated: true) {
              self.presenting = false
              host = nil // Break the hosting-controller/completion closure cycle.
              switch result {
              case .success:
                promise.resolve(["streamCompleted": true])
              case .failure(let error):
                promise.reject(safeCode(error), "Liveness check ended")
              }
            }
            }
          }
        )
        let controller = UIHostingController(rootView: screen)
        controller.modalPresentationStyle = .fullScreen
        host = controller
        presenter.present(controller, animated: true)
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
          presentCamera()
        case .notDetermined:
          AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
              if granted { presentCamera() }
              else { self.presenting = false; promise.reject("CAMERA_UNAVAILABLE", "Camera permission denied") }
            }
          }
        default:
          self.presenting = false
          promise.reject("CAMERA_UNAVAILABLE", "Camera permission denied")
        }
      }
    }
  }
}
