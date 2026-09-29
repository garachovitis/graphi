// Floating dictation bar (bottom of the workspace), like Word's Dictate toolbar: live microphone
// level, what the engine is doing, the voice-command list, and Stop.
import { useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { Mic, Square, HelpCircle, X } from 'lucide-react'
import { dictation, useDictation, useDictPrefs } from '../dictation'
import { COMMAND_HELP } from '../dictation/text'
import { t, type Key } from '../i18n'

export function DictationBar({ editor }: { editor: Editor }) {
  const s = useDictation()
  const prefs = useDictPrefs()
  const meter = useRef<HTMLSpanElement>(null)

  // The level changes ~30×/s: write it straight to the DOM instead of re-rendering React.
  useEffect(() => dictation.onLevel((v) => meter.current?.style.setProperty('--level', v.toFixed(2))), [])

  // Errors clear themselves after a while; permission problems stay until dismissed.
  useEffect(() => {
    if (!s.error || s.error === 'permission') return
    const id = setTimeout(dictation.dismissError, 9000)
    return () => clearTimeout(id)
  }, [s.error])

  if (s.phase === 'idle' && !s.error) return null

  if (s.phase === 'idle' && s.error) {
    return (
      <div className="dict-bar error no-print" role="alert">
        <span className="dict-msg">{t(`dict.err.${s.error}` as Key)}</span>
        <button type="button" className="dict-btn" title={t('dict.close')} aria-label={t('dict.close')} onClick={dictation.dismissError}><X size={15} /></button>
      </div>
    )
  }

  if (s.phase === 'consent') {
    return (
      <div className="dict-bar consent no-print" role="dialog" aria-label={t('dict.dictate')}>
        <Mic size={18} className="dict-icon" />
        <span className="dict-msg">{t('dict.consent', { mb: s.consentMb })}<small>{t('dict.consentPrivacy')}</small></span>
        <button type="button" className="dict-text primary" onClick={dictation.acceptDownload}>{t('dict.consentOk')}</button>
        <button type="button" className="dict-text" onClick={() => { void dictation.stop(); editor.commands.focus() }}>{t('dict.cancel')}</button>
      </div>
    )
  }

  const status = s.phase === 'download' ? t('dict.download', { pct: Math.floor(s.progress * 100) })
    : s.phase === 'loading' ? t('dict.loading')
    : s.phase === 'starting' ? t('dict.starting')
    : s.phase === 'finishing' ? t('dict.finishing')
    : s.busy ? t('dict.processing') : t('dict.listening')
  const live = s.phase === 'listening'

  return (
    <div className={`dict-bar no-print${live ? ' live' : ''}`} role="status" aria-live="polite">
      {s.help && (
        <div className="dict-help">
          <div className="dict-help-title">{t('dict.commands')} · {t('dict.say')}:</div>
          {COMMAND_HELP[prefs.lang].map(([say, mark]) => <div key={say} className="dict-help-row"><span>{say}</span><b>{mark}</b></div>)}
        </div>
      )}
      <span ref={meter} className="dict-meter" aria-hidden><Mic size={17} /></span>
      <span className="dict-msg">
        {status}
        {s.phase === 'download' && <span className="dict-progress"><i style={{ width: `${s.progress * 100}%` }} /></span>}
      </span>
      <span className="dict-lang" title={t('dict.language')}>{prefs.lang.toUpperCase()}</span>
      <button type="button" className={`dict-btn${s.help ? ' on' : ''}`} title={t('dict.commands')} aria-label={t('dict.commands')} aria-pressed={s.help}
        onMouseDown={(e) => e.preventDefault()} onClick={() => dictation.toggleHelp()}><HelpCircle size={16} /></button>
      <button type="button" className="dict-btn stop" title={t('dict.stop')} aria-label={t('dict.stop')}
        onMouseDown={(e) => e.preventDefault()} onClick={() => void dictation.stop()} disabled={s.phase === 'finishing'}><Square size={13} fill="currentColor" /></button>
    </div>
  )
}
