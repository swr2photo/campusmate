package expo.modules.facegesturecamera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Size
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * Front-camera preview with on-device face tracking for the gesture phase of
 * photo verification. The pose and eye estimates only drive the on-screen
 * guidance: the server judges the frames returned by capture(). Frames stay
 * in memory and nothing is written to disk.
 */
class FaceGestureCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onFaceUpdate by EventDispatcher()
  private val onCameraError by EventDispatcher()
  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  private val analysisExecutor = Executors.newSingleThreadExecutor()
  private val detector = FaceDetection.getClient(
    FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      .setMinFaceSize(0.15f)
      .build()
  )
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  @Volatile private var active = false
  @Volatile private var released = false
  @Volatile private var lastEmit = 0L
  private val captureLock = Any()
  private val pendingCaptures = mutableListOf<Promise>()
  // Owned only by analysisExecutor; bounded copies, never ImageProxy buffers.
  private data class Snapshot(val at: Long, val bitmap: Bitmap, val rotation: Int)
  private val frames = linkedMapOf<Int, Snapshot>()
  private var frameId = 0

  init {
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  fun setActive(value: Boolean) {
    if (released || value == active) return
    active = value
    if (value) bind() else unbind()
  }

  /** Resolves with the next camera frame as an upright, unmirrored JPEG. */
  fun capture(promise: Promise) {
    if (!active || released) {
      promise.reject("CAMERA_INACTIVE", "Camera is not running", null)
      return
    }
    synchronized(captureLock) { pendingCaptures.add(promise) }
    mainHandler.postDelayed({
      val expired = synchronized(captureLock) { pendingCaptures.remove(promise) }
      if (expired) promise.reject("CAPTURE_TIMEOUT", "No camera frame", null)
    }, CAPTURE_TIMEOUT_MS)
  }

  fun captureFrame(id: Int, promise: Promise) {
    if (!active || released) {
      promise.reject("CAMERA_INACTIVE", "Camera is not running", null)
      return
    }
    analysisExecutor.execute {
      val frame = frames.remove(id)
      if (frame == null) {
        promise.reject("CAPTURE_TIMEOUT", "Detected frame expired", null)
        return@execute
      }
      try {
        if (!active || released) promise.reject("CAMERA_INACTIVE", "Camera stopped", null)
        else if (SystemClock.elapsedRealtime() - frame.at > FRAME_LIFETIME_MS) {
          promise.reject("CAPTURE_TIMEOUT", "Detected frame expired", null)
        } else promise.resolve(encode(frame.bitmap, frame.rotation))
      } catch (_: Exception) {
        promise.reject("CAPTURE_FAILED", "Frame unavailable", null)
      } finally {
        frame.bitmap.recycle()
      }
    }
  }

  fun release() {
    if (released) return
    released = true
    active = false
    unbind()
    analysisExecutor.shutdown()
    detector.close()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (active && !released && analysis == null) bind()
  }

  override fun onDetachedFromWindow() {
    unbind()
    super.onDetachedFromWindow()
  }

  private fun bind() {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      onCameraError(mapOf("code" to "PERMISSION"))
      return
    }
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      onCameraError(mapOf("code" to "CAMERA_UNAVAILABLE"))
      return
    }
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!active || released || analysis != null) return@addListener
      try {
        val cameraProvider = future.get()
        val resolution = ResolutionSelector.Builder()
          .setResolutionStrategy(
            ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)
          )
          .build()
        val newPreview = Preview.Builder().build()
        newPreview.setSurfaceProvider(previewView.surfaceProvider)
        val newAnalysis = ImageAnalysis.Builder()
          .setResolutionSelector(resolution)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
        newAnalysis.setAnalyzer(analysisExecutor) { image -> analyze(image) }
        cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, newPreview, newAnalysis)
        provider = cameraProvider
        preview = newPreview
        analysis = newAnalysis
      } catch (error: Exception) {
        onCameraError(mapOf("code" to "CAMERA_UNAVAILABLE"))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun unbind() {
    val cameraProvider = provider
    val useCases = listOfNotNull(preview, analysis)
    if (cameraProvider != null && useCases.isNotEmpty()) {
      try {
        cameraProvider.unbind(*useCases.toTypedArray())
      } catch (_: Exception) {
      }
    }
    preview = null
    analysis = null
    val waiting = synchronized(captureLock) { pendingCaptures.toList().also { pendingCaptures.clear() } }
    waiting.forEach { it.reject("CAMERA_INACTIVE", "Camera stopped", null) }
    if (!analysisExecutor.isShutdown) {
      analysisExecutor.execute {
        frames.values.forEach { it.bitmap.recycle() }
        frames.clear()
      }
    }
  }

  @OptIn(ExperimentalGetImage::class)
  private fun analyze(image: ImageProxy) {
    val media = image.image
    if (media == null || released || !active) {
      image.close()
      return
    }
    val rotation = image.imageInfo.rotationDegrees
    val wantsCapture = synchronized(captureLock) { pendingCaptures.isNotEmpty() }
    val now = SystemClock.elapsedRealtime()
    if (!wantsCapture && now - lastEmit < EMIT_INTERVAL_MS) {
      image.close()
      return
    }
    try {
      detector.process(InputImage.fromMediaImage(media, rotation))
        .addOnSuccessListener(analysisExecutor) { faces ->
          if (released || !active) return@addOnSuccessListener
          if (wantsCapture) deliverCapture(image, rotation)
          if (now - lastEmit >= EMIT_INTERVAL_MS) {
            lastEmit = now
            // Copy before ImageProxy.close(), then encode only the requested
            // frame. Four frames at most; no JPEG work on every update.
            val expired = frames.filterValues { now - it.at > FRAME_LIFETIME_MS }.keys.toList()
            expired.forEach { frames.remove(it)?.bitmap?.recycle() }
            var capturedId: Int? = null
            try {
              frameId += 1
              frames[frameId] = Snapshot(now, image.toBitmap(), rotation)
              capturedId = frameId
              while (frames.size > 4) frames.remove(frames.keys.first())?.bitmap?.recycle()
            } catch (_: Exception) {
              // Still provide framing guidance if the copy was unavailable.
            }
            emit(faces, image.width, image.height, rotation, capturedId)
          }
        }
        .addOnFailureListener(analysisExecutor) { if (wantsCapture) deliverCapture(image, rotation) }
        .addOnCompleteListener(analysisExecutor) { image.close() }
    } catch (_: Exception) {
      image.close()
    }
  }

  private fun emit(faces: List<Face>, width: Int, height: Int, rotation: Int, capturedId: Int?) {
    val upright = rotation == 90 || rotation == 270
    val frameWidth = (if (upright) height else width).toFloat()
    val frameHeight = (if (upright) width else height).toFloat()
    val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
    val payload = mutableMapOf<String, Any>("faces" to faces.size)
    if (capturedId != null) payload["frameId"] = capturedId
    if (face != null) {
      val box = face.boundingBox
      payload["yaw"] = face.headEulerAngleY.toDouble()
      payload["pitch"] = face.headEulerAngleX.toDouble()
      payload["roll"] = face.headEulerAngleZ.toDouble()
      payload["leftEyeOpen"] = (face.leftEyeOpenProbability ?: -1f).toDouble()
      payload["rightEyeOpen"] = (face.rightEyeOpenProbability ?: -1f).toDouble()
      // The front preview is mirrored; report positions as the person sees them.
      payload["centerX"] = (1f - box.exactCenterX() / frameWidth).toDouble()
      payload["centerY"] = (box.exactCenterY() / frameHeight).toDouble()
      payload["size"] = (box.width() / frameWidth).toDouble()
    }
    mainHandler.post { if (!released && active) onFaceUpdate(payload) }
  }

  private fun deliverCapture(image: ImageProxy, rotation: Int) {
    val waiting = synchronized(captureLock) { pendingCaptures.toList().also { pendingCaptures.clear() } }
    if (waiting.isEmpty()) return
    var source: Bitmap? = null
    try {
      source = image.toBitmap()
      val result = encode(source, rotation)
      waiting.forEach { it.resolve(result) }
    } catch (_: Exception) {
      waiting.forEach { it.reject("CAPTURE_FAILED", "Frame unavailable", null) }
    } finally {
      source?.recycle()
    }
  }

  private fun encode(source: Bitmap, rotation: Int): Map<String, Any> {
    val scale = min(1f, MAX_EDGE / max(source.width, source.height).toFloat())
    val matrix = Matrix().apply {
      postRotate(rotation.toFloat())
      postScale(scale, scale)
    }
    val upright = Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    try {
      val bytes = ByteArrayOutputStream().use { stream ->
        check(upright.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream))
        stream.toByteArray()
      }
      return mapOf("base64" to Base64.encodeToString(bytes, Base64.NO_WRAP), "width" to upright.width, "height" to upright.height)
    } finally {
      if (upright !== source) upright.recycle()
    }
  }

  companion object {
    private const val EMIT_INTERVAL_MS = 80L
    private const val CAPTURE_TIMEOUT_MS = 2500L
    private const val FRAME_LIFETIME_MS = 500L
    private const val MAX_EDGE = 720f
    private const val JPEG_QUALITY = 82
  }
}
