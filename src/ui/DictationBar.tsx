// Dictation UI outside the page: the floating bar (bottom of the workspace, like Word's Dictate
// toolbar) with status, language, the voice-command list and Stop, and the one-time consent dialog
// before the speech model is downloaded.
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Mic, Square, HelpCircle, X } from 'lucide-react'
import { dictation, MODELS, useDictation, useDictPrefs } from '../dictation'
import type { ModelId } from '../dictation/model'
import { COMMAND_HELP } from '../dictation/text'
import { t, fmtNum, type Key } from '../i18n'

export function DictationBar({ editor }: { editor: Editor }) {
  const s = useDictation()
  const prefs = useDictPrefs()

  // Errors clear themselves after a while; permission problems stay until dismissed.
  useEffect(() => {
    if (!s.error || s.error === 'permission') return
    const id = setTimeout(dictation.dismissError, 9000)
    return () => clearTimeout(id)
  }, [s.error])

  if (s.phase === 'consent') return <DictationConsent mb={s.consentMb} />
  if (s.phase === 'idle' && !s.error) return null

  if (s.phase === 'idle' && s.error) {
    return (
      <div className="dict-bar error no-print" role="alert">
        <span className="dict-msg">{t(`dict.err.${s.error}` as Key)}</span>
        <button type="button" className="dict-btn" title={t('dict.close')} aria-label={t('dict.close')} onClick={dictation.dismissError}><X size={15} /></button>
      </div>
    )
  }

  const pct = Math.floor(s.progress * 100)
  const status = s.phase === 'download' ? t('dict.download', { pct })
    : s.phase === 'loading' ? t('dict.loading')
    : s.phase === 'starting' ? t('dict.starting')
    : s.phase === 'finishing' ? t('dict.finishing')
    : s.busy ? t('dict.processing') : t('dict.listening')
  const live = s.phase === 'listening'
  const keep = (e: React.MouseEvent) => e.preventDefault() // the caret stays in the document

  return (
    <div className={`dict-bar no-print${live ? ' live' : ''}`} role="status" aria-live="polite">
      {s.help && (
        <div className="dict-help">
          <div className="dict-help-title">{t('dict.commands')} · {t('dict.say')}:</div>
          {COMMAND_HELP[prefs.lang].map(([say, mark]) => <div key={say} className="dict-help-row"><span>{say}</span><b>{mark}</b></div>)}
        </div>
      )}
      <span className="dict-meter" aria-hidden><Mic size={17} /></span>
      <span className="dict-msg">
        {status}
        {(s.phase === 'download' || s.phase === 'loading') && <span className="dict-progress"><i style={{ width: `${s.phase === 'loading' ? 100 : pct}%` }} /></span>}
      </span>
      <button type="button" className="dict-lang" title={t('dict.language')} onMouseDown={keep}
        onClick={() => { dictation.setPrefs({ lang: prefs.lang === 'el' ? 'en' : 'el' }); editor.commands.focus() }}>{prefs.lang.toUpperCase()}</button>
      <button type="button" className={`dict-btn${s.help ? ' on' : ''}`} title={t('dict.commands')} aria-label={t('dict.commands')} aria-pressed={s.help}
        onMouseDown={keep} onClick={() => dictation.toggleHelp()}><HelpCircle size={16} /></button>
      <button type="button" className="dict-btn stop" title={t('dict.stop')} aria-label={t('dict.stop')}
        onMouseDown={keep} onClick={() => void dictation.stop()} disabled={s.phase === 'finishing'}><Square size={13} fill="currentColor" /></button>
    </div>
  )
}

const mbText = (mb: number) => (mb >= 1000 ? `${fmtNum(Math.round(mb / 100) / 10)} GB` : `${Math.round(mb / 10) * 10} MB`)

/** "Download a speech model from a third party?" — shown whenever the chosen model is not on this device yet. */
function DictationConsent({ mb }: { mb: Record<ModelId, number> }) {
  const [pick, setPick] = useState<ModelId>(dictation.prefs.model)
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => { ok.current?.focus() }, [])
  const m = MODELS[pick]
  return (
    <div className="modal-backdrop app-chrome" onMouseDown={(e) => { if (e.target === e.currentTarget) dictation.declineDownload() }}>
      <div className="modal dict-consent" role="dialog" aria-modal="true" aria-labelledby="dict-consent-title" style={{ width: 420 }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); dictation.declineDownload() } }}>
        <div className="modal-body">
          <span className="dict-consent-icon" aria-hidden><Mic size={20} /></span>
          <h3 id="dict-consent-title">{t('dict.consentTitle')}</h3>
          <p>{t('dict.consentLead')}</p>
          <div className="dict-models" role="radiogroup" aria-label={t('dict.model')}>
            {(['lite', 'best'] as const).map((id) => (
              <button key={id} type="button" role="radio" aria-checked={pick === id} className={`dict-model${pick === id ? ' on' : ''}`} onClick={() => setPick(id)}>
                <span className="dict-model-name">{t(`dict.model.${id}`)}</span>
                <span className="dict-model-size">{mb[id] > 1 ? mbText(mb[id]) : t('dict.modelReady')}</span>
                <small>{t(`dict.model.${id}Hint`)}</small>
              </button>
            ))}
          </div>
          <small>{m.name} · {m.provider} · {m.license} · {t('dict.consentPrivate')}</small>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={dictation.declineDownload}>{t('dict.cancel')}</button>
          <button ref={ok} className="btn primary" onClick={() => void dictation.acceptDownload(pick)}>{t(mb[pick] > 1 ? 'dict.consentOk' : 'dict.dictate')}</button>
        </div>
      </div>
    </div>
  )
}
