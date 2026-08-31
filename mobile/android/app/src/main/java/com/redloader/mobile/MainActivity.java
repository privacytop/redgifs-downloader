package com.redloader.mobile;

import android.annotation.TargetApi;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register the local plugins before the bridge loads.
    registerPlugin(AuthCapturePlugin.class);
    registerPlugin(MediaSaverPlugin.class);
    registerPlugin(PictureInPicturePlugin.class);
    registerPlugin(SecureTokenStorePlugin.class);
    registerPlugin(MediaCachePlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onUserLeaveHint() {
    super.onUserLeaveHint();
    PictureInPicturePlugin.enterFromUserLeave(this);
  }

  @Override
  @TargetApi(Build.VERSION_CODES.O)
  public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
    PictureInPicturePlugin.notifyModeChanged(isInPictureInPictureMode);
  }
}
