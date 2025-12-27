# SETKI.PRO KEEPER ProGuard Rules

# Keep Tauri classes
-keep class app.tauri.** { *; }
-keepclassmembers class app.tauri.** { *; }

# Keep WebView related classes
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void *(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
    public boolean *(android.webkit.WebView, java.lang.String);
}

# Keep JavaScript interface
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# SQLite
-keep class org.sqlite.** { *; }
-keep class org.sqlite.database.** { *; }
