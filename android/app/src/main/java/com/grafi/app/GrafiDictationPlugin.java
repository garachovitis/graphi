package com.grafi.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * Grafi dictation (Home ▸ Dictate) on Android: the system SpeechRecognizer, restarted after every
 * phrase so dictation continues until the user stops it. Android 13+ adds punctuation and capitals
 * (EXTRA_ENABLE_FORMATTING). Events: partial / final {text}, level {level 0…1}, error {code}.
 */
@CapacitorPlugin(name = "GrafiDictation", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") })
public class GrafiDictationPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean active;
    private String lang = "el-GR";
    private boolean punctuation = true;
    private int failures;
    private long lastLevel;
    private PluginCall stopping;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("permission denied");
    }

    private void begin(PluginCall call) {
        lang = call.getString("lang", "el-GR");
        punctuation = call.getBoolean("punctuation", true);
        main.post(() -> {
            active = true;
            failures = 0;
            listen();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            active = false;
            if (recognizer == null) { call.resolve(); return; }
            // stopListening() delivers the words heard so far through onResults; resolve after that.
            stopping = call;
            recognizer.stopListening();
            main.postDelayed(this::finishStop, 2000);
        });
    }

    private void finishStop() {
        if (recognizer != null && !active) { recognizer.destroy(); recognizer = null; }
        if (stopping != null) { stopping.resolve(); stopping = null; }
    }

    private void listen() {
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(listener);
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        // Hints for a dictation-length pause (not every recogniser honours them).
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500);
        if (Build.VERSION.SDK_INT >= 33 && punctuation) {
            i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY);
        }
        recognizer.startListening(i);
    }

    private static String first(Bundle b) {
        ArrayList<String> m = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return m == null || m.isEmpty() ? "" : m.get(0);
    }

    private void emit(String event, String key, Object value) {
        JSObject d = new JSObject();
        d.put(key, value);
        notifyListeners(event, d);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onPartialResults(Bundle b) {
            String t = first(b);
            if (!t.isEmpty()) emit("partial", "text", t);
        }

        @Override public void onResults(Bundle b) {
            failures = 0;
            String t = first(b);
            if (!t.isEmpty()) emit("final", "text", t);
            if (active) listen(); else finishStop();
        }

        @Override public void onError(int error) {
            if (!active) { finishStop(); return; }
            String code = null;
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) code = "permission";
            else if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) code = "language";
            else if (++failures > 8) code = error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "network" : "failed";
            if (code != null) {
                active = false;
                if (recognizer != null) { recognizer.destroy(); recognizer = null; }
                emit("error", "code", code);
                return;
            }
            // No match / silence timeout / busy: keep listening.
            main.postDelayed(() -> { if (active) listen(); }, 250);
        }

        @Override public void onRmsChanged(float rmsdB) {
            long now = System.currentTimeMillis();
            if (now - lastLevel < 66) return;
            lastLevel = now;
            emit("level", "level", Math.max(0, Math.min(1, (rmsdB + 2) / 12)));
        }

        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}
    };
}
