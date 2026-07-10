package com.redloader.spike;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register the local AuthCapture plugin before the bridge loads.
    registerPlugin(AuthCapturePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
