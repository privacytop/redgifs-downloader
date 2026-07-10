package com.redloader.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register the local plugins before the bridge loads.
    registerPlugin(AuthCapturePlugin.class);
    registerPlugin(MediaSaverPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
