# 保留WebView相关类
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 保留JavaScript接口
-keep class com.booksource.generator.MainActivity$WebAppInterface {
    *;
}

# 保留WebView
-keep class android.webkit.** { *; }

# 保留所有公共方法
-keepclassmembers class * {
    public *;
}
