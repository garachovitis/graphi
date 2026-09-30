import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.grafi.app',
  appName: 'Graphi',
  webDir: 'dist',
  backgroundColor: '#1ab3ac',
  ios: { contentInset: 'never', scrollEnabled: false, limitsNavigationsToAppBoundDomains: false },
  android: { allowMixedContent: false },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    StatusBar: { style: 'LIGHT', backgroundColor: '#1ab3ac', overlaysWebView: false },
  },
}

export default config
