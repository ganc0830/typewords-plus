package cc.typewords.offline;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.content.SharedPreferences;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

/** 固定本地 HTTPS 来源保存离线学习数据，只向配对电脑发送明确的同步请求。 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
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
        web.addJavascriptInterface(new Bridge(), "TypeWordsAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return response("text/plain", new byte[0]);
                String path = uri.getPath();
                if (path == null || path.contains("..")) return response("text/plain", new byte[0]);
                try {
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
        setContentView(web);
        web.loadUrl("https://" + HOST + "/words");
    }

    /** 包装本地或缓存响应，保留应用固定来源。 */
    private WebResourceResponse response(String mime, byte[] bytes) {
        return new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(bytes));
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

    public class Bridge {
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
                    try { result.put("error", "电脑服务器离线或连接失败，请检查电脑地址与配对码。"); } catch (Exception ignored) { }
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
                EditText address = new EditText(MainActivity.this); address.setHint("电脑地址，例如 http://192.168.1.10:5567"); address.setText(settings.getString("server", ""));
                EditText token = new EditText(MainActivity.this); token.setHint("电脑页面显示的配对码"); token.setText(settings.getString("token", ""));
                box.addView(address); box.addView(token);
                new AlertDialog.Builder(MainActivity.this).setTitle("连接电脑").setView(box).setNegativeButton("取消", null).setPositiveButton("保存", (dialog, which) -> {
                    String server = address.getText().toString().trim().replaceAll("/+$", "");
                    Uri uri = Uri.parse(server);
                    if (("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost() != null && uri.getQuery() == null && uri.getFragment() == null && (uri.getPath() == null || uri.getPath().isEmpty())) {
                        settings.edit().putString("server", server).putString("token", token.getText().toString().trim()).apply();
                    }
                }).show();
            });
        }
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { worker.shutdownNow(); web.destroy(); super.onDestroy(); }
}
