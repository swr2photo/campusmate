package expo.modules.chatvideoprocessor

import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.transformer.*
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

class ChatVideoProcessorModule : Module() {
  private val active = mutableSetOf<Transformer>()
  override fun definition() = ModuleDefinition {
    Name("ChatVideoProcessor")
    AsyncFunction("exportVideo") { uri: String, startMs: Double, endMs: Double, muted: Boolean, quality: String, promise: Promise ->
      val context = appContext.reactContext ?: throw IllegalStateException("App unavailable")
      var output: File? = null
      try {
        require(startMs.isFinite() && endMs.isFinite() && startMs >= 0 && endMs > startMs && endMs - startMs <= 60000)
        require(quality in listOf("preview", "medium", "high"))
        val metadata = MediaMetadataRetriever()
        val duration: Long
        val displayHeight: Int
        val isPortraitDisplay: Boolean
        try {
          metadata.setDataSource(context, Uri.parse(uri))
          duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
          val codedWidth = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 720
          val codedHeight = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 480
          val rotation = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toInt() ?: 0
          val swapAxes = rotation == 90 || rotation == 270
          val displayWidth = if (swapAxes) codedHeight else codedWidth
          displayHeight = if (swapAxes) codedWidth else codedHeight
          isPortraitDisplay = displayHeight > displayWidth
        } finally { metadata.release() }
        require(endMs <= duration + 1) { "Invalid trim range" }
        output = File(context.cacheDir, "chat-video-${UUID.randomUUID()}.mp4")
        val destination = requireNotNull(output)
        val targetHeight = min(
          max(displayHeight, 1),
          when (quality) {
            "preview" -> 360
            "medium" -> 720
            else -> 1080
          }
        )
        val item = MediaItem.Builder().setUri(uri).setClippingConfiguration(
          MediaItem.ClippingConfiguration.Builder().setStartPositionMs(startMs.toLong()).setEndPositionMs(endMs.toLong()).build()
        ).build()
        // Scale in *display* space so portrait phone videos keep the right aspect.
        val edited = EditedMediaItem.Builder(item).setRemoveAudio(muted)
          .setEffects(Effects(emptyList(), listOf(Presentation.createForHeight(targetHeight))))
          .build()
        Handler(Looper.getMainLooper()).post {
          try {
            lateinit var transformer: Transformer
            fun startExport(portraitEncoding: Boolean) {
              transformer = Transformer.Builder(context)
                // Bake upright pixels for portrait so players that ignore
                // rotation metadata (or lose it) still show the correct frame.
                .setPortraitEncodingEnabled(portraitEncoding && isPortraitDisplay)
                .setEncoderFactory(DefaultEncoderFactory.Builder(context)
                  .setRequestedVideoEncoderSettings(
                    VideoEncoderSettings.Builder().setBitrate(
                      when (quality) {
                        "preview" -> 450000
                        "medium" -> 1600000
                        else -> 2600000
                      }
                    ).build()
                  ).build())
                .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
                .addListener(object : Transformer.Listener {
                  override fun onCompleted(composition: Composition, result: ExportResult) {
                    active.remove(transformer)
                    val actual = MediaMetadataRetriever()
                    try {
                      actual.setDataSource(destination.absolutePath)
                      val actualDuration = actual.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toDouble()
                      require(actualDuration > 0 && actualDuration <= 60000) { "Export exceeds 60 seconds" }
                      promise.resolve(mapOf("uri" to Uri.fromFile(destination).toString(), "duration" to actualDuration))
                    } catch (error: Exception) {
                      destination.delete()
                      promise.reject("VIDEO_EXPORT_FAILED", error.message, error)
                    } finally { actual.release() }
                  }
                  override fun onError(composition: Composition, result: ExportResult, error: ExportException) {
                    active.remove(transformer)
                    if (portraitEncoding && isPortraitDisplay) {
                      // Some encoders reject true portrait — fall back to
                      // landscape-coded frames with rotation metadata.
                      destination.delete()
                      try {
                        startExport(portraitEncoding = false)
                      } catch (fallbackError: Exception) {
                        destination.delete()
                        promise.reject("VIDEO_EXPORT_FAILED", fallbackError.message, fallbackError)
                      }
                      return
                    }
                    destination.delete()
                    promise.reject("VIDEO_EXPORT_FAILED", error.message, error)
                  }
                }).build()
              active.add(transformer)
              transformer.start(edited, destination.absolutePath)
            }
            startExport(portraitEncoding = true)
          } catch (error: Exception) {
            destination.delete()
            promise.reject("VIDEO_EXPORT_FAILED", error.message, error)
          }
        }
      } catch (error: Exception) {
        output?.delete()
        promise.reject("VIDEO_EXPORT_FAILED", error.message, error)
      }
    }
    OnDestroy {
      Handler(Looper.getMainLooper()).post { active.forEach { it.cancel() }; active.clear() }
    }
  }
}
