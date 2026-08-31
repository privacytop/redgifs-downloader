package com.redloader.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Persistent, bounded thumbnail cache stored outside Android's backup payload. */
@CapacitorPlugin(name = "MediaCache")
public class MediaCachePlugin extends Plugin {
  private static final String PREFS = "redloader_thumbnail_cache";
  private static final String ENTRY_PREFIX = "entry:";
  private static final long MAX_BYTES = 200L * 1024L * 1024L;
  private static final long MAX_ITEM_BYTES = 15L * 1024L * 1024L;
  private static final long MAX_AGE_MS = 45L * 24L * 60L * 60L * 1000L;

  private final ExecutorService workers = Executors.newFixedThreadPool(4);
  private final Map<String, Object> locks = new HashMap<>();

  @Override
  public void load() {
    workers.execute(this::prune);
  }

  @Override
  protected void handleOnDestroy() {
    workers.shutdownNow();
  }

  @PluginMethod
  public void thumbnail(PluginCall call) {
    String key = call.getString("key");
    String sourceUrl = call.getString("url");
    if (key == null || key.isEmpty() || sourceUrl == null || sourceUrl.isEmpty()) {
      call.reject("key and url are required");
      return;
    }
    workers.execute(() -> resolveThumbnail(call, key, sourceUrl));
  }

  @PluginMethod
  public void invalidate(PluginCall call) {
    String key = call.getString("key");
    if (key == null || key.isEmpty()) {
      call.reject("key is required");
      return;
    }
    workers.execute(() -> {
      remove(hash(key));
      call.resolve();
    });
  }

  @PluginMethod
  public void stats(PluginCall call) {
    workers.execute(() -> call.resolve(statsResult()));
  }

  @PluginMethod
  public void clear(PluginCall call) {
    workers.execute(() -> {
      File[] files = directory().listFiles();
      if (files != null) for (File file : files) file.delete();
      preferences().edit().clear().apply();
      call.resolve(statsResult());
    });
  }

  private void resolveThumbnail(PluginCall call, String key, String sourceUrl) {
    String hash = hash(key);
    Object lock = lockFor(hash);
    try {
      synchronized (lock) {
        File cached = existing(hash);
        if (cached != null) {
          cached.setLastModified(System.currentTimeMillis());
          call.resolve(fileResult(cached, true));
          return;
        }

        File downloaded = download(hash, sourceUrl);
        preferences().edit().putString(ENTRY_PREFIX + hash, downloaded.getName()).apply();
        prune();
        call.resolve(fileResult(downloaded, false));
      }
    } catch (Exception error) {
      call.reject(error.getMessage() != null ? error.getMessage() : error.toString(), error);
    } finally {
      synchronized (locks) {
        if (locks.get(hash) == lock) locks.remove(hash);
      }
    }
  }

  private File existing(String hash) {
    String name = preferences().getString(ENTRY_PREFIX + hash, null);
    if (name == null) return null;
    File file = new File(directory(), name);
    boolean expired = System.currentTimeMillis() - file.lastModified() > MAX_AGE_MS;
    if (!file.isFile() || file.length() == 0 || expired) {
      remove(hash);
      return null;
    }
    return file;
  }

