import ExpoModulesCore
import AVFoundation

public class ChatVideoProcessorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ChatVideoProcessor")
    AsyncFunction("exportVideo") { (uri: String, startMs: Double, endMs: Double, muted: Bool, quality: String) async throws -> [String: Any] in
      guard let url = URL(string: uri), url.isFileURL,
        startMs.isFinite, endMs.isFinite, startMs >= 0, endMs > startMs, endMs - startMs <= 60000,
        ["preview", "medium", "high"].contains(quality) else { throw NSError(domain: "VideoExport", code: 1) }
      let asset = AVURLAsset(url: url)
      let duration = try await asset.load(.duration)
      guard endMs <= duration.seconds * 1000 + 1 else { throw NSError(domain: "VideoExport", code: 2) }
      let range = CMTimeRange(start: CMTime(seconds: startMs / 1000, preferredTimescale: 600),
        duration: CMTime(seconds: (endMs - startMs) / 1000, preferredTimescale: 600))
      let composition = AVMutableComposition()
      let videos = try await asset.loadTracks(withMediaType: .video)
      guard let video = videos.first,
        let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
      else { throw NSError(domain: "VideoExport", code: 3) }
      try track.insertTimeRange(range, of: video, at: .zero)
      track.preferredTransform = try await video.load(.preferredTransform)
      if !muted {
        for audio in try await asset.loadTracks(withMediaType: .audio) {
          let audioRange = CMTimeRangeGetIntersection(range, try await audio.load(.timeRange))
          if audioRange.duration.seconds > 0, let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try audioTrack.insertTimeRange(audioRange, of: audio, at: CMTimeSubtract(audioRange.start, range.start))
          }
        }
      }
      let preset = quality == "preview" ? AVAssetExportPreset640x480 : (quality == "medium" ? AVAssetExportPreset1280x720 : AVAssetExportPreset1920x1080)
      guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else { throw NSError(domain: "VideoExport", code: 4) }
      let output = FileManager.default.temporaryDirectory.appendingPathComponent("chat-video-\(UUID().uuidString).mp4")
      exporter.outputURL = output
      exporter.outputFileType = .mp4
      exporter.shouldOptimizeForNetworkUse = true
      exporter.fileLengthLimit = 24 * 1024 * 1024
      do {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
          exporter.exportAsynchronously {
            if exporter.status == .completed { continuation.resume() }
            else { continuation.resume(throwing: exporter.error ?? NSError(domain: "VideoExport", code: 5)) }
          }
        }
        let resultDuration = try await AVURLAsset(url: output).load(.duration).seconds * 1000
        guard resultDuration > 0, resultDuration <= 60000 else { throw NSError(domain: "VideoExport", code: 6) }
        return ["uri": output.absoluteString, "duration": resultDuration]
      } catch {
        try? FileManager.default.removeItem(at: output)
        throw error
      }
    }
  }
}
