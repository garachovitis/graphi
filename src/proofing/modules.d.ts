declare module 'virtual:dict/el' { const words: string; export default words }
declare module 'virtual:dict/en' { export const aff: string; export const dic: string }
declare module 'nspell' {
  export interface NSpell { correct(word: string): boolean; suggest(word: string): string[]; add(word: string): NSpell }
  export default function nspell(aff: string, dic: string): NSpell
}
