package cc.typewords.offline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.*;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.content.SharedPreferences;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

/** 固定本地 HTTPS 来源保存离线学习数据，只向配对电脑发送明确的同步请求。 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String SYNC_STATE_URL = "/api/android/sync-state";
    private static final long MAX_SYNC_BYTES = 128L * 1024 * 1024;
    private static final int PICK_BOOK = 2405;
    private String pendingBookRequest;
    private WebView web;
    private FrameLayout content;
    private SharedPreferences settings;
    private final ExecutorService worker = Executors.newFixedThreadPool(2);

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        settings = getSharedPreferences("connection", MODE_PRIVATE);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        Bridge bridge = new Bridge();
        web.addJavascriptInterface(bridge, "TypeWordsAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return response("text/plain", new byte[0]);
                String path = uri.getPath();
                if (path == null || path.contains("..")) return response("text/plain", new byte[0]);
                if (SYNC_STATE_URL.equals(path)) {
                    if (!"https".equals(uri.getScheme()) || (uri.getPort() != -1 && uri.getPort() != 443)
                            || uri.getUserInfo() != null || !SYNC_STATE_URL.equals(uri.getEncodedPath())
                            || uri.getEncodedQuery() != null || uri.getEncodedFragment() != null
                            || request.isForMainFrame() || !"GET".equals(request.getMethod())) {
                        return syncError(403, "This sync request is not allowed.");
                    }
                    return syncState();
                }
                try {
                    if (path.startsWith("/api/android/import-result/")) {
                        return bookImportResult(path.substring("/api/android/import-result/".length()));
                    }
                    if (path.equals("/api/voice") || path.equals("/api/word-details")) {
                        String query = path + (uri.getEncodedQuery() == null ? "" : "?" + uri.getEncodedQuery());
                        return proxy(query, path.equals("/api/voice"));
                    }
                    String asset = "public" + (path.equals("/") ? "/index.html" : path);
                    String mime = URLConnection.guessContentTypeFromName(path);
                    if (path.endsWith(".js")) mime = "application/javascript";
                    if (path.endsWith(".css")) mime = "text/css";
                    if (path.endsWith(".json")) mime = "application/json";
                    InputStream input;
                    try { input = getAssets().open(asset); }
                    catch (IOException missing) {
                        if (path.substring(path.lastIndexOf('/') + 1).contains(".")) return response("text/plain", new byte[0]);
                        input = getAssets().open("public/index.html"); mime = "text/html";
                    }
                    return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", input);
                } catch (Exception error) { return response("text/plain", new byte[0]); }
            }
        });
        installContent();
        web.loadUrl("https://" + HOST + "/words");
        bridge.findUpdate(false);
    }

    /** 将 WebView 实际测量在摄像头、系统栏及输入法之外，网页固定底栏也在该空间内。 */
    private void installContent() {
        content = new FrameLayout(this);
        content.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            if (Build.VERSION.SDK_INT < 35) {
                getWindow().setStatusBarColor(Color.TRANSPARENT);
                getWindow().setNavigationBarColor(Color.TRANSPARENT);
            }
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets gestures = insets.getInsets(WindowInsets.Type.mandatorySystemGestures());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                int bottom = Math.max(Math.max(bars.bottom, gestures.bottom), keyboard.bottom);
                view.setPadding(bars.left, bars.top, bars.right, bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(content);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        applySystemBarsTheme(dark);
        content.requestApplyInsets();
    }

    /** 使用当前网页明暗主题设置安全区底色和系统图标对比度。 */
    private void applySystemBarsTheme(boolean dark) {
        content.setBackgroundColor(dark ? 0xff101012 : 0xfff5f5f7);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (controller != null) controller.setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
        }
    }

    /** 包装本地或缓存响应，保留应用固定来源。 */
    private WebResourceResponse response(String mime, byte[] bytes) {
        return new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(bytes));
    }

    /** 配对下载资料到限量临时文件，再交给 WebView 读取，避免将大包拼成 JavaScript。 */
    private WebResourceResponse syncState() {
        HttpURLConnection connection = null;
        File cached = null;
        try {
            connection = open("/api/mobile/state");
            connection.setReadTimeout(120_000);
            int status = connection.getResponseCode();
            if (status < 200 || (status >= 300 && status < 400) || status >= 600) {
                return syncError(502, "The computer returned an unexpected sync response.");
            }
            if (connection.getContentLengthLong() > MAX_SYNC_BYTES) {
                return syncError(413, "The computer returned more than 128 MB of sync data.");
            }
            cached = File.createTempFile("sync-state-", ".json", getCacheDir());
            InputStream body = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            if (!copyLimited(body, cached, MAX_SYNC_BYTES)) {
                return syncError(status >= 400 ? status : 502, "The computer returned empty or oversized sync data.");
            }
            return syncResponse(status, new FileInputStream(cached));
        } catch (Exception failure) {
            return syncError(503, "Could not download the library. Check your computer connection and available storage.");
        } finally {
            if (connection != null) connection.disconnect();
            // Android 保留已打开的文件描述符供 WebView 读取，无需在缓存中留下学习数据。
            if (cached != null) cached.delete();
        }
    }

    /** 同步响应始终为 JSON，保持原有状态码并禁止 WebView 缓存。 */
    private WebResourceResponse syncResponse(int status, InputStream body) {
        return new WebResourceResponse("application/json", "UTF-8", status, status < 400 ? "OK" : "Unavailable",
                Collections.singletonMap("Cache-Control", "no-store"), body);
    }

    /** 原生读取失败时返回与电脑服务同形状的错误。 */
    private WebResourceResponse syncError(int status, String message) {
        String json = "{\"error\":" + JSONObject.quote(message) + "}";
        return syncResponse(status, new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }

    /** 语音按完整请求缓存，离线时使用上次已下载的同一音色。 */
    private WebResourceResponse proxy(String path, boolean audio) throws Exception {
        String digest = android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(path.getBytes(StandardCharsets.UTF_8)), android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE);
        File cache = new File(getFilesDir(), "voice-" + digest);
        if (audio && cache.isFile()) return new WebResourceResponse("audio/wav", null, new FileInputStream(cache));
        HttpURLConnection connection = open(path);
        try {
            int code = connection.getResponseCode();
            byte[] bytes = read(code < 400 ? connection.getInputStream() : connection.getErrorStream());
            if (audio && code == 200 && bytes.length > 44) {
                File temp = new File(cache.getPath() + ".tmp-" + Thread.currentThread().getId());
                try (FileOutputStream output = new FileOutputStream(temp)) { output.write(bytes); }
                temp.renameTo(cache);
            }
            WebResourceResponse result = response(audio ? "audio/wav" : "application/json", bytes);
            result.setStatusCodeAndReasonPhrase(code, code < 400 ? "OK" : "Unavailable");
            return result;
        } finally { connection.disconnect(); }
    }

    /** 只请求用户配置的电脑地址，连接与读取都设置超时。 */
    private HttpURLConnection open(String path) throws Exception {
        URL url = new URL(settings.getString("server", "") + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(5000);
        // 电脑首次启动语音模型可能需要较长时间，同步和查词仍使用原有超时。
        connection.setReadTimeout(path.startsWith("/api/voice?") ? 160000 : 25000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("X-TypeWords-Pairing", settings.getString("token", ""));
        return connection;
    }

    /** 完整读取响应，限制单次大小以避免意外耗尽设备内存。 */
    private byte[] read(InputStream input) throws IOException {
        if (input == null) return new byte[0];
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384]; int count;
            while ((count = source.read(buffer)) != -1) {
                if (output.size() + count > 128 * 1024 * 1024) return new byte[0];
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    /** 根据系统文件选择器的文件名取得电脑解析器要求的 MIME 类型。 */
    private String bookMime(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "pdf": return "application/pdf";
            case "epub": return "application/epub+zip";
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "xls": return "application/vnd.ms-excel";
            case "xlsm": return "application/vnd.ms-excel.sheet.macroenabled.12";
            case "ods": return "application/vnd.oasis.opendocument.spreadsheet";
            case "csv": return "text/csv";
            case "tsv": return "text/tab-separated-values";
            default: return "";
        }
    }

    /** 安全地在应用缓存中识别本次解析结果，允许网页读取一次。 */
    private File resultFile(String id) {
        if (id == null || !id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) return null;
        return new File(getCacheDir(), "book-result-" + id + ".json");
    }

    /** 从固定来源提供解析结果，避免在 JavaScript 桥上复制大段书籍正文。 */
    private WebResourceResponse bookImportResult(String id) throws IOException {
        File file = resultFile(id);
        if (file == null || !file.isFile()) {
            return response("application/json", "{\"error\":\"Import result is unavailable. Try again.\"}".getBytes(StandardCharsets.UTF_8));
        }
        FileInputStream result = new FileInputStream(file);
        file.delete();
        return new WebResourceResponse("application/json", "UTF-8", result);
    }

    /** 流式写入应用缓存，达到输入或结果上限后停止。 */
    private boolean copyLimited(InputStream input, File target, long limit) throws IOException {
        if (input == null) return false;
        try (InputStream source = input; FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[16384];
            int count;
            long size = 0;
            while ((count = source.read(buffer)) != -1) {
                size += count;
                if (size > limit) return false;
                output.write(buffer, 0, count);
            }
            return size > 0;
        }
    }

    /** 通知当前 TypeWords 页面文件选择或解析的结果。 */
    private void sendBookResult(String id, String key, String value, String filename) {
        try {
            JSONObject data = new JSONObject().put(key, value);
            if (filename != null) data.put("filename", filename);
            JSONObject event = new JSONObject().put("id", id).put("data", data);
            runOnUiThread(() -> {
                if (!isDestroyed()) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('typewords-native',{detail:" + event + "}))", null);
            });
        } catch (Exception ignored) { }
    }

    /** 把用户选择的文件发送给已配对的电脑，结果留在本应用的临时目录。 */
    private void importBook(String id, Uri uri) {
        File input = null;
        File result = resultFile(id);
        boolean ready = false;
        try {
            String name = "";
            try (Cursor cursor = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            }
            if (name == null || result == null || bookMime(name).isEmpty()) {
                sendBookResult(id, "error", "Choose a supported book, document, or spreadsheet.", null);
                return;
            }
            input = File.createTempFile("book-input-", ".tmp", getCacheDir());
            if (!copyLimited(getContentResolver().openInputStream(uri), input, 64L * 1024 * 1024)) {
                sendBookResult(id, "error", "The file is empty or larger than 64 MB.", null);
                return;
            }
            HttpURLConnection connection = open("/api/local-book/import");
            try {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setReadTimeout(195000);
                connection.setFixedLengthStreamingMode(input.length());
                connection.setRequestProperty("Content-Type", bookMime(name));
                try (InputStream source = new FileInputStream(input); OutputStream output = connection.getOutputStream()) {
                    byte[] buffer = new byte[16384];
                    int count;
                    while ((count = source.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                int code = connection.getResponseCode();
                ready = copyLimited(code < 400 ? connection.getInputStream() : connection.getErrorStream(), result, 32L * 1024 * 1024);
                if (ready) sendBookResult(id, "result", "/api/android/import-result/" + id, name);
                else sendBookResult(id, "error", "The computer returned no usable import result.", null);
            } finally { connection.disconnect(); }
        } catch (Exception failure) {
            sendBookResult(id, "error", "Import failed. Check that the paired computer is online and try again.", null);
        } finally {
            if (input != null) input.delete();
            if (!ready && result != null) result.delete();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_BOOK || pendingBookRequest == null) return;
        String id = pendingBookRequest;
        pendingBookRequest = null;
        Uri uri = data == null ? null : data.getData();
        if (resultCode != RESULT_OK || uri == null) {
            sendBookResult(id, "cancelled", "true", null);
            return;
        }
        worker.execute(() -> importBook(id, uri));
    }

    public class Bridge {
        /** 返回固定的应用内下载路径，不通过 JavaScript 暴露电脑地址或配对码。 */
        @JavascriptInterface public String stateUrl() {
            return SYNC_STATE_URL;
        }

        /** 使用独立 Activity 打开外部 HTTPS 页面。 */
        @JavascriptInterface public void openBookBrowser(String url) {
            Uri address = Uri.parse(url);
            if (!"https".equals(address.getScheme()) || address.getHost() == null || address.getUserInfo() != null) return;
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, BookBrowserActivity.class).putExtra("url", address.toString())));
        }

        /** 打开系统文件选择器，从下载目录选书并交给电脑解析。 */
        @JavascriptInterface public void pickBook(String id) {
            if (resultFile(id) == null) return;
            runOnUiThread(() -> {
                if (settings.getString("server", "").isEmpty() || settings.getString("token", "").isEmpty()) {
                    sendBookResult(id, "error", "Connect and pair with your computer before importing a book.", null);
                    return;
                }
                if (pendingBookRequest != null) {
                    sendBookResult(id, "error", "A file picker is already open.", null);
                    return;
                }
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                pendingBookRequest = id;
                try { startActivityForResult(picker, PICK_BOOK); }
                catch (Exception unavailable) {
                    pendingBookRequest = null;
                    sendBookResult(id, "error", "The Android file picker is unavailable.", null);
                }
            });
        }

        /** 网页切换明暗主题时，同步原生安全区配色。 */
        @JavascriptInterface public void setSystemBarsDark(boolean dark) {
            runOnUiThread(() -> applySystemBarsTheme(dark));
        }

        /** 查询电脑发布版本，经用户确认后交给浏览器下载，安装时由系统校验签名。 */
        @JavascriptInterface public void checkUpdate() {
            findUpdate(true);
        }

        /** 启动时只提示可用的新版本，手动检查也会报告连接及当前版本。 */
        private void findUpdate(boolean manual) {
            String server = settings.getString("server", "");
            if (server.isEmpty()) {
                if (manual) runOnUiThread(() -> showUpdateMessage("Connect to your computer from Device sync first."));
                return;
            }
            worker.execute(() -> {
                try {
                    HttpURLConnection connection = open("/api/mobile/update");
                    JSONObject release;
                    try {
                        int status = connection.getResponseCode();
                        release = new JSONObject(new String(read(status < 400 ? connection.getInputStream() : connection.getErrorStream()), StandardCharsets.UTF_8));
                    } finally { connection.disconnect(); }
                    String error = release.optString("error");
                    if (!error.isEmpty()) { if (manual) runOnUiThread(() -> showUpdateMessage(error)); return; }
                    int installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                    int latest = release.getInt("versionCode");
                    String version = release.getString("versionName");
                    if (latest <= installed) { if (manual) runOnUiThread(() -> showUpdateMessage("TypeWords is up to date.")); return; }
                    runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                            .setTitle("Version " + version + " is available")
                            .setMessage("Open the downloaded APK and follow the Android prompts to install the update.")
                            .setNegativeButton("Later", null)
                            .setPositiveButton("Download update", (dialog, which) -> {
                                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(server + "/api/mobile/update.apk"))); }
                                catch (Exception unavailable) { showUpdateMessage("Could not open a browser. Check your default browser settings."); }
                            }).show());
                } catch (Exception unavailable) {
                    if (manual) runOnUiThread(() -> showUpdateMessage("Could not reach the update server. Make sure your phone and computer are on the same local network."));
                }
            });
        }

        /** id 为异步请求标识，action 仅允许健康检查或状态同步。 */
        @JavascriptInterface public void request(String id, String action, String body) {
            if (!action.equals("health") && !action.equals("state")) return;
            worker.execute(() -> {
                JSONObject result = new JSONObject();
                try {
                    HttpURLConnection connection = open("/api/mobile/" + action);
                    try {
                        if (!body.isEmpty()) {
                            connection.setRequestMethod("POST"); connection.setDoOutput(true);
                            connection.setRequestProperty("Content-Type", "application/json");
                            try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
                        }
                        int status = connection.getResponseCode();
                        result = new JSONObject(new String(read(status < 400 ? connection.getInputStream() : connection.getErrorStream()), StandardCharsets.UTF_8));
                    } finally { connection.disconnect(); }
                } catch (Exception error) {
                    try { result.put("error", "Could not reach your computer. Check its address and pairing code."); } catch (Exception ignored) { }
                }
                try {
                    JSONObject event = new JSONObject(); event.put("id", id); event.put("data", result);
                    String script = "window.dispatchEvent(new CustomEvent('typewords-native',{detail:" + event + "}))";
                    runOnUiThread(() -> web.evaluateJavascript(script, null));
                } catch (Exception ignored) { }
            });
        }

        /** 用户在手机输入电脑地址与配对码，保存在应用私有配置。 */
        @JavascriptInterface public void configure() {
            runOnUiThread(() -> {
                LinearLayout box = new LinearLayout(MainActivity.this); box.setOrientation(LinearLayout.VERTICAL);
                EditText address = new EditText(MainActivity.this); address.setHint("Computer address, e.g. http://192.168.1.10:5567"); address.setText(settings.getString("server", ""));
                EditText token = new EditText(MainActivity.this); token.setHint("Pairing code from the computer"); token.setText(settings.getString("token", ""));
                box.addView(address); box.addView(token);
                new AlertDialog.Builder(MainActivity.this).setTitle("Connect to computer").setView(box).setNegativeButton("Cancel", null).setPositiveButton("Save", (dialog, which) -> {
                    String server = address.getText().toString().trim().replaceAll("/+$", "");
                    Uri uri = Uri.parse(server);
                    if (("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost() != null && uri.getQuery() == null && uri.getFragment() == null && (uri.getPath() == null || uri.getPath().isEmpty())) {
                        settings.edit().putString("server", server).putString("token", token.getText().toString().trim()).apply();
                    }
                }).show();
            });
        }
    }

    /** 在主线程显示更新结果。 */
    private void showUpdateMessage(String message) {
        new AlertDialog.Builder(this).setTitle("Check for updates").setMessage(message).setPositiveButton("OK", null).show();
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { worker.shutdownNow(); web.destroy(); super.onDestroy(); }
}