  private File download(String hash, String sourceUrl) throws Exception {
    HttpURLConnection connection = null;
    File partial = new File(directory(), hash + ".part");
    try {
      connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
      connection.setRequestProperty("User-Agent", "RedLoader/4.0");
      connection.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(20000);
      connection.setInstanceFollowRedirects(true);
      int response = connection.getResponseCode();
      if (response != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Thumbnail HTTP " + response);
      int declaredLength = connection.getContentLength();
      if (declaredLength > MAX_ITEM_BYTES) throw new IllegalStateException("Thumbnail is too large");
      String mime = connection.getContentType();
      if (mime != null && !mime.toLowerCase(java.util.Locale.ROOT).startsWith("image/")) {
        throw new IllegalStateException("Thumbnail response is not an image");
      }

      long total = 0;
      try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
        byte[] buffer = new byte[32768];
        int count;
        while ((count = input.read(buffer)) != -1) {
          total += count;
          if (total > MAX_ITEM_BYTES) throw new IllegalStateException("Thumbnail is too large");
          output.write(buffer, 0, count);
        }
        output.getFD().sync();
      }
      if (total == 0) throw new IllegalStateException("Thumbnail response was empty");

      File target = new File(directory(), hash + extension(mime, sourceUrl));
      if (target.exists()) target.delete();
      if (!partial.renameTo(target)) throw new IllegalStateException("Could not finalize thumbnail cache entry");
      target.setLastModified(System.currentTimeMillis());
      return target;
    } finally {
      if (connection != null) connection.disconnect();
      if (partial.exists()) partial.delete();
    }
  }

  private void prune() {
    File[] files = directory().listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
    if (files == null) return;
    Arrays.sort(files, new Comparator<File>() {
      @Override
      public int compare(File left, File right) {
        return Long.compare(left.lastModified(), right.lastModified());
      }
    });
    long total = 0;
    long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
    for (File file : files) {
      if (file.lastModified() < cutoff) {
        removeFile(file);
      } else {
        total += file.length();
      }
    }
    if (total <= MAX_BYTES) return;
    for (File file : files) {
      if (!file.exists()) continue;
      long size = file.length();
      removeFile(file);
      total -= size;
      if (total <= MAX_BYTES) break;
    }
  }

  private void remove(String hash) {
    String name = preferences().getString(ENTRY_PREFIX + hash, null);
    if (name != null) new File(directory(), name).delete();
    preferences().edit().remove(ENTRY_PREFIX + hash).apply();
  }

  private void removeFile(File file) {
    String name = file.getName();
    file.delete();
    SharedPreferences.Editor editor = preferences().edit();
    for (Map.Entry<String, ?> entry : preferences().getAll().entrySet()) {
      if (name.equals(entry.getValue())) editor.remove(entry.getKey());
    }
    editor.apply();
  }

  private Object lockFor(String hash) {
    synchronized (locks) {
      Object lock = locks.get(hash);
      if (lock == null) {
        lock = new Object();
        locks.put(hash, lock);
      }
      return lock;
    }
  }

  private JSObject fileResult(File file, boolean cached) {
    JSObject result = new JSObject();
    result.put("path", file.getAbsolutePath());
    result.put("bytes", file.length());
    result.put("cached", cached);
    return result;
  }

  private JSObject statsResult() {
    File[] files = directory().listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
    long bytes = 0;
    int count = 0;
    if (files != null) {
      count = files.length;
      for (File file : files) bytes += file.length();
    }
    JSObject result = new JSObject();
    result.put("bytes", bytes);
    result.put("count", count);
    result.put("limitBytes", MAX_BYTES);
    return result;
  }

  private File directory() {
    File directory = new File(getContext().getNoBackupFilesDir(), "thumbnail-cache-v1");
    if (!directory.exists()) directory.mkdirs();
    return directory;
  }

  private SharedPreferences preferences() {
    return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private String hash(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder();
      for (byte valueByte : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", valueByte));
      return result.toString();
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private String extension(String mime, String sourceUrl) {
    String lower = mime != null ? mime.toLowerCase(java.util.Locale.ROOT) : "";
    if (lower.contains("webp")) return ".webp";
    if (lower.contains("png")) return ".png";
    if (lower.contains("gif")) return ".gif";
    if (lower.contains("avif")) return ".avif";
    if (lower.contains("jpeg") || lower.contains("jpg")) return ".jpg";
    String clean = sourceUrl.toLowerCase(java.util.Locale.ROOT).split("\\?", 2)[0];
    for (String extension : new String[] { ".webp", ".png", ".gif", ".avif", ".jpg", ".jpeg" }) {
      if (clean.endsWith(extension)) return extension;
    }
    return ".jpg";
  }
}
