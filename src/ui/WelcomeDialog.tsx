import { useEffect, useRef } from 'react'
import { ArrowRight, GraduationCap, PenLine, X } from 'lucide-react'
import { t } from '../i18n'

export function WelcomeDialog({ onTraining, onClose }: { onTraining: () => void; onClose: () => void }) {
  const primary = useRef<HTMLButtonElement>(null)

  useEffect(() => { primary.current?.focus() }, [])

  return (
    <div className="welcome-backdrop app-chrome" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <button className="welcome-x" onClick={onClose} aria-label={t('common.close')}><X size={19} /></button>

        <div className="welcome-art" aria-hidden="true">
          <span className="welcome-orb orb-one" />
          <span className="welcome-orb orb-two" />
          <span className="welcome-logo"><img src="./icons/logo-mark.png" alt="" draggable={false} /></span>
          <span className="welcome-card card-one"><PenLine size={25} /></span>
          <span className="welcome-card card-two"><GraduationCap size={27} /></span>
        </div>

        <div className="welcome-content">
          <span className="welcome-kicker">{t('welcome.kicker')}</span>
          <h1 id="welcome-title">{t('welcome.title')}</h1>
          <p className="welcome-copy">{t('welcome.body')}</p>
          <div className="welcome-actions">
            <button ref={primary} className="welcome-primary" onClick={onTraining}>
              <GraduationCap size={19} /> {t('welcome.start')} <ArrowRight size={17} />
            </button>
            <button className="welcome-secondary" onClick={onClose}>{t('welcome.later')}</button>
          </div>
          <small className="welcome-hint">{t('welcome.hint')}</small>
        </div>
      </div>
    </div>
  )
}
