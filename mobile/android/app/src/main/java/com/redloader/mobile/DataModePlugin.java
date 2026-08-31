package com.redloader.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Reports Android Data Saver state so Auto streaming can avoid HD transfers. */
@CapacitorPlugin(name = "DataMode")
public class DataModePlugin extends Plugin {
  private final BroadcastReceiver receiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      notifyListeners("change", status(), true);
    }
  };
  private boolean registered;

  @Override
  public void load() {
    IntentFilter filter = new IntentFilter();
    filter.addAction(ConnectivityManager.CONNECTIVITY_ACTION);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      filter.addAction(ConnectivityManager.ACTION_RESTRICT_BACKGROUND_CHANGED);
    }
    getContext().registerReceiver(receiver, filter);
    registered = true;
  }

  @Override
  protected void handleOnDestroy() {
    if (registered) {
      getContext().unregisterReceiver(receiver);
      registered = false;
    }
  }

  @PluginMethod
  public void get(PluginCall call) {
    call.resolve(status());
  }

  private JSObject status() {
    ConnectivityManager manager =
      (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    boolean metered = manager != null && manager.isActiveNetworkMetered();
    boolean lowData = false;
    if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      lowData = manager.getRestrictBackgroundStatus()
        != ConnectivityManager.RESTRICT_BACKGROUND_STATUS_DISABLED;
    }
    JSObject result = new JSObject();
    result.put("lowData", lowData);
    result.put("metered", metered);
    return result;
  }
}
