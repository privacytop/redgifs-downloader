package com.redloader.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Process-safe-enough persisted task snapshots shared by the plugin and service. */
final class DownloadTaskStore {
  private static final String PREFS = "redloader_download_tasks";
  private static final String PREFIX = "task:";
  private static final int MAX_TASKS = 50;

  private DownloadTaskStore() {}

  static synchronized void save(Context context, JSONObject task) {
    String id = task.optString("id", "");
    if (id.isEmpty()) return;
    prefs(context).edit().putString(PREFIX + id, task.toString()).apply();
  }

  static synchronized JSONObject get(Context context, String id) {
    String value = prefs(context).getString(PREFIX + id, null);
    if (value == null) return null;
    try {
      return new JSONObject(value);
    } catch (Exception ignored) {
      prefs(context).edit().remove(PREFIX + id).apply();
      return null;
    }
  }

  static synchronized JSONArray all(Context context) {
    List<JSONObject> tasks = new ArrayList<>();
    for (Map.Entry<String, ?> entry : prefs(context).getAll().entrySet()) {
      if (!entry.getKey().startsWith(PREFIX) || !(entry.getValue() instanceof String)) continue;
      try {
        tasks.add(new JSONObject((String) entry.getValue()));
      } catch (Exception ignored) {}
    }
    Collections.sort(tasks, new Comparator<JSONObject>() {
      @Override
      public int compare(JSONObject left, JSONObject right) {
        return Long.compare(right.optLong("createdAt", 0), left.optLong("createdAt", 0));
      }
    });
    JSONArray result = new JSONArray();
    for (JSONObject task : tasks) result.put(task);
    return result;
  }

  static synchronized void prune(Context context) {
    JSONArray tasks = all(context);
    if (tasks.length() <= MAX_TASKS) return;
    SharedPreferences.Editor edit = prefs(context).edit();
    for (int i = MAX_TASKS; i < tasks.length(); i++) {
      JSONObject task = tasks.optJSONObject(i);
      if (task != null) edit.remove(PREFIX + task.optString("id", ""));
    }
    edit.apply();
  }

  private static SharedPreferences prefs(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }
}
