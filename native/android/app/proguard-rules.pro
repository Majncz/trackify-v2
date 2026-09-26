# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class co.bitterlemon.trackify.**$$serializer { *; }
-keepclassmembers class co.bitterlemon.trackify.** { *** Companion; }
-keepclasseswithmembers class co.bitterlemon.trackify.** { kotlinx.serialization.KSerializer serializer(...); }

# socket.io / engine.io / okhttp
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
