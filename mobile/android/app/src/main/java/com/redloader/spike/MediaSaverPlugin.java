package com.redloader.spike;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads a media URL straight into the shared gallery via MediaStore, under
 * Movies/RedLoader/<subdir>. Native so the transfer avoids the WebView's CORS
 * and memory limits and the file shows up in the phone's gallery. Foreground
 * only for now (no service) — matches the phase-4 scope.
 */
@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {

  private final ExecutorService pool = Executors.newFixedThreadPool(4);

  @Override
  protected void handleOnDestroy() {
    pool.shutdownNow();
  }

  @PluginMethod
  public void download(final PluginCall call) {
    final String url = call.getString("url");
    final String filename = call.getString("filename");
    final String subdir = call.getString("subdir", "");
    if (url == null || filename == null) {
      call.reject("url and filename are required");
      return;
    }
    pool.execute(() -> {
      HttpURLConnection conn = null;
      try {
        conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestProperty("User-Agent", "RedLoader/4.0");
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(30000);
        int code = conn.getResponseCode();
        if (code != 200) {
          call.reject("HTTP " + code);
          return;
        }

        // Route images and videos to the right MediaStore collection + folder —
        // filing an image into the Video collection under Movies/ is rejected by
        // MediaProvider and never shows in the gallery.
        String ext = filename.contains(".") ? filename.substring(filename.lastIndexOf('.') + 1) : "mp4";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
        boolean isImage = mime != null && mime.startsWith("image/");
        if (mime == null) mime = isImage ? "image/jpeg" : "video/mp4";
        Uri collection = isImage
          ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
          : MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        String topDir = isImage ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES;
        String relDir = topDir + "/RedLoader" + (subdir.isEmpty() ? "" : "/" + subdir);

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);

        Uri item;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          values.put(MediaStore.MediaColumns.RELATIVE_PATH, relDir);
          values.put(MediaStore.MediaColumns.IS_PENDING, 1);
          item = resolver.insert(collection, values);
        } else {
          // Pre-Q: write into the public dir directly.
          java.io.File dir = new java.io.File(
            Environment.getExternalStoragePublicDirectory(topDir), "RedLoader");
          if (!dir.exists()) dir.mkdirs();
          values.put(MediaStore.MediaColumns.DATA, new java.io.File(dir, filename).getAbsolutePath());
          item = resolver.insert(collection, values);
        }
        if (item == null) {
          call.reject("could not create gallery entry");
          return;
        }

        long total = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = resolver.openOutputStream(item)) {
          byte[] buf = new byte[65536];
          int n;
          while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            total += n;
          }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          values.clear();
          values.put(MediaStore.MediaColumns.IS_PENDING, 0);
          resolver.update(item, values, null, null);
        }

        JSObject res = new JSObject();
        res.put("uri", item.toString());
        res.put("bytes", total);
        call.resolve(res);
      } catch (Exception e) {
        call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
      } finally {
        if (conn != null) conn.disconnect();
      }
    });
  }
}
