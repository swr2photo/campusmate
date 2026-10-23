import AVFoundation
import CoreImage
import ExpoModulesCore
import ImageIO
import Vision

public class FaceGestureCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FaceGestureCamera")
    Function("isAvailable") { true }
    View(FaceGestureCameraView.self) {
      Events("onFaceUpdate", "onCameraError")
      Prop("active") { (view: FaceGestureCameraView, active: Bool) in
        view.setActive(active)
      }
      // Only touches the camera, which serialises work on its own queue.
      AsyncFunction("capture") { (view: FaceGestureCameraView, promise: Promise) in
        view.camera.capture(promise)
      }
      AsyncFunction("captureFrame") { (view: FaceGestureCameraView, frameId: Int, promise: Promise) in
        view.camera.captureFrame(frameId, promise)
      }
    }
  }
}

/// Front-camera preview for the gesture phase of photo verification. The
/// pose and eye estimates only drive the on-screen guidance; the server
/// judges the frames returned by `capture`. Frames stay in memory.
final class FaceGestureCameraView: ExpoView {
  let onFaceUpdate = EventDispatcher()
  let onCameraError = EventDispatcher()
  let camera = FaceGestureCamera()
  private let previewLayer: AVCaptureVideoPreviewLayer

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: camera.session)
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    camera.onFace = { [weak self] payload in
      DispatchQueue.main.async { self?.onFaceUpdate(payload) }
    }
    camera.onError = { [weak self] code in
      DispatchQueue.main.async { self?.onCameraError(["code": code]) }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  func setActive(_ active: Bool) {
    if active {
      camera.start()
    } else {
      camera.stop()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      camera.stop()
    }
  }

  deinit {
    camera.stop()
  }
}

