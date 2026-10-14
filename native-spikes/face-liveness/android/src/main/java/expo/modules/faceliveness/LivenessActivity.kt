package expo.modules.faceliveness

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import aws.smithy.kotlin.runtime.time.Instant
import com.amplifyframework.auth.AWSCredentials
import com.amplifyframework.auth.AWSCredentialsProvider
import com.amplifyframework.auth.AWSTemporaryCredentials
import com.amplifyframework.auth.AuthException
import com.amplifyframework.core.Consumer
import com.amplifyframework.ui.liveness.ui.FaceLivenessDetector

// AWS API is pinned in build.gradle. A compile pass still needs device QA.
class LivenessActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Keep the face video out of screenshots, screen recording and recents.
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

    // After process death the in-memory request is gone: never resume it.
    val request = LivenessRequest.current
    if (request == null || savedInstanceState != null) {
      LivenessRequest.finish("SESSION_EXPIRED")
      finish()
      return
    }
    val provider = object : AWSCredentialsProvider<AWSCredentials> {
      override fun fetchAWSCredentials(onSuccess: Consumer<AWSCredentials>, onError: Consumer<AuthException>) {
        if (request.expirationEpochSeconds <= java.time.Instant.now().epochSecond || LivenessRequest.current !== request) {
          onError.accept(AuthException("Session expired", "Start a new liveness session"))
          return
        }
        onSuccess.accept(AWSTemporaryCredentials(
          request.accessKeyId, request.secretAccessKey, request.sessionToken,
          Instant.fromEpochSeconds(request.expirationEpochSeconds),
        ))
      }
    }
    setContent {
      FaceLivenessDetector(
        sessionId = request.sessionId,
        region = request.region,
        credentialsProvider = provider,
        onComplete = {
          LivenessRequest.finish(null)
          finish()
        },
        onError = { error ->
          val name = error::class.simpleName.orEmpty()
          LivenessRequest.finish(
            when {
              name.contains("UserCancelled") -> "CANCELLED"
              name.contains("CameraPermission") -> "CAMERA_UNAVAILABLE"
              name.contains("SessionTimedOut") || name.contains("SessionNotFound") -> "SESSION_EXPIRED"
              else -> "SERVICE_UNAVAILABLE"
            },
          )
          finish()
        },
      )
    }
  }

  override fun onDestroy() {
    // Leaving the screen any other way counts as cancelling.
    if (isFinishing) LivenessRequest.finish("CANCELLED")
    super.onDestroy()
  }
}
