package com.campusmate.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class PipModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName(): String = "PipModule"

    @ReactMethod
    fun enterPip() {
        val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
        activity.runOnUiThread {
            activity.enterPipMode()
        }
    }

    @ReactMethod
    fun setInCall(inCall: Boolean, isVideo: Boolean) {
        val activity = reactApplicationContext.currentActivity as? MainActivity ?: return
        activity.runOnUiThread {
            activity.setCallState(inCall, isVideo)
        }
    }

    companion object {
        private var instance: PipModule? = null

        fun notifyPipChanged(isInPip: Boolean) {
            instance?.let { module ->
                if (module.reactApplicationContext.hasActiveReactInstance()) {
                    module.reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("onPictureInPictureModeChanged", isInPip)
                }
            }
        }
    }
}
