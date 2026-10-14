package com.redloader.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InterruptedIOException;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Persistent foreground owner for gallery downloads. */
public class DownloadService extends Service {
  static final String ACTION_START = "com.redloader.mobile.download.START";
  static final String ACTION_CANCEL = "com.redloader.mobile.download.CANCEL";
  static final String EXTRA_TASK_ID = "taskId";

  private static final String CHANNEL_ID = "redloader_downloads";
  private static final int NOTIFICATION_ID = 41028;
  /** Minimum gap between persisting/emitting progress snapshots of the same task. */
  private static final long FLUSH_INTERVAL_MS = 500;

  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final ScheduledExecutorService flusher = Executors.newSingleThreadScheduledExecutor();
  private final Set<String> scheduled = Collections.newSetFromMap(
    new ConcurrentHashMap<String, Boolean>());
  private final Set<String> cancelled = Collections.newSetFromMap(
    new ConcurrentHashMap<String, Boolean>());

  @Override
  public void onCreate() {
    super.onCreate();
    createChannel();
    resumeInterruptedTasks();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent != null ? intent.getAction() : null;
    String taskId = intent != null ? intent.getStringExtra(EXTRA_TASK_ID) : null;
    // Started via startForegroundService: we must enter the foreground for every command,
    // even ones that end up doing nothing, or API 26+ kills the app.
    JSONObject current = taskId != null ? DownloadTaskStore.get(this, taskId) : null;
    startForeground(NOTIFICATION_ID, notification(current));
    if (ACTION_CANCEL.equals(action) && taskId != null) {
      cancel(taskId);
    } else if (taskId != null) {
      schedule(taskId);
    } else {
      resumeInterruptedTasks();
    }
    if (scheduled.isEmpty()) stopIfIdle();
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    worker.shutdownNow();
    flusher.shutdownNow();
    super.onDestroy();
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void resumeInterruptedTasks() {
    JSONArray tasks = DownloadTaskStore.all(this);
    for (int i = 0; i < tasks.length(); i++) {
      JSONObject task = tasks.optJSONObject(i);
      if (task == null) continue;
      String status = task.optString("status", "");
      if ("queued".equals(status) || "downloading".equals(status)) {
        schedule(task.optString("id", ""));
      }
    }
  }

  private void schedule(String taskId) {
    if (taskId.isEmpty() || !scheduled.add(taskId)) return;
    JSONObject task = DownloadTaskStore.get(this, taskId);
    if (task == null) {
      scheduled.remove(taskId);
      return;
    }
    startForeground(NOTIFICATION_ID, notification(task));
    worker.execute(() -> runTask(taskId));
  }

  private void cancel(String taskId) {
    // Only flag tasks the worker still owns; a stale flag would cancel a later retry.
    if (scheduled.contains(taskId)) {
      cancelled.add(taskId);
      if (!scheduled.contains(taskId)) cancelled.remove(taskId);
    }
    JSONObject task = DownloadTaskStore.get(this, taskId);
    if (task == null) return;
    put(task, "status", "cancelled");
    put(task, "current", "");
    saveAndEmit(task);
  }

  private void runTask(String taskId) {
    JSONObject task = DownloadTaskStore.get(this, taskId);
    if (task == null) {
      cancelled.remove(taskId);
      finished(taskId);
      return;
    }
    Throttle throttle = new Throttle(task);
    try {
      // Cancelled while still queued behind another task: finalize without downloading.
      if (cancelled.contains(taskId) || "cancelled".equals(task.optString("status"))) {
        synchronized (task) {
          recount(task);
          put(task, "status", "cancelled");
          put(task, "current", "");
          throttle.flush(true);
        }
        return;
      }

      synchronized (task) {
        put(task, "status", "downloading");
        put(task, "error", "");
        throttle.flush(true);
      }

      JSONArray items = task.optJSONArray("items");
      if (items == null) items = new JSONArray();
      for (int index = 0; index < items.length(); index++) {
        if (cancelled.contains(taskId)) break;
        JSONObject item = items.optJSONObject(index);
        if (item == null || "completed".equals(item.optString("status"))) continue;

        String url;
        String filename;
        String subdir;
        synchronized (task) {
          put(item, "status", "downloading");
          put(item, "error", "");
          put(task, "current", item.optString("username", ""));
          recount(task);
          throttle.flush(false);
          url = item.optString("url", "");
          filename = item.optString("filename", "download.mp4");
          subdir = item.optString("subdir", "");
        }
        boolean failed = false;
        try {
          if (url.isEmpty()) throw new IllegalArgumentException("No media URL is available");
          MediaDownload.Result result = MediaDownload.save(
            this,
            url,
            filename,
            subdir,
            () -> cancelled.contains(taskId) || Thread.currentThread().isInterrupted());
          synchronized (task) {
            put(item, "status", "completed");
            put(item, "uri", result.uri);
            put(item, "bytes", result.bytes);
            put(item, "completedAt", System.currentTimeMillis());
          }
        } catch (InterruptedIOException cancelledError) {
          synchronized (task) {
            put(item, "status", "queued");
          }
          break;
        } catch (Exception error) {
          failed = true;
          String message = error.getMessage() != null ? error.getMessage() : error.toString();
          synchronized (task) {
            put(item, "status", "failed");
            put(item, "error", message);
            put(task, "error", message);
          }
        }
        synchronized (task) {
          recount(task);
          throttle.flush(failed);
        }
      }

      synchronized (task) {
        recount(task);
        put(task, "current", "");
        if (cancelled.contains(taskId)) {
          put(task, "status", "cancelled");
        } else if (task.optInt("failed", 0) > 0) {
          put(task, "status", "failed");
        } else {
          put(task, "status", "completed");
        }
        throttle.flush(true);
      }
    } finally {
      throttle.close();
      cancelled.remove(taskId);
      DownloadTaskStore.prune(this);
      finished(taskId);
    }
  }

  /**
   * Coalesces progress persistence: at most one save+emit per task every
   * {@link #FLUSH_INTERVAL_MS}, with a trailing flush so the last state is never lost.
   * All task mutations and flushes happen while holding the task's monitor.
   */
  private final class Throttle {
    private final JSONObject task;
    private long lastFlushAt;
    private boolean dirty;
    private ScheduledFuture<?> pending;

    Throttle(JSONObject task) {
      this.task = task;
    }

    void flush(boolean immediate) {
      synchronized (task) {
        dirty = true;
        long elapsed = System.currentTimeMillis() - lastFlushAt;
        if (immediate || elapsed >= FLUSH_INTERVAL_MS) {
          write();
        } else if (pending == null) {
          try {
            pending = flusher.schedule(() -> {
              synchronized (task) {
                pending = null;
                if (dirty) write();
              }
            }, FLUSH_INTERVAL_MS - elapsed, TimeUnit.MILLISECONDS);
          } catch (Exception rejected) {
            write();
          }
        }
      }
    }

    void close() {
      synchronized (task) {
        if (pending != null) pending.cancel(false);
        pending = null;
        if (dirty) write();
      }
    }

    private void write() {
      if (pending != null) {
        pending.cancel(false);
        pending = null;
      }
      dirty = false;
      lastFlushAt = System.currentTimeMillis();
      saveAndEmit(task);
    }
  }

  private void recount(JSONObject task) {
    JSONArray items = task.optJSONArray("items");
    int done = 0;
    int failed = 0;
    int total = items != null ? items.length() : 0;
    for (int i = 0; i < total; i++) {
      JSONObject item = items.optJSONObject(i);
      String status = item != null ? item.optString("status", "") : "";
      if ("completed".equals(status)) done++;
      if ("failed".equals(status)) failed++;
    }
    put(task, "total", total);
    put(task, "done", done);
    put(task, "failed", failed);
  }

  private void saveAndEmit(JSONObject task) {
    DownloadTaskStore.save(this, task);
    MediaSaverPlugin.emitTask(task);
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager != null && "downloading".equals(task.optString("status"))) {
      manager.notify(NOTIFICATION_ID, notification(task));
    }
  }

