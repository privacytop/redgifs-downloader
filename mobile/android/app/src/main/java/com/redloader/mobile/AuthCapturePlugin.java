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
import android.webkit.WebStorage;
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

/** Captures a RedGifs user bearer token from a shared Android WebView session. */
@CapacitorPlugin(name = "AuthCapture")
public class AuthCapturePlugin extends Plugin {
  private static final String TAG = "AuthCapture";
  private static final String LOGIN_URL = "https://www.redgifs.com/auth/signin";
  private static final String HOME_URL = "https://www.redgifs.com/";
  private static final long REFRESH_TIMEOUT_MS = 25000;

  private final Handler main = new Handler(Looper.getMainLooper());
  private ActiveOperation active;

  @PluginMethod
  public void login(final PluginCall call) {
    call.setKeepAlive(true);
    main.post(() -> openLogin(call));
  }

  @PluginMethod
  public void refresh(final PluginCall call) {
    call.setKeepAlive(true);
    String previousToken = call.getString("previousToken", "");
    main.post(() -> openRefresh(call, previousToken));
  }

  @PluginMethod
  public void cancel(final PluginCall call) {
    main.post(() -> {
      cancelActive();
      call.resolve();
    });
  }

  @PluginMethod
  public void logout(final PluginCall call) {
    main.post(() -> {
      cancelActive();
      WebStorage.getInstance().deleteAllData();
      CookieManager cookies = CookieManager.getInstance();
      cookies.removeAllCookies(removed -> {
        cookies.flush();
        call.resolve();
      });
    });
  }

  @Override
  protected void handleOnDestroy() {
    main.post(this::cancelActive);
  }

  private void openLogin(final PluginCall call) {
    final ActiveOperation operation = begin(call);
    final WebView web = configuredWebView();
    operation.web = web;

    final Dialog dialog = new Dialog(getActivity(),
      android.R.style.Theme_Black_NoTitleBar_Fullscreen);
    operation.dialog = dialog;
    dialog.setContentView(web, new ViewGroup.LayoutParams(-1, -1));
    dialog.setOnDismissListener(ignored -> settleCancelled(operation));

    final TokenSink sink = (token, source) -> settleToken(operation, token, source);
    web.setWebViewClient(clientFor(operation, sink, ""));
    dialog.show();
    web.loadUrl(LOGIN_URL);
  }

  private void openRefresh(final PluginCall call, final String previousToken) {
    final ActiveOperation operation = begin(call);
    final WebView web = configuredWebView();
    operation.web = web;
    final TokenSink sink = (token, source) -> settleToken(operation, token, source);
    web.setWebViewClient(clientFor(operation, sink, previousToken));

    operation.timeout = () -> settleCancelled(operation);
    main.postDelayed(operation.timeout, REFRESH_TIMEOUT_MS);
    web.loadUrl(HOME_URL);
  }

  private WebViewClient clientFor(
    final ActiveOperation operation,
    final TokenSink sink,
    final String excludedToken
  ) {
    return new WebViewClient() {
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
            if (isUserToken(token) && !token.equals(excludedToken)) sink.onToken(token, "header");
          }
        }
        return null;
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        if (!operation.settled.get()) {
          main.postDelayed(() -> scanLocalStorage(operation, sink, excludedToken), 1200);
        }
      }
    };
  }

  private ActiveOperation begin(PluginCall call) {
    cancelActive();
    active = new ActiveOperation(call);
    return active;
  }

  private WebView configuredWebView() {
    WebView web = new WebView(getActivity());
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setUserAgentString(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
        + "Chrome/126.0 Mobile Safari/537.36");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
    return web;
  }

  private void settleToken(ActiveOperation operation, String token, String source) {
    main.post(() -> {
      if (!operation.settled.compareAndSet(false, true)) return;
      cleanup(operation);
      CookieManager.getInstance().flush();
      JSONObject payload = decodePayload(token);
      JSObject result = new JSObject();
      result.put("token", token);
      result.put("source", source);
      result.put("username", payload != null
        ? payload.optString("preferred_username", "") : "");
      operation.call.setKeepAlive(false);
      operation.call.resolve(result);
    });
  }

  private void settleCancelled(ActiveOperation operation) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post(() -> settleCancelled(operation));
      return;
    }
    if (!operation.settled.compareAndSet(false, true)) return;
    cleanup(operation);
    JSObject result = new JSObject();
    result.put("cancelled", true);
    operation.call.setKeepAlive(false);
    operation.call.resolve(result);
  }

  private void cancelActive() {
    if (active != null) settleCancelled(active);
  }

  private void cleanup(ActiveOperation operation) {
    if (operation.timeout != null) main.removeCallbacks(operation.timeout);
    if (operation.web != null) {
      operation.web.stopLoading();
      operation.web.setWebViewClient(null);
    }
    if (operation.dialog != null && operation.dialog.isShowing()) {
      operation.dialog.setOnDismissListener(null);
      operation.dialog.dismiss();
    }
    if (operation.web != null) operation.web.destroy();
    if (active == operation) active = null;
  }

  private void scanLocalStorage(
    final ActiveOperation operation,
    final TokenSink sink,
    final String excludedToken
  ) {
    if (operation.settled.get() || operation.web == null) return;
    final String js = "(function(){for(var i=0;i<localStorage.length;i++){"
      + "var v=localStorage.getItem(localStorage.key(i));"
      + "if(v&&v.indexOf('eyJ')===0&&v.length>40)return v;}return '';})()";
    operation.web.evaluateJavascript(js, value -> {
      String token = value == null ? "" : value.trim();
      if (token.startsWith("\"") && token.endsWith("\"")) {
        token = token.substring(1, token.length() - 1).replace("\\\"", "\"");
      }
      if (!token.isEmpty() && isUserToken(token) && !token.equals(excludedToken)) {
        sink.onToken(token, "localStorage");
      } else if (!operation.settled.get()) {
        main.postDelayed(() -> scanLocalStorage(operation, sink, excludedToken), 1500);
      }
    });
  }

  private boolean isUserToken(String token) {
    if (token == null || token.length() < 20) return false;
    JSONObject payload = decodePayload(token);
    if (payload == null) return false;
    if (payload.optString("sub", "").startsWith("client/")) return false;
    long exp = payload.optLong("exp", 0);
    return exp == 0 || exp * 1000L > System.currentTimeMillis() + 30000L;
  }

  private JSONObject decodePayload(String token) {
    String[] parts = token.split("\\.");
    if (parts.length != 3) return null;
    try {
      byte[] bytes = Base64.decode(
        parts[1], Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
      return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    } catch (Exception error) {
      return null;
    }
  }

  private static final class ActiveOperation {
    final PluginCall call;
    final AtomicBoolean settled = new AtomicBoolean(false);
    WebView web;
    Dialog dialog;
    Runnable timeout;

    ActiveOperation(PluginCall call) {
      this.call = call;
    }
  }

  private interface TokenSink {
    void onToken(String token, String source);
  }
}
