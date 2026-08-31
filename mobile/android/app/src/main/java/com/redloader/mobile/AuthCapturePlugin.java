package com.redloader.mobile;

import android.app.Dialog;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Auth-capture spike: opens a full-screen WebView on the RedGifs sign-in page
 * and captures the user Bearer token. Mirrors desktop/src/main/auth.ts, which
 * sniffs Authorization: Bearer on api.redgifs.com requests with a localStorage
 * JWT scan as a fallback. This plugin tries both paths; whichever produces a
 * user token first resolves login() and closes the window.
 */
@CapacitorPlugin(name = "AuthCapture")
public class AuthCapturePlugin extends Plugin {

  private static final String TAG = "AuthCapture";
  private static final String LOGIN_URL = "https://www.redgifs.com/auth/signin";
  private static final String HOME_URL = "https://www.redgifs.com/";
  private static final long REFRESH_TIMEOUT_MS = 25000;

  private final Handler main = new Handler(Looper.getMainLooper());

  @PluginMethod
  public void login(final PluginCall call) {
    call.setKeepAlive(true);
    main.post(() -> openWebView(call));
  }

  /**
   * Load RedGifs without showing UI. The regular Android WebView cookie/local
   * storage profile is shared with login(), so an active Kinde SSO session can
   * mint a new short-lived bearer token before (or after) the old one expires.
   */
  @PluginMethod
  public void refresh(final PluginCall call) {
    call.setKeepAlive(true);
    final String previousToken = call.getString("previousToken", "");
    main.post(() -> openRefreshWebView(call, previousToken));
  }

  private void openWebView(final PluginCall call) {
    final AtomicBoolean settled = new AtomicBoolean(false);

    final WebView web = new WebView(getActivity());
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setUserAgentString(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
        + "Chrome/126.0 Mobile Safari/537.36");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

    final Dialog dialog = new Dialog(getActivity(),
      android.R.style.Theme_Black_NoTitleBar_Fullscreen);
    dialog.setContentView(web, new ViewGroup.LayoutParams(-1, -1));
    dialog.setOnDismissListener(d -> {
      if (settled.compareAndSet(false, true)) {
        JSObject res = new JSObject();
        res.put("cancelled", true);
        call.resolve(res);
      }
    });

    final TokenSink sink = (token, source) -> {
      if (!settled.compareAndSet(false, true)) return;
      main.post(() -> {
        web.stopLoading();
        CookieManager.getInstance().flush();
        if (dialog.isShowing()) dialog.dismiss();
        JSONObject payload = decodePayload(token);
        JSObject res = new JSObject();
        res.put("token", token);
        res.put("source", source);
        res.put("username", payload != null ? payload.optString("preferred_username", "") : "");
        call.resolve(res);
      });
    };

    web.setWebViewClient(new WebViewClient() {
      // Path 1: sniff the Authorization header on api.redgifs.com requests.
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String host = request.getUrl().getHost();
        if ("api.redgifs.com".equals(host)) {
          Map<String, String> headers = request.getRequestHeaders();
          String auth = headers.get("Authorization");
          if (auth == null) auth = headers.get("authorization");
          Log.d(TAG, "api.redgifs.com request, Authorization present: " + (auth != null));
          if (auth != null && auth.startsWith("Bearer ")) {
            String token = auth.substring(7).trim();
            if (isUserToken(token)) sink.onToken(token, "header");
          }
        }
        return null;
      }

      // Path 2 (fallback): scan localStorage for a user JWT after each load.
      @Override
      public void onPageFinished(WebView view, String url) {
        if (settled.get()) return;
        main.postDelayed(() -> scanLocalStorage(view, sink, settled, ""), 1200);
      }
    });

    dialog.show();
    web.loadUrl(LOGIN_URL);
  }

  private void openRefreshWebView(final PluginCall call, final String previousToken) {
    final AtomicBoolean settled = new AtomicBoolean(false);
    final WebView web = new WebView(getActivity());
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setUserAgentString(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
        + "Chrome/126.0 Mobile Safari/537.36");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

    final Runnable[] timeout = new Runnable[1];
    final TokenSink sink = (token, source) -> {
      if (!settled.compareAndSet(false, true)) return;
      main.post(() -> {
        if (timeout[0] != null) main.removeCallbacks(timeout[0]);
        CookieManager.getInstance().flush();
        web.stopLoading();
        web.destroy();
        JSONObject payload = decodePayload(token);
        JSObject res = new JSObject();
        res.put("token", token);
        res.put("source", source);
        res.put("username", payload != null ? payload.optString("preferred_username", "") : "");
        call.resolve(res);
      });
    };

    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String host = request.getUrl().getHost();
        if ("api.redgifs.com".equals(host)) {
          Map<String, String> headers = request.getRequestHeaders();
          String auth = headers.get("Authorization");
          if (auth == null) auth = headers.get("authorization");
          if (auth != null && auth.startsWith("Bearer ")) {
            String token = auth.substring(7).trim();
            if (isUserToken(token) && !token.equals(previousToken)) sink.onToken(token, "header");
          }
        }
        return null;
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        if (!settled.get()) {
          main.postDelayed(() -> scanLocalStorage(view, sink, settled, previousToken), 1200);
        }
      }
    });

    timeout[0] = () -> {
      if (!settled.compareAndSet(false, true)) return;
      web.stopLoading();
      web.destroy();
      JSObject res = new JSObject();
      res.put("cancelled", true);
      call.resolve(res);
    };
    main.postDelayed(timeout[0], REFRESH_TIMEOUT_MS);
    web.loadUrl(HOME_URL);
  }

  private void scanLocalStorage(
    final WebView web,
    final TokenSink sink,
    final AtomicBoolean settled,
    final String excludedToken
  ) {
    if (settled.get()) return;
    final String js = "(function(){for(var i=0;i<localStorage.length;i++){"
      + "var v=localStorage.getItem(localStorage.key(i));"
      + "if(v&&v.indexOf('eyJ')===0&&v.length>40)return v;}return '';})()";
    web.evaluateJavascript(js, value -> {
      String v = value == null ? "" : value.trim();
      if (v.startsWith("\"") && v.endsWith("\"")) {
        v = v.substring(1, v.length() - 1).replace("\\\"", "\"");
      }
      if (!v.isEmpty() && isUserToken(v) && !v.equals(excludedToken)) {
        sink.onToken(v, "localStorage");
      } else if (!settled.get()) {
        main.postDelayed(() -> scanLocalStorage(web, sink, settled, excludedToken), 1500);
      }
    });
  }

  // Mirrors desktop/src/main/jwt.ts isUserToken: reject sub starting with "client/".
  private boolean isUserToken(String token) {
    if (token == null || token.length() < 20) return false;
    JSONObject p = decodePayload(token);
    if (p == null) return false;
    String sub = p.optString("sub", "");
    if (sub.startsWith("client/")) return false;
    // Never let the localStorage fallback "refresh" with the same stale JWT.
    long exp = p.optLong("exp", 0);
    return exp == 0 || exp * 1000L > System.currentTimeMillis() + 30000L;
  }

  private JSONObject decodePayload(String token) {
    String[] parts = token.split("\\.");
    if (parts.length != 3) return null;
    try {
      byte[] bytes = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
      return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    } catch (Exception e) {
      return null;
    }
  }

  private interface TokenSink {
    void onToken(String token, String source);
  }
}
