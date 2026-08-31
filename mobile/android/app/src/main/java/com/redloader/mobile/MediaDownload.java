package com.redloader.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Shared, cancellation-aware MediaStore transfer with atomic partial cleanup. */
final class MediaDownload {
  interface CancelCheck {
    boolean cancelled();
  }

  static final class Result {
    final String uri;
    final long bytes;

    Result(String uri, long bytes) {
      this.uri = uri;
      this.bytes = bytes;
    }
  }

  private MediaDownload() {}

  static Result save(
    Context context,
    String sourceUrl,
    String filename,
    String subdir,
    CancelCheck cancel
  ) throws Exception {
    HttpURLConnection connection = null;
    Uri item = null;
    ContentResolver resolver = context.getContentResolver();
    try {
      connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
      connection.setRequestProperty("User-Agent", "RedLoader/4.0");
      connection.setConnectTimeout(20000);
      connection.setReadTimeout(30000);
      int code = connection.getResponseCode();
      if (code != HttpURLConnection.HTTP_OK) throw new IllegalStateException("HTTP " + code);
      if (cancel.cancelled()) throw new InterruptedIOException("Download cancelled");

      String extension = filename.contains(".")
        ? filename.substring(filename.lastIndexOf('.') + 1).toLowerCase() : "mp4";
      String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
      boolean image = mime != null && mime.startsWith("image/");
      if (mime == null) mime = "video/mp4";
      Uri collection = image
        ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        : MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
      String topDir = image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_MOVIES;
      String relDir = topDir + "/RedLoader" + (subdir.isEmpty() ? "" : "/" + subdir);

      ContentValues values = new ContentValues();
      values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
      values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relDir);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
      } else {
        File dir = new File(Environment.getExternalStoragePublicDirectory(topDir),
          "RedLoader" + (subdir.isEmpty() ? "" : "/" + subdir));
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Could not create download folder");
        values.put(MediaStore.MediaColumns.DATA, new File(dir, filename).getAbsolutePath());
      }
      item = resolver.insert(collection, values);
      if (item == null) throw new IllegalStateException("Could not create gallery entry");

      long total = 0;
      try (InputStream input = connection.getInputStream(); OutputStream output = resolver.openOutputStream(item)) {
        if (output == null) throw new IllegalStateException("Could not open gallery entry");
        byte[] buffer = new byte[65536];
        int count;
        while ((count = input.read(buffer)) != -1) {
          if (cancel.cancelled()) throw new InterruptedIOException("Download cancelled");
          output.write(buffer, 0, count);
          total += count;
        }
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ContentValues ready = new ContentValues();
        ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, ready, null, null);
      }
      return new Result(item.toString(), total);
    } catch (Exception error) {
      if (item != null) resolver.delete(item, null, null);
      throw error;
    } finally {
      if (connection != null) connection.disconnect();
    }
  }
}
