package com.redloader.mobile;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;

/** Capacitor bridge to the persistent foreground download service. */
@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {
  private static final int NOTIFICATION_PERMISSION_REQUEST = 7301;
  private static WeakReference<MediaSaverPlugin> instance = new WeakReference<>(null);

  @Override
  public void load() {
    instance = new WeakReference<>(this);
  }

  @Override
  protected void handleOnDestroy() {
    MediaSaverPlugin current = instance.get();
    if (current == this) instance.clear();
  }

  @PluginMethod
  public void startTask(PluginCall call) {
    String id = call.getString("id");
    String label = call.getString("label", "RedLoader download");
    JSArray suppliedItems = call.getArray("items");
    if (id == null || id.isEmpty() || suppliedItems == null) {
      call.reject("id and items are required");
      return;
    }
    try {
      JSONArray items = new JSONArray(suppliedItems.toString());
      for (int index = 0; index < items.length(); index++) {
        JSONObject item = items.optJSONObject(index);
        if (item != null) item.put("status", "queued");
      }
      JSONObject task = new JSONObject();
      task.put("id", id);
      task.put("label", label);
      task.put("status", "queued");
      task.put("createdAt", System.currentTimeMillis());
      task.put("total", items.length());
      task.put("done", 0);
      task.put("failed", 0);
      task.put("current", "");
      task.put("items", items);
      DownloadTaskStore.save(getContext(), task);
      startService(id, DownloadService.ACTION_START);
      call.resolve(JSObject.fromJSONObject(task));
    } catch (Exception error) {
      call.reject(error.getMessage() != null ? error.getMessage() : error.toString(), error);
    }
  }

  @PluginMethod
  public void listTasks(PluginCall call) {
    JSObject result = new JSObject();
    result.put("tasks", DownloadTaskStore.all(getContext()));
    call.resolve(result);
  }

  @PluginMethod
  public void cancelTask(PluginCall call) {
    String id = call.getString("id");
    if (id == null || id.isEmpty()) {
      call.reject("id is required");
      return;
    }
    startService(id, DownloadService.ACTION_CANCEL);
    call.resolve();
  }

  @PluginMethod
  public void retryTask(PluginCall call) {
    String id = call.getString("id");
    JSONObject task = id != null ? DownloadTaskStore.get(getContext(), id) : null;
    if (task == null) {
      call.reject("Download task not found");
      return;
    }
    JSONArray items = task.optJSONArray("items");
    if (items != null) {
      for (int index = 0; index < items.length(); index++) {
        JSONObject item = items.optJSONObject(index);
        if (item != null && !"completed".equals(item.optString("status"))) {
          put(item, "status", "queued");
          put(item, "error", "");
        }
      }
    }
    put(task, "status", "queued");
    put(task, "failed", 0);
    put(task, "error", "");
    DownloadTaskStore.save(getContext(), task);
    emitTask(task);
    startService(id, DownloadService.ACTION_START);
    call.resolve();
  }

  @PluginMethod
  public void removeTask(PluginCall call) {
    String id = call.getString("id");
    if (id == null || id.isEmpty()) {
      call.reject("id is required");
      return;
    }
    JSONObject task = DownloadTaskStore.get(getContext(), id);
    if (task != null) {
      String status = task.optString("status", "");
      if ("queued".equals(status) || "downloading".equals(status)) {
        call.reject("Cannot remove an active download");
        return;
      }
    }
    DownloadTaskStore.remove(getContext(), id);
    call.resolve();
  }

  @PluginMethod
  public void open(PluginCall call) {
    String raw = call.getString("uri");
    if (raw == null || raw.isEmpty()) {
      call.reject("uri is required");
      return;
    }
    Uri uri = Uri.parse(raw);
    String scheme = uri.getScheme();
    if (!"content".equals(scheme) && !"file".equals(scheme)) {
      call.reject("Not an openable file location");
      return;
    }
    String mime = call.getString("mime");
    if (mime == null || mime.isEmpty()) {
      String lower = raw.toLowerCase(java.util.Locale.ROOT);
      boolean image = lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")
        || lower.endsWith(".webp") || lower.endsWith(".gif");
      mime = image ? "image/*" : "video/mp4";
    }
    Intent intent = new Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, mime)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    try {
      getContext().startActivity(intent);
      call.resolve();
    } catch (ActivityNotFoundException error) {
      call.reject("No app available to open this file");
    } catch (Exception error) {
      call.reject(error.getMessage() != null ? error.getMessage() : "Could not open file");
    }
  }

  @PluginMethod
  public void requestNotificationPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
        != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(
        getActivity(),
        new String[] { Manifest.permission.POST_NOTIFICATIONS },
        NOTIFICATION_PERMISSION_REQUEST);
    }
    call.resolve();
  }

  private void startService(String id, String action) {
    Intent intent = new Intent(getContext(), DownloadService.class)
      .setAction(action)
      .putExtra(DownloadService.EXTRA_TASK_ID, id);
    ContextCompat.startForegroundService(getContext(), intent);
  }

  static void emitTask(JSONObject task) {
    MediaSaverPlugin plugin = instance.get();
    if (plugin == null) return;
    try {
      plugin.notifyListeners("taskChanged", JSObject.fromJSONObject(task), true);
    } catch (Exception ignored) {}
  }

  private static void put(JSONObject object, String key, Object value) {
    try {
      object.put(key, value);
    } catch (Exception ignored) {}
  }
}
