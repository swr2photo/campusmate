package expo.modules.faceliveness

import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// Bridge to the AWS-maintained Compose liveness detector. JS only learns that
// the stream finished or receives a safe error code; the server decides.
//
// SPIKE STATUS: not yet compiled. Verify against Expo 58 before enabling.
//
// The server's session preferences choose the challenge (movement + light, or
// movement only for photosensitive people); default options use the front
// camera. Confirm the pinned Amplify UI version supports FaceMovementChallenge.

class PresentOptions : Record {
  @Field val sessionId: String = ""
  @Field val region: String = ""
  @Field val credentials: Map<String, String> = emptyMap()
}

/** In-memory hand-off to the activity. Never placed in an Intent or on disk. */
internal object LivenessRequest {
  @Volatile var current: Pending? = null

  class Pending(
    val sessionId: String,
    val region: String,
    val accessKeyId: String,
    val secretAccessKey: String,
    val sessionToken: String,
    val expirationEpochSeconds: Long,
    val promise: Promise,
  )

  @Synchronized fun finish(code: String?) {
    val pending = current ?: return
    current = null
    if (code == null) pending.promise.resolve(mapOf("streamCompleted" to true))
    else pending.promise.reject(code, "Liveness check ended", null)
  }
}

class FaceLivenessModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FaceLiveness")

    AsyncFunction("present") { options: PresentOptions, promise: Promise ->
      val activity = appContext.currentActivity
      val expiration = options.credentials["expiration"]
        ?.let { runCatching { java.time.Instant.parse(it).epochSecond }.getOrNull() }
      val accessKeyId = options.credentials["accessKeyId"]
      val secretAccessKey = options.credentials["secretAccessKey"]
      val sessionToken = options.credentials["sessionToken"]
      if (activity == null || !options.sessionId.matches(Regex("[A-Za-z0-9_-]{20,128}")) || options.region != "ap-southeast-7" ||
        accessKeyId.isNullOrEmpty() || secretAccessKey.isNullOrEmpty() || sessionToken.isNullOrEmpty() ||
        expiration == null || expiration <= java.time.Instant.now().epochSecond
      ) {
        promise.reject("SERVICE_UNAVAILABLE", "Invalid liveness session", null)
        return@AsyncFunction
      }
      // Reject overlap: an older activity must never finish a newer request.
      activity.runOnUiThread {
        if (LivenessRequest.current != null) {
          promise.reject("SERVICE_UNAVAILABLE", "A liveness check is already open", null)
        } else {
          LivenessRequest.current = LivenessRequest.Pending(
            options.sessionId, options.region, accessKeyId, secretAccessKey, sessionToken, expiration, promise,
          )
          try { activity.startActivity(Intent(activity, LivenessActivity::class.java)) }
          catch (_: Exception) { LivenessRequest.finish("SERVICE_UNAVAILABLE") }
        }
      }
    }
  }
}
