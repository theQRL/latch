package org.theqrl.latch;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "LatchBiometrics")
public class NativeBiometricPlugin extends Plugin {
    private static final String PREFIX = "org.theqrl.latch.biometric.v1.";
    private PluginCall pending;
    private BiometricPrompt prompt;
    private String pendingId;
    private boolean enrolling;
    private byte[] enrollmentSecret;

    private SharedPreferences records() { return getContext().getSharedPreferences("LatchBiometrics", Context.MODE_PRIVATE); }
    private KeyStore keyStore() throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); return store; }
    private String id(PluginCall call) {
        String value = call.getString("credential", "");
        if (!value.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) throw new IllegalArgumentException("Invalid biometric credential");
        return value;
    }
    private void delete(String id) throws Exception {
        keyStore().deleteEntry(PREFIX + id);
        if (!records().edit().remove(id + ".iv").remove(id + ".data").commit()) throw new IllegalStateException("Could not remove biometric record");
    }
    private void clear() {
        if (enrollmentSecret != null) Arrays.fill(enrollmentSecret, (byte) 0);
        enrollmentSecret = null; pending = null; pendingId = null; prompt = null; enrolling = false;
    }
    private void fail(PluginCall call, String message) {
        if (pending != call) return;
        if (enrolling) { try { delete(pendingId); } catch (Exception ignored) {} }
        clear(); call.reject(message + " Use your vault passphrase.");
    }
    @PluginMethod public void availability(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject result = new JSObject(); result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("label", "Biometric unlock");
        result.put("reason", status == BiometricManager.BIOMETRIC_SUCCESS ? "" : "Enroll a strong biometric in Android settings, or use your vault passphrase.");
        call.resolve(result);
    }
    @PluginMethod public void enroll(PluginCall call) { getActivity().runOnUiThread(() -> start(call, true)); }
    @PluginMethod public void unlock(PluginCall call) { getActivity().runOnUiThread(() -> start(call, false)); }
    private void start(PluginCall call, boolean create) {
        if (pending != null) { call.reject("Another biometric request is open"); return; }
        if (BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Strong biometric authentication is unavailable. Use your vault passphrase."); return;
        }
        try {
            String credential = create ? UUID.randomUUID().toString() : id(call);
            pending = call; pendingId = credential; enrolling = create;
            SecretKey key;
            if (create) {
                KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(PREFIX + credential, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
                if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
                else spec.setUserAuthenticationValidityDurationSeconds(-1);
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(spec.build()); key = generator.generateKey();
                KeyInfo info = (KeyInfo) SecretKeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
                if (!info.isInsideSecureHardware()) throw new IllegalStateException("Hardware-backed key protection is unavailable");
                enrollmentSecret = new byte[32]; new SecureRandom().nextBytes(enrollmentSecret);
            } else {
                key = (SecretKey) keyStore().getKey(PREFIX + credential, null);
                if (key == null) throw new IllegalStateException("Biometrics changed or the device key was removed");
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] input;
            if (create) { cipher.init(Cipher.ENCRYPT_MODE, key); input = enrollmentSecret; }
            else {
                String iv = records().getString(credential + ".iv", null), data = records().getString(credential + ".data", null);
                if (iv == null || data == null || iv.length() > 32 || data.length() > 128) throw new IllegalStateException("Biometric record is missing or invalid");
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                input = Base64.decode(data, Base64.NO_WRAP);
            }
            prompt = new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationError(int code, CharSequence message) { fail(call, "Biometric authentication cancelled or unavailable."); }
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (pending != call) return;
                    byte[] output = null;
                    try {
                        Cipher authorized = result.getCryptoObject() == null ? null : result.getCryptoObject().getCipher();
                        if (authorized == null) throw new IllegalStateException("No authenticated cipher");
                        authorized.updateAAD((PREFIX + credential).getBytes(StandardCharsets.UTF_8));
                        output = authorized.doFinal(input);
                        byte[] secret = create ? enrollmentSecret : output;
                        if (secret == null || secret.length != 32) throw new IllegalStateException("Invalid biometric key");
                        if (create && !records().edit().putString(credential + ".iv", Base64.encodeToString(authorized.getIV(), Base64.NO_WRAP))
                            .putString(credential + ".data", Base64.encodeToString(output, Base64.NO_WRAP)).commit()) throw new IllegalStateException("Could not save biometric record");
                        JSObject response = new JSObject(); response.put("credential", credential); response.put("secret", Base64.encodeToString(secret, Base64.NO_WRAP));
                        clear(); call.resolve(response);
                    } catch (Exception error) { fail(call, "Biometric key access failed. Re-enable it after passphrase recovery."); }
                    finally { if (output != null) Arrays.fill(output, (byte) 0); }
                }
            });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder().setTitle(create ? "Enable Latch biometric unlock" : "Unlock Latch vault")
                .setSubtitle("Your wallet passwords are still required for signing")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG).setNegativeButtonText("Use vault passphrase").build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        } catch (Exception error) {
            if (pending == call) fail(call, "Biometric key protection is unavailable. Re-enable it after passphrase recovery.");
            else call.reject("Invalid biometric request. Use your vault passphrase.");
        }
    }
    @PluginMethod public void remove(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pending != null) { call.reject("Finish the current biometric request first"); return; }
            try { delete(id(call)); call.resolve(); } catch (Exception error) { call.reject("Could not remove biometric key"); }
        });
    }
    private void cancelPending() {
        PluginCall call = pending; BiometricPrompt active = prompt;
        if (call != null) fail(call, "Biometric request cancelled.");
        if (active != null) active.cancelAuthentication();
    }
    @PluginMethod public void cancel(PluginCall call) { getActivity().runOnUiThread(() -> { cancelPending(); call.resolve(); }); }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(this::cancelPending); }
    @PluginMethod public void wipe(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            cancelPending();
            try {
                KeyStore store = keyStore();
                java.util.Enumeration<String> aliases = store.aliases();
                java.util.ArrayList<String> names = new java.util.ArrayList<>();
                while (aliases.hasMoreElements()) { String name = aliases.nextElement(); if (name.startsWith(PREFIX)) names.add(name); }
                for (String name : names) store.deleteEntry(name);
                if (!records().edit().clear().commit()) throw new IllegalStateException("Could not clear biometric records");
                call.resolve();
            } catch (Exception error) { call.reject("Device keys could not be removed"); }
        });
    }

}
