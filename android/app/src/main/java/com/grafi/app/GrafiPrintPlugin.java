package com.grafi.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Graphi printing on Android. The Capacitor WebView is Chromium, so the document's print CSS
 * (@page size, margins, header/footer margin boxes) and Graphi's forced page breaks apply
 * exactly as on desktop. The system print dialog offers every printer plus "Save as PDF".
 */
@CapacitorPlugin(name = "GrafiPrint")
public class GrafiPrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (webView == null || pm == null) {
                call.reject("Η εκτύπωση δεν είναι διαθέσιμη");
                return;
            }
            String name = call.getString("name", "Graphi");
            double wMm = call.getDouble("width", 210.0);
            double hMm = call.getDouble("height", 297.0);
            // MediaSize is expressed in mils (1/1000 inch).
            int wMils = (int) Math.round(Math.min(wMm, hMm) / 25.4 * 1000);
            int hMils = (int) Math.round(Math.max(wMm, hMm) / 25.4 * 1000);
            PrintAttributes.MediaSize size = new PrintAttributes.MediaSize("grafi_page", "Graphi", wMils, hMils);
            if (wMm > hMm) size = size.asLandscape();
            PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(size)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
            pm.print(name, adapter, attrs);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        });
    }
}
