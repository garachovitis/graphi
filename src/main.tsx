import { createRoot } from 'react-dom/client'
// Bundled, metric-compatible substitutes: Carlito ≅ Calibri, Arimo ≅ Arial.
import '@fontsource/carlito/400.css'
import '@fontsource/carlito/400-italic.css'
import '@fontsource/carlito/700.css'
import '@fontsource/carlito/700-italic.css'
import '@fontsource/arimo/400.css'
import '@fontsource/arimo/400-italic.css'
import '@fontsource/arimo/700.css'
import '@fontsource/arimo/700-italic.css'
import './ui/app.css'
import { App } from './ui/App'
import { initTheme } from './ui/theme'
import { initLang } from './i18n'

// Desktop app (Electron): narrow windows keep the full desktop layout (see app.css).
if ((window as any).grafiNative) document.documentElement.classList.add('desktop-host')

initTheme()
initLang()

if (import.meta.env.DEV) import('./devtest')

createRoot(document.getElementById('root')!).render(<App />)

// Installable, offline-capable web app (not inside Electron or the native mobile shells).
const nativeShell = !!(window as any).grafiNative || !!(window as any).Capacitor?.isNativePlatform?.()
if (!nativeShell && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !import.meta.env.DEV) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}

if (import.meta.env.VITE_GRAFI_SELFTEST) import('./mobiletest').then((m) => m.maybeRunSelftest()).catch(() => {})