/// Capture session and Vision analysis, off the main thread.
final class FaceGestureCamera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let session = AVCaptureSession()
  var onFace: (([String: Any]) -> Void)?
  var onError: ((String) -> Void)?

  private let sessionQueue = DispatchQueue(label: "app.campusmate.facegesture.session")
  private let videoQueue = DispatchQueue(label: "app.campusmate.facegesture.video")
  private let imageContext = CIContext()
  // sessionQueue
  private var configured = false
  // videoQueue
  private var running = false
  private var lastEmit: TimeInterval = 0
  private var captures: [(id: UUID, promise: Promise)] = []
  private var frameId = 0
  private var frames: [(id: Int, at: TimeInterval, image: CGImage)] = []

  private static let emitInterval: TimeInterval = 0.08
  private static let captureTimeout: TimeInterval = 2.5
  private static let maxEdge: CGFloat = 720
  private static let frameLifetime: TimeInterval = 0.5

  func start() {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      onError?("PERMISSION")
      return
    }
    sessionQueue.async {
      if !self.configured {
        self.configured = self.configure()
      }
      guard self.configured else {
        self.onError?("CAMERA_UNAVAILABLE")
        return
      }
      if !self.session.isRunning {
        self.session.startRunning()
      }
      self.videoQueue.async { self.running = true }
    }
  }

  func stop() {
    videoQueue.async {
      self.running = false
      self.fail(self.captures.map { $0.promise }, code: "CAMERA_INACTIVE")
      self.captures.removeAll()
      self.frames.removeAll()
    }
    sessionQueue.async {
      if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  /// Resolves with the next frame as an upright, unmirrored JPEG.
  func capture(_ promise: Promise) {
    videoQueue.async {
      guard self.running else {
        promise.reject("CAMERA_INACTIVE", "Camera is not running")
        return
      }
      let id = UUID()
      self.captures.append((id: id, promise: promise))
      self.videoQueue.asyncAfter(deadline: .now() + Self.captureTimeout) {
        guard let index = self.captures.firstIndex(where: { $0.id == id }) else { return }
        self.captures.remove(at: index).promise.reject("CAPTURE_TIMEOUT", "No camera frame")
      }
    }
  }

  /// Retain only a bounded set of recently analysed frames in memory. The
  /// requested frame must still be fresh; never substitute a different pose.
  func captureFrame(_ frameId: Int, _ promise: Promise) {
    videoQueue.async {
      guard self.running else {
        promise.reject("CAMERA_INACTIVE", "Camera is not running")
        return
      }
      let now = ProcessInfo.processInfo.systemUptime
      self.frames.removeAll { now - $0.at > Self.frameLifetime }
      guard let index = self.frames.firstIndex(where: { $0.id == frameId }) else {
        promise.reject("CAPTURE_TIMEOUT", "Detected frame expired")
        return
      }
      let frame = self.frames.remove(at: index)
      self.deliver(CIImage(cgImage: frame.image), to: [promise])
    }
  }

  private func configure() -> Bool {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    if session.canSetSessionPreset(.vga640x480) {
      session.sessionPreset = .vga640x480
    }
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else { return false }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: videoQueue)
    guard session.canAddOutput(output) else { return false }
    session.addOutput(output)
    if let connection = output.connection(with: .video) {
      // Upright, unmirrored frames: what the server analyses.
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) {
          connection.videoRotationAngle = 90
        }
      } else if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
    return true
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard running, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    if !captures.isEmpty {
      deliver(pixels)
    }
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastEmit >= Self.emitInterval else { return }
    lastEmit = now
    var payload = analyze(pixels)
    frameId += 1
    frames.removeAll { now - $0.at > Self.frameLifetime }
    // Copy the analysed image rather than retaining camera-pool buffers.
    // Holding those buffers could starve capture during a slow JS frame.
    let image = CIImage(cvPixelBuffer: pixels)
    if let copy = imageContext.createCGImage(image, from: image.extent) {
      frames.append((id: frameId, at: now, image: copy))
      if frames.count > 4 { frames.removeFirst(frames.count - 4) }
      payload["frameId"] = frameId
    }
    onFace?(payload)
  }

  private func analyze(_ pixels: CVPixelBuffer) -> [String: Any] {
    let rectangles = VNDetectFaceRectanglesRequest()
    rectangles.revision = VNDetectFaceRectanglesRequestRevision3
    let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:])
    guard (try? handler.perform([rectangles])) != nil else { return ["faces": 0] }
    let faces = rectangles.results ?? []
    let area = { (face: VNFaceObservation) in face.boundingBox.width * face.boundingBox.height }
    guard let face = faces.max(by: { area($0) < area($1) }) else { return ["faces": 0] }
    let landmarks = VNDetectFaceLandmarksRequest()
    landmarks.inputFaceObservations = [face]
    try? handler.perform([landmarks])
    let detail = landmarks.results?.first?.landmarks
    let degrees = { (value: NSNumber?) -> Double in (value?.doubleValue ?? 0) * 180 / .pi }
    return [
      "faces": faces.count,
      "yaw": degrees(face.yaw),
      "pitch": degrees(face.pitch),
      "roll": degrees(face.roll),
      "leftEyeOpen": openness(detail?.leftEye),
      "rightEyeOpen": openness(detail?.rightEye),
      // Vision's origin is bottom-left, and the preview is mirrored.
      "centerX": 1 - Double(face.boundingBox.midX),
      "centerY": 1 - Double(face.boundingBox.midY),
      "size": Double(face.boundingBox.width),
    ]
  }

  /// Rough 0...1 openness from the eye outline's height to width ratio.
  /// It only animates the guidance; the server confirms the blink.
  private func openness(_ eye: VNFaceLandmarkRegion2D?) -> Double {
    guard let points = eye?.normalizedPoints, points.count >= 4 else { return -1 }
    let xs = points.map(\.x)
    let ys = points.map(\.y)
    guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max(),
          maxX - minX > 0 else { return -1 }
    let ratio = Double((maxY - minY) / (maxX - minX))
    return min(1, max(0, (ratio - 0.12) / 0.16))
  }

  private func deliver(_ pixels: CVPixelBuffer) {
    let waiting = captures.map { $0.promise }
    captures.removeAll()
    deliver(CIImage(cvPixelBuffer: pixels), to: waiting)
  }

  private func deliver(_ source: CIImage, to waiting: [Promise]) {
    var image = source
    let longest = max(image.extent.width, image.extent.height)
    if longest > Self.maxEdge {
      let scale = Self.maxEdge / longest
      image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
    let quality = [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.82]
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let jpeg = imageContext.jpegRepresentation(of: image, colorSpace: space, options: quality) else {
      fail(waiting, code: "CAPTURE_FAILED")
      return
    }
    let result: [String: Any] = [
      "base64": jpeg.base64EncodedString(),
      "width": Int(image.extent.width.rounded()),
      "height": Int(image.extent.height.rounded()),
    ]
    waiting.forEach { $0.resolve(result) }
  }

  private func fail(_ promises: [Promise], code: String) {
    promises.forEach { $0.reject(code, "Camera frame unavailable") }
  }
}
