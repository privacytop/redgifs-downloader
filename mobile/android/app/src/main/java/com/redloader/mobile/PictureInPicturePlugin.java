package com.redloader.mobile;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

/** Small Capacitor bridge around Android's Activity-level video PiP support. */
@CapacitorPlugin(name = "PictureInPicture")
public class PictureInPicturePlugin extends Plugin {
  private static WeakReference<PictureInPicturePlugin> instance = new WeakReference<>(null);
  private static volatile boolean playerActive = false;
  private static volatile int videoWidth = 9;
  private static volatile int videoHeight = 16;

  @Override
  public void load() {
    instance = new WeakReference<>(this);
  }

  @Override
  protected void handleOnDestroy() {
    PictureInPicturePlugin current = instance.get();
    if (current == this) instance.clear();
  }

  @PluginMethod
  public void setActive(PluginCall call) {
    playerActive = Boolean.TRUE.equals(call.getBoolean("active", false));
    videoWidth = positive(call.getInt("width", 9), 9);
    videoHeight = positive(call.getInt("height", 16), 16);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && supported()) {
      PictureInPictureParams params = paramsBuilder().setAutoEnterEnabled(playerActive).build();
      getActivity().setPictureInPictureParams(params);
    }
    call.resolve();
  }

  @PluginMethod
  public void enter(PluginCall call) {
    videoWidth = positive(call.getInt("width", videoWidth), videoWidth);
    videoHeight = positive(call.getInt("height", videoHeight), videoHeight);
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !supported()) {
      call.reject("Picture-in-picture is not supported on this device");
      return;
    }
    boolean entered = getActivity().enterPictureInPictureMode(paramsBuilder().build());
    JSObject result = new JSObject();
    result.put("active", entered);
    call.resolve(result);
  }

  static void enterFromUserLeave(Activity activity) {
    if (!playerActive || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    // Android 12+ uses setAutoEnterEnabled for a smoother gesture transition.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;
    if (!activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return;
    activity.enterPictureInPictureMode(paramsBuilder().build());
  }

  static void notifyModeChanged(boolean active) {
    PictureInPicturePlugin plugin = instance.get();
    if (plugin == null) return;
    JSObject event = new JSObject();
    event.put("active", active);
    plugin.notifyListeners("pipModeChanged", event, true);
  }

  private boolean supported() {
    return getActivity().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
  }

  private static PictureInPictureParams.Builder paramsBuilder() {
    return new PictureInPictureParams.Builder().setAspectRatio(safeRatio(videoWidth, videoHeight));
  }

  private static Rational safeRatio(int width, int height) {
    // Android accepts ratios from 1:2.39 through 2.39:1.
    double ratio = (double) width / (double) height;
    if (ratio < 1.0 / 2.39) return new Rational(100, 239);
    if (ratio > 2.39) return new Rational(239, 100);
    return new Rational(width, height);
  }

  private static int positive(Integer value, int fallback) {
    return value != null && value > 0 ? value : fallback;
  }
}
