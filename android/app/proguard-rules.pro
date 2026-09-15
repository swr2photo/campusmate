# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in proguard-android-optimize.txt.

# ----------------------------------------------------
# React Native & TurboModules
# ----------------------------------------------------
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.fbreact.specs.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keepclassmembers class * {
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
}
-keepclassmembers class * {
    @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }

# ----------------------------------------------------
# React Native Reanimated
# ----------------------------------------------------
-keep class com.swmansion.reanimated.** { *; }
-keepclassmembers class * {
    @com.swmansion.reanimated.** <methods>;
}
-dontwarn com.swmansion.reanimated.**

# ----------------------------------------------------
# Expo Modules
# ----------------------------------------------------
-keep class expo.modules.** { *; }
-keep class * extends expo.modules.kotlin.modules.Module { *; }
-keepclassmembers class * {
    @expo.modules.kotlin.** <methods>;
}

# ----------------------------------------------------
# React Native Community packages
# ----------------------------------------------------
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-keep class com.reactnativecommunity.netinfo.** { *; }
-keep class com.reactnativecommunity.picker.** { *; }
-keep class org.reactnative.maskedview.** { *; }

# ----------------------------------------------------
# Google Sign-In & Google Play Services
# ----------------------------------------------------
-keep class com.reactnativegooglesignin.** { *; }
-keep class com.google.android.gms.auth.api.signin.** { *; }
-dontwarn com.reactnativegooglesignin.**
-dontwarn com.google.android.gms.**

# ----------------------------------------------------
# Networking / OkHttp / Okio / Conscrypt warnings
# ----------------------------------------------------
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn com.google.errorprone.annotations.**
