package com.grafi.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GrafiPrintPlugin.class);
        registerPlugin(GrafiDictationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