  private void finished(String taskId) {
    scheduled.remove(taskId);
    if (scheduled.isEmpty()) stopIfIdle();
  }

  private void stopIfIdle() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
    else stopForeground(true);
    stopSelf();
  }

  private Notification notification(@Nullable JSONObject task) {
    if (task == null) {
      return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("RedLoader downloads")
        .setContentText("Preparing downloads")
        .setOnlyAlertOnce(true)
        .setOngoing(true)
        .build();
    }
    int total = task.optInt("total", 0);
    int settled = task.optInt("done", 0) + task.optInt("failed", 0);
    Intent cancelIntent = new Intent(this, DownloadService.class)
      .setAction(ACTION_CANCEL)
      .putExtra(EXTRA_TASK_ID, task.optString("id", ""));
    PendingIntent cancel = PendingIntent.getService(
      this,
      task.optString("id", "").hashCode(),
      cancelIntent,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    return new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(task.optString("label", "RedLoader download"))
      .setContentText(settled + " of " + total + " saved")
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setProgress(Math.max(total, 1), settled, total == 0)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancel)
      .build();
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Progress for media saved by RedLoader");
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager != null) manager.createNotificationChannel(channel);
  }

  private static void put(JSONObject object, String key, Object value) {
    try {
      object.put(key, value);
    } catch (Exception ignored) {}
  }
}
