package com.redloader.mobile;

import android.os.Build;

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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Persistent, bounded thumbnail cache stored outside Android's backup payload.
 * Entries are addressed purely by file name ({@code sha256(key) + ext}); there is no index.
 */
@CapacitorPlugin(name = "MediaCache")
public class MediaCachePlugin extends Plugin {
  private static final String LEGACY_PREFS = "redloader_thumbnail_cache";
  private static final String[] EXTENSIONS = { ".jpg", ".webp", ".png", ".gif", ".avif" };
  private static final long MAX_BYTES = 200L * 1024L * 1024L;
  private static final long PRUNE_TARGET_BYTES = (long) (MAX_BYTES * 0.9);
  private static final long MAX_ITEM_BYTES = 15L * 1024L * 1024L;
  private static final long MAX_AGE_MS = 45L * 24L * 60L * 60L * 1000L;
  private static final long PRUNE_INTERVAL_MS = 5L * 60L * 1000L;
  private static final long STALE_PART_MS = 10L * 60L * 1000L;

  private final ExecutorService workers = Executors.newFixedThreadPool(6);
  private final ExecutorService pruner = Executors.newSingleThreadExecutor();
  private final ConcurrentHashMap<String, FutureTask<File>> inFlight = new ConcurrentHashMap<>();
  private final AtomicLong totalBytes = new AtomicLong(0);
  private final AtomicBoolean pruneQueued = new AtomicBoolean(false);
  private volatile long lastPruneAt = 0;
  private volatile File directory;

  @Override
  public void load() {
    pruneQueued.set(true);
    pruner.execute(() -> {
      try {
        dropLegacyIndex();
        deleteStaleParts();
        prune();
      } finally {
        pruneQueued.set(false);
      }
    });
  }

  @Override
  protected void handleOnDestroy() {
    workers.shutdownNow();
    pruner.shutdownNow();
  }

