// File kinds — kept tiny so the UI can use it without loading the heavy converters.
import { t, type Key } from '../i18n'

export type Kind = 'docx' | 'odt' | 'grafi' | 'html' | 'md' | 'txt' | 'pdf'

const fmt = (kind: Kind, lossless?: boolean) => ({ kind, ext: kind, lossless, get label() { return t(`fmt.${kind}` as Key) } })
export const SAVE_FORMATS: { kind: Kind; readonly label: string; ext: string; lossless?: boolean }[] = [
  fmt('docx'), fmt('odt'), fmt('grafi', true), fmt('pdf'), fmt('html'), fmt('md'), fmt('txt'),
]

export function kindOf(name: string): Kind | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'htm') return 'html'
  if (ext === 'markdown') return 'md'
  if (ext === 'worder') return 'grafi' // files from the earlier name
  return (['docx', 'odt', 'grafi', 'html', 'md', 'txt', 'pdf'] as Kind[]).includes(ext as Kind) ? (ext as Kind) : null
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

