package com.redloader.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;

import javax.crypto.AEADBadTagException;
import javax.crypto.BadPaddingException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Stores the bearer token encrypted by a non-exportable Android Keystore key. */
@CapacitorPlugin(name = "SecureTokenStore")
public class SecureTokenStorePlugin extends Plugin {
  private static final String KEY_ALIAS = "redloader.auth.token.v1";
  private static final String PREFS = "redloader_secure_auth";
  private static final String TOKEN = "token";
  private static final String SEPARATOR = ".";

  @PluginMethod
  public void get(PluginCall call) {
    try {
      String encrypted = preferences().getString(TOKEN, null);
      JSObject result = new JSObject();
      if (encrypted != null && !encrypted.isEmpty()) result.put("value", decrypt(encrypted));
      call.resolve(result);
    } catch (Exception error) {
      if (isUnrecoverable(error)) {
        // A restored backup cannot be decrypted with a key from another device.
        preferences().edit().remove(TOKEN).apply();
        call.reject("Unable to decrypt the saved session", error);
      } else {
        // Transient Keystore failures must not sign the user out; keep the token for a retry.
        call.reject("Secure storage is temporarily unavailable", error);
      }
    }
  }

  /** True only when the stored ciphertext can never be decrypted with the current key. */
  private static boolean isUnrecoverable(Exception error) {
    return error instanceof AEADBadTagException
      || error instanceof BadPaddingException
      || error instanceof UnrecoverableKeyException
      || error instanceof KeyPermanentlyInvalidatedException
      // Malformed stored value (missing separator / bad Base64).
      || error instanceof IllegalArgumentException;
  }

  @PluginMethod
  public void set(PluginCall call) {
    String value = call.getString("value");
    if (value == null || value.isEmpty()) {
      call.reject("A token value is required");
      return;
    }
    try {
      preferences().edit().putString(TOKEN, encrypt(value)).apply();
      call.resolve();
    } catch (Exception error) {
      call.reject("Unable to securely save the session", error);
    }
  }

  @PluginMethod
  public void remove(PluginCall call) {
    preferences().edit().remove(TOKEN).apply();
    call.resolve();
  }

  private SharedPreferences preferences() {
    return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private String encrypt(String value) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
    String body = Base64.encodeToString(
      cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    return iv + SEPARATOR + body;
  }

  private String decrypt(String encoded) throws Exception {
    String[] parts = encoded.split("\\.", 2);
    if (parts.length != 2) throw new IllegalArgumentException("Malformed encrypted token");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, key(),
      new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
    return new String(
      cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
  }

  private SecretKey key() throws Exception {
    KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
    keyStore.load(null);
    if (!keyStore.containsAlias(KEY_ALIAS)) {
      KeyGenerator generator = KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build());
      generator.generateKey();
    }
    return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
  }
}