  /** Cache-only lookup: never touches the network. */
  @PluginMethod
  public void lookup(PluginCall call) {
    String key = call.getString("key");
    if (key == null || key.isEmpty()) {
      call.reject("key is required");
      return;
    }
    File cached = existing(hash(key));
    if (cached == null) {
      JSObject miss = new JSObject();
      miss.put("cached", false);
      call.resolve(miss);
      return;
    }
    cached.setLastModified(System.currentTimeMillis());
    call.resolve(fileResult(cached, true));
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
      String hash = hash(key);
      for (String extension : EXTENSIONS) deleteTracked(new File(directory(), hash + extension));
      call.resolve();
    });
  }

  @PluginMethod
  public void stats(PluginCall call) {
    workers.execute(() -> call.resolve(statsResult()));
  }

  @PluginMethod
  public void clear(PluginCall call) {
    pruner.execute(() -> {
      File[] files = directory().listFiles();
      if (files != null) {
        for (File file : files) {
          // Leave in-progress temp files to their downloads; they clean up themselves.
          if (!file.getName().endsWith(".part")) file.delete();
        }
      }
      totalBytes.set(0);
      call.resolve(statsResult());
    });
  }

  private void resolveThumbnail(PluginCall call, String key, String sourceUrl) {
    String hash = hash(key);
    try {
      File cached = existing(hash);
      if (cached != null) {
        cached.setLastModified(System.currentTimeMillis());
        call.resolve(fileResult(cached, true));
        return;
      }

      FutureTask<File> mine = new FutureTask<>(() -> download(hash, sourceUrl));
      FutureTask<File> running = inFlight.putIfAbsent(hash, mine);
      boolean owner = running == null;
      if (owner) {
        running = mine;
        try {
          mine.run();
        } finally {
          inFlight.remove(hash, mine);
        }
      }
      File file = running.get();
      if (owner) maybePrune();
      call.resolve(fileResult(file, false));
    } catch (ExecutionException wrapped) {
      Throwable error = wrapped.getCause() != null ? wrapped.getCause() : wrapped;
      call.reject(error.getMessage() != null ? error.getMessage() : error.toString(),
        error instanceof Exception ? (Exception) error : wrapped);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      call.reject("Thumbnail request was interrupted", interrupted);
    } catch (Exception error) {
      call.reject(error.getMessage() != null ? error.getMessage() : error.toString(), error);
    }
  }

  /** Returns a valid, non-expired cache entry for the hash, deleting expired/empty ones. */
  private File existing(String hash) {
    File dir = directory();
    long now = System.currentTimeMillis();
    for (String extension : EXTENSIONS) {
      File file = new File(dir, hash + extension);
      if (!file.isFile()) continue;
      if (file.length() == 0 || now - file.lastModified() > MAX_AGE_MS) {
        deleteTracked(file);
        continue;
      }
      return file;
    }
    return null;
  }

  private File download(String hash, String sourceUrl) throws Exception {
    HttpURLConnection connection = null;
    File partial = new File(directory(), hash + "." + UUID.randomUUID() + ".part");
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
      if (mime != null && !mime.toLowerCase(Locale.ROOT).startsWith("image/")) {
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
      long replaced = target.isFile() ? target.length() : 0;
      if (!partial.renameTo(target)) {
        // Some filesystems refuse to rename over an existing file.
        if (target.exists()) target.delete();
        if (!partial.renameTo(target)) throw new IllegalStateException("Could not finalize thumbnail cache entry");
      }
      target.setLastModified(System.currentTimeMillis());
      totalBytes.addAndGet(total - replaced);
      return target;
    } finally {
      if (connection != null) connection.disconnect();
      if (partial.exists()) partial.delete();
    }
  }

  private void maybePrune() {
    boolean due = totalBytes.get() > MAX_BYTES
      || System.currentTimeMillis() - lastPruneAt > PRUNE_INTERVAL_MS;
    if (!due || !pruneQueued.compareAndSet(false, true)) return;
    try {
      pruner.execute(() -> {
        try {
          prune();
        } finally {
          pruneQueued.set(false);
        }
      });
    } catch (Exception rejected) {
      pruneQueued.set(false);
    }
  }

  /** Runs only on {@link #pruner}. Snapshots mtimes once so sorting is stable. */
  private void prune() {
    lastPruneAt = System.currentTimeMillis();
    File[] files = directory().listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
    if (files == null) return;
    long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
    List<Entry> entries = new ArrayList<>(files.length);
    long total = 0;
    for (File file : files) {
      long modified = file.lastModified();
      long size = file.length();
      if (modified < cutoff) {
        file.delete();
        continue;
      }
      entries.add(new Entry(file, modified, size));
      total += size;
    }
    if (total > MAX_BYTES) {
      Collections.sort(entries, (left, right) -> Long.compare(left.modified, right.modified));
      for (Entry entry : entries) {
        if (total <= PRUNE_TARGET_BYTES) break;
        if (entry.file.delete()) total -= entry.size;
      }
    }
    totalBytes.set(total);
  }

  private void deleteStaleParts() {
    File[] parts = directory().listFiles(file -> file.getName().endsWith(".part"));
    if (parts == null) return;
    long cutoff = System.currentTimeMillis() - STALE_PART_MS;
    for (File part : parts) if (part.lastModified() < cutoff) part.delete();
  }

  private void dropLegacyIndex() {
    if (Build.VERSION.SDK_INT < 24) return;
    try {
      getContext().deleteSharedPreferences(LEGACY_PREFS);
    } catch (Exception ignored) {}
  }

  private void deleteTracked(File file) {
    long size = file.length();
    if (file.delete()) totalBytes.addAndGet(-size);
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
    File current = directory;
    if (current == null) {
      current = new File(getContext().getNoBackupFilesDir(), "thumbnail-cache-v1");
      directory = current;
    }
    if (!current.isDirectory()) current.mkdirs();
    return current;
  }

  private String hash(String value) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
      StringBuilder result = new StringBuilder(digest.length * 2);
      for (byte valueByte : digest) result.append(String.format(Locale.ROOT, "%02x", valueByte));
      return result.toString();
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private String extension(String mime, String sourceUrl) {
    String lower = mime != null ? mime.toLowerCase(Locale.ROOT) : "";
    if (lower.contains("webp")) return ".webp";
    if (lower.contains("png")) return ".png";
    if (lower.contains("gif")) return ".gif";
    if (lower.contains("avif")) return ".avif";
    if (lower.contains("jpeg") || lower.contains("jpg")) return ".jpg";
    String clean = sourceUrl.toLowerCase(Locale.ROOT).split("\\?", 2)[0];
    for (String extension : new String[] { ".webp", ".png", ".gif", ".avif" }) {
      if (clean.endsWith(extension)) return extension;
    }
    // ".jpeg" URLs are normalised to ".jpg" so lookup only needs the fixed candidate list.
    return ".jpg";
  }

  private static final class Entry {
    final File file;
    final long modified;
    final long size;

    Entry(File file, long modified, long size) {
      this.file = file;
      this.modified = modified;
      this.size = size;
    }
  }
}
