import ExpoModulesCore
import AVFoundation
import CoreMedia

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
      let range = CMTimeRange(
        start: CMTime(seconds: startMs / 1000, preferredTimescale: 600),
        duration: CMTime(seconds: (endMs - startMs) / 1000, preferredTimescale: 600)
      )
      let composition = AVMutableComposition()
      let videos = try await asset.loadTracks(withMediaType: .video)
      guard let video = videos.first,
        let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
      else { throw NSError(domain: "VideoExport", code: 3) }
      try track.insertTimeRange(range, of: video, at: .zero)

      let naturalSize = try await video.load(.naturalSize)
      let preferredTransform = try await video.load(.preferredTransform)
      // Bake display orientation into pixels so players that ignore
      // preferredTransform (and landscape export presets) still look upright.
      let orientedRect = CGRect(origin: .zero, size: naturalSize).applying(preferredTransform)
      var renderWidth = abs(orientedRect.width)
      var renderHeight = abs(orientedRect.height)
      if renderWidth < 1 || renderHeight < 1 {
        renderWidth = max(1, abs(naturalSize.width))
        renderHeight = max(1, abs(naturalSize.height))
      }

      let maxLongEdge: CGFloat = quality == "preview" ? 640 : (quality == "medium" ? 1280 : 1920)
      let longEdge = max(renderWidth, renderHeight)
      if longEdge > maxLongEdge {
        let scale = maxLongEdge / longEdge
        renderWidth = (renderWidth * scale).rounded()
        renderHeight = (renderHeight * scale).rounded()
      }
      // H.264 encoders prefer even dimensions.
      renderWidth = max(2, (renderWidth / 2).rounded(.down) * 2)
      renderHeight = max(2, (renderHeight / 2).rounded(.down) * 2)

      let videoComposition = AVMutableVideoComposition()
      videoComposition.renderSize = CGSize(width: renderWidth, height: renderHeight)
      videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

      let instruction = AVMutableVideoCompositionInstruction()
      instruction.timeRange = CMTimeRange(start: .zero, duration: range.duration)
      let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
      var transform = preferredTransform
      transform.tx -= orientedRect.minX
      transform.ty -= orientedRect.minY
      let scaleX = abs(orientedRect.width) > 0 ? renderWidth / abs(orientedRect.width) : 1
      let scaleY = abs(orientedRect.height) > 0 ? renderHeight / abs(orientedRect.height) : 1
      transform = transform.concatenating(CGAffineTransform(scaleX: scaleX, y: scaleY))
      layer.setTransform(transform, at: .zero)
      instruction.layerInstructions = [layer]
      videoComposition.instructions = [instruction]

      // Identity transform on the composition track — orientation is in the composition.
      track.preferredTransform = .identity

      if !muted {
        for audio in try await asset.loadTracks(withMediaType: .audio) {
          let audioRange = CMTimeRangeGetIntersection(range, otherRange: try await audio.load(.timeRange))
          if audioRange.duration.seconds > 0,
            let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try audioTrack.insertTimeRange(audioRange, of: audio, at: CMTimeSubtract(audioRange.start, range.start))
          }
        }
      }

      // Automatically prune leftover temp export files older than 1 hour to prevent sandbox disk bloat
      ChatVideoProcessorModule.pruneStaleTempFiles()

      // Passthrough-friendly preset; actual size comes from videoComposition.renderSize.
      let preset = AVAssetExportPresetHighestQuality
      guard let exporter = AVAssetExportSession(asset: composition, presetName: preset) else {
        throw NSError(domain: "VideoExport", code: 4)
      }
      let output = FileManager.default.temporaryDirectory.appendingPathComponent("chat-video-\(UUID().uuidString).mp4")
      exporter.outputURL = output
      exporter.outputFileType = .mp4
      exporter.shouldOptimizeForNetworkUse = true
      exporter.fileLengthLimit = 24 * 1024 * 1024
      exporter.videoComposition = videoComposition
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

  private static func pruneStaleTempFiles(olderThanSeconds: TimeInterval = 3600) {
    let tempDir = FileManager.default.temporaryDirectory
    guard let files = try? FileManager.default.contentsOfDirectory(
      at: tempDir,
      includingPropertiesForKeys: [.contentModificationDateKey]
    ) else { return }

    let cutoff = Date().addingTimeInterval(-olderThanSeconds)
    for file in files where file.lastPathComponent.hasPrefix("chat-video-") && file.pathExtension == "mp4" {
      if let attrs = try? file.resourceValues(forKeys: [.contentModificationDateKey]),
         let modDate = attrs.contentModificationDate,
         modDate < cutoff {
        try? FileManager.default.removeItem(at: file)
      }
    }
  }
}
