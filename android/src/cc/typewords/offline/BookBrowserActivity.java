package cc.typewords.offline;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** 在独立 WebView 浏览外部书站，不暴露 TypeWords 的本地数据和原生桥接。 */
public class BookBrowserActivity extends Activity {
    public static final String EXTRA_URL = "url";
    private static final int DOWNLOAD_PERMISSION_REQUEST = 1;
    private static final String[] FILE_TYPES = {
            "pdf:application/pdf", "epub:application/epub+zip", "doc:application/msword",
            "docx:application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls:application/vnd.ms-excel", "xlsm:application/vnd.ms-excel.sheet.macroenabled.12",
            "ods:application/vnd.oasis.opendocument.spreadsheet", "csv:text/csv", "tsv:text/tab-separated-values"
    };

    private final Set<Long> activeDownloads = new HashSet<>();
    private WebView browser;
    private TextView address;
    private Button back;
    private DownloadManager downloads;
    private AlertDialog downloadPrompt;
    private Runnable pendingDownload;

    private final BroadcastReceiver downloadFinished = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (activeDownloads.contains(id)) showDownloadResult(id);
        }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        String url = getIntent().getStringExtra(EXTRA_URL);
        if (!isHttpsUrl(url)) {
            showMessage("Enter a valid HTTPS book website.");
            finish();
            return;
        }

        downloads = getSystemService(DownloadManager.class);
        if (downloads != null) {
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            // 下载由系统组件完成。接收后按本页面创建的 ID 查询真实状态。
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadFinished, filter, Context.RECEIVER_EXPORTED);
            else registerReceiver(downloadFinished, filter);
        }
        browser = new WebView(this);
        installContent();
        configureBrowser();
        if (saved == null || browser.restoreState(saved) == null) browser.loadUrl(url);
    }

    /** 只允许含有效主机且不带 URL 凭据的 HTTPS 地址，并隔离本地应用域名。 */
    static boolean isHttpsUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && host != null && uri.getRawUserInfo() == null
                    && !"appassets.androidplatform.net".equalsIgnoreCase(host.replaceAll("\\.+$", ""));
        } catch (URISyntaxException invalid) {
            return false;
        }
    }

    /** 构建原生工具栏，并为摄像头、系统栏和键盘保留空间。 */
    private void installContent() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int surface = dark ? 0xff101012 : 0xfff5f5f7;
        int text = dark ? 0xfff5f5f7 : 0xff1d1d1f;
        int accent = dark ? 0xff80bdff : 0xff0066cc;
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setBackgroundColor(surface);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        back = new Button(this, null, android.R.attr.borderlessButtonStyle);
        back.setText("Back");
        back.setTextColor(accent);
        back.setEnabled(false);
        back.setOnClickListener(view -> browser.goBack());
        toolbar.addView(back);

        address = new TextView(this);
        address.setSingleLine(true);
        address.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        address.setGravity(Gravity.CENTER);
        address.setTextColor(text);
        address.setText("Book browser");
        toolbar.addView(address, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        Button close = new Button(this, null, android.R.attr.borderlessButtonStyle);
        close.setText("Close");
        close.setTextColor(accent);
        close.setOnClickListener(view -> finish());
        toolbar.addView(close);
        content.addView(toolbar);
        content.addView(browser, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            if (Build.VERSION.SDK_INT < 35) {
                getWindow().setStatusBarColor(Color.TRANSPARENT);
                getWindow().setNavigationBarColor(Color.TRANSPARENT);
            }
            content.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets gestures = insets.getInsets(WindowInsets.Type.mandatorySystemGestures());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, Math.max(Math.max(safe.bottom, gestures.bottom), keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(content);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (controller != null) controller.setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
            content.requestApplyInsets();
        }
    }

    /** 配置仅在本页面打开 HTTPS 网站，保留常规站点脚本和会话。 */
    private void configureBrowser() {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isHttpsUrl(request.getUrl().toString())) return false;
                if (request.isForMainFrame()) showMessage("Only HTTPS links can be opened here.");
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("http".equalsIgnoreCase(uri.getScheme()) || ("https".equalsIgnoreCase(uri.getScheme()) && !isHttpsUrl(uri.toString()))) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!isHttpsUrl(url)) {
                    view.stopLoading();
                    return;
                }
                address.setText(Uri.parse(url).getHost());
                back.setEnabled(view.canGoBack());
            }

            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                back.setEnabled(view.canGoBack());
            }
        });
        browser.setDownloadListener((url, userAgent, disposition, mimeType, length) -> promptDownload(url, userAgent, disposition, mimeType));
    }

    /** 根据站点响应推断导入器支持的文件名。由用户明确确认后才开始下载。 */
    private void promptDownload(String url, String userAgent, String disposition, String mimeType) {
        if (!isHttpsUrl(url)) {
            showMessage("This download needs a direct HTTPS file link. In-page downloads cannot be saved here.");
            return;
        }
        if (downloads == null) {
            showMessage("Android Downloads is unavailable on this device.");
            return;
        }
        if (downloadPrompt != null && downloadPrompt.isShowing()) return;

        String name = URLUtil.guessFileName(url, disposition, mimeType);
        int dot = name.lastIndexOf('.');
        String extension = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        String mime = mimeType == null ? "" : mimeType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        String[] fileType = null;
        for (String candidate : FILE_TYPES) {
            String[] pair = candidate.split(":", 2);
            if (pair[0].equals(extension)) {
                fileType = pair;
                break;
            }
            if (pair[1].equals(mime)) fileType = pair;
        }
        if (fileType == null || "text/html".equals(mime)) {
            showMessage("Choose a supported book, Word document, or spreadsheet to download.");
            return;
        }
        String stem = dot > 0 ? name.substring(0, dot) : name;
        stem = stem.replaceAll("[\\p{Cntrl}\\p{Cf}/\\\\:*?\"<>|]", "_").replaceAll("^\\.+|[. ]+$", "").trim();
        if (stem.isEmpty()) stem = "book";
        // UTF-8 最长 4 字节，保留系统处理重复文件名时需要的余量。
        int limit = Math.min(56, stem.codePointCount(0, stem.length()));
        String filename = stem.substring(0, stem.offsetByCodePoints(0, limit)) + "." + fileType[0];
        String downloadMime = fileType[1];
        downloadPrompt = new AlertDialog.Builder(this)
                .setTitle("Download file")
                .setMessage(filename + "\n\nThe file will be saved to Downloads.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Download", (dialog, which) -> prepareDownload(url, userAgent, filename, downloadMime))
                .show();
    }

    /** 系统下载器使用当前网站的会话，并兼容仍需要存储权限的旧 Android。 */
    private void prepareDownload(String url, String userAgent, String filename, String mime) {
        Runnable startDownload = () -> enqueueDownload(url, userAgent, filename, mime);
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = startDownload;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, DOWNLOAD_PERMISSION_REQUEST);
            return;
        }
        startDownload.run();
    }

    /** 将已确认的请求写入系统下载队列。 */
    private void enqueueDownload(String url, String userAgent, String filename, String mime) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(filename)
                    .setMimeType(mime)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (!TextUtils.isEmpty(cookies)) request.addRequestHeader("Cookie", cookies);
            if (!TextUtils.isEmpty(userAgent)) request.addRequestHeader("User-Agent", userAgent);
            long id = downloads.enqueue(request);
            if (id < 0) {
                showMessage("Android could not start the download.");
                return;
            }
            activeDownloads.add(id);
            showMessage("Download started. Check Android Downloads for progress.");
        } catch (RuntimeException unavailable) {
            showMessage("Could not start the download. Check storage access and available space.");
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != DOWNLOAD_PERMISSION_REQUEST || pendingDownload == null) return;
        Runnable startDownload = pendingDownload;
        pendingDownload = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startDownload.run();
        else showMessage("Storage access is required to save to Downloads on this Android version.");
    }

    /** 查询系统记录，仅在下载真正结束时显示结果。 */
    private void showDownloadResult(long id) {
        try (Cursor result = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (result == null || !result.moveToFirst()) return;
            int status = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                activeDownloads.remove(id);
                showMessage("Saved to Downloads.");
            } else if (status == DownloadManager.STATUS_FAILED) {
                activeDownloads.remove(id);
                int reason = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) showMessage("Download failed. There is not enough storage space.");
                else if (reason == DownloadManager.ERROR_FILE_ALREADY_EXISTS) showMessage("Download failed. A file with this name already exists in Downloads.");
                else if (reason >= 400 && reason <= 599) showMessage("Download failed. The website returned HTTP " + reason + ".");
                else showMessage("Download failed. Check the link and your connection, then try again.");
            }
        } catch (RuntimeException unavailable) {
            showMessage("Could not check download status. Open Android Downloads to see the result.");
        }
    }

    /** 将浏览或下载状态交给系统提示。 */
    private void showMessage(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (browser != null) browser.saveState(state);
    }

    @Override public void onBackPressed() {
        if (browser != null && browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (downloads != null) unregisterReceiver(downloadFinished);
        if (downloadPrompt != null) downloadPrompt.dismiss();
        if (browser != null) {
            browser.stopLoading();
            browser.destroy();
        }
        super.onDestroy();
    }
}
