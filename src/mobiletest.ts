// On-device self-test (iOS/Android). Runs only if the file "grafi-selftest" exists in the
// app's Documents folder (placed there by the developer, e.g. via simctl). It renders a
// multi-page document through the native PDF path and writes the PDF + a JSON report.
import { Capacitor } from '@capacitor/core'

export async function maybeRunSelftest() {
  if (!Capacitor.isNativePlatform()) return
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  try { await Filesystem.stat({ path: 'grafi-selftest', directory: Directory.Documents }) } catch { return }
  const w = window as any
  for (let i = 0; i < 50 && !w.__grafi; i++) await new Promise((r) => setTimeout(r, 200))
  const { editor, layoutStore, setSettings, settings } = w.__grafi
  const P = 'Η σελιδοποίηση πρέπει να είναι ακριβής όπως στο Word: κάθε γραμμή κειμένου ανήκει σε μία μόνο σελίδα και οι επικεφαλίδες μένουν με την επόμενη παράγραφο. '
  const content: any[] = []
  for (let i = 0; i < 40; i++) {
    if (i % 6 === 0) content.push({ type: 'heading', attrs: { level: 1 + (i % 3) }, content: [{ type: 'text', text: 'Ενότητα ' + (i / 6 + 1) }] })
    content.push({ type: 'paragraph', attrs: { textAlign: i % 2 ? 'justify' : null }, content: [{ type: 'text', text: P.repeat(1 + (i % 4)) }] })
  }
  setSettings({ ...settings, hf: { ...settings.hf, headerText: 'Grafi · iOS', headerAlign: 'right', footerText: 'Σελίδα {page} από {pages}', footerAlign: 'center' } })
  editor.commands.setContent({ type: 'doc', content })
  await new Promise((r) => setTimeout(r, 3000))
  const s = w.__grafi.settings
  const log = (o: unknown) => Filesystem.writeFile({ path: 'selftest.json', directory: Directory.Documents, encoding: 'utf8' as any, data: JSON.stringify(o) })
  await log({ stage: 'calling renderPdf', hasPlugin: Capacitor.isPluginAvailable('GrafiPrint') })
  // Same path as File ▸ Export PDF (page-sheet capture on iOS).
  const { platform } = await import('./platform')
  let bytes: Uint8Array | null
  try {
    bytes = await Promise.race([platform.renderPdf({
      name: 'selftest', width: s.width, height: s.height, ...s.margins,
      header: s.hf.headerText, footer: s.hf.footerText, headerAlign: s.hf.headerAlign, footerAlign: s.hf.footerAlign,
      differentFirstPage: false, headerDistance: s.hf.headerDistance, footerDistance: s.hf.footerDistance,
    }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20000))])
  } catch (e: any) {
    await log({ stage: 'renderPdf failed', error: String(e?.message || e), code: e?.code })
    return
  }
  if (!bytes) { await log({ stage: 'renderPdf returned null' }); return }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const res = { data: btoa(bin), pages: (new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page(?!s)/g) || []).length }
  await Filesystem.writeFile({ path: 'selftest.pdf', directory: Directory.Documents, data: res.data })
  await Filesystem.writeFile({ path: 'selftest.json', directory: Directory.Documents, encoding: 'utf8' as any,
    data: JSON.stringify({ screenPages: layoutStore.pageCount, pdfPages: res.pages, ua: navigator.userAgent }) })
}
