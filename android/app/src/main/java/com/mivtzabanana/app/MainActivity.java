package com.mivtzabanana.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/** Full-screen WebView that runs the מבצע בננה website. */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 41;
    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;
    private String home;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#FFD52E"));
        w.setNavigationBarColor(Color.parseColor("#16121F"));

        home = BuildConfig.SITE_URL;
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#FFD52E"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " MivtzaBananaApp/1");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        final String host = Uri.parse(home).getHost();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (host != null && host.equals(u.getHost())) return false; // stay inside the app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* no handler */ }
                return true;
            }
            @Override
            public void onReceivedError(WebView v, int code, String desc, String url) {
                Toast.makeText(MainActivity.this, "אין חיבור לאינטרנט", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                } catch (Exception e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });

        Uri data = getIntent() != null ? getIntent().getData() : null;
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(data != null && host != null && host.equals(data.getHost()) ? data.toString() : home);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQUEST && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            pendingFiles = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
