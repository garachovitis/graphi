# Graphi

Word-class word processor: one React/TipTap UI running in Electron (desktop), Capacitor (iOS/Android)
and the browser (PWA). User-facing language is Greek first, English second.

## Commands

- `npm run dev:web` — Vite dev server on port 5199 (browser only)
- `npm run dev` — Vite + Electron
- `npm run typecheck` — must pass before any change is done
- `npm run build` — production build to `dist/`
- Pagination check (dev console): `await __load(60, {tables:true, lists:true, breaks:true, images:true}); __verify()`
  → expect `badCount: 0` and no `orphanHeadings`
- Electron end-to-end: see README → «Έλεγχοι»

## Layout

- `src/platform.ts` is the only place that knows which host it runs on (Electron bridge, Capacitor, web).
  UI code calls `platform.*`, never `window.grafiNative` directly.
- `electron/main.cjs` owns file I/O. The renderer may only read/overwrite paths the user granted
  (dialogs, OS open, recent list); keep new IPC handlers behind `isGranted`.
- `src/io/*` converters work on ProseMirror JSON and are lazy-loaded (`App.tsx → io()`); keep them out of
  the startup bundle.
- `src/editor/Pagination.ts` inserts spacer decorations only — never change document content for layout.
- Test hooks (`window.__grafi`, `src/devtest.ts`, `src/mobiletest.ts`) exist only in dev or with
  `VITE_GRAFI_SELFTEST=1`; don't reference them from app code.

## Conventions

- Every user-visible string goes in both `src/i18n/el.ts` and `src/i18n/en.ts` (same key); use Word's
  Greek terminology. The Electron menus have their own strings in `electron/i18n.cjs`.
- Brand colour `#1ab3ac` (`--primary`). Colours in CSS come from the variables in `src/ui/app.css`, with
  light and dark variants.
- Fonts offered to users: Calibri, Arial, Tahoma (bundled metric-compatible Carlito / Arimo).
- A format feature is done when it survives DOCX → Graphi → DOCX and ODT → Graphi → ODT
  (compare node types and text with the files in `samples/`).
- Match the existing code style: compact TypeScript, short comments that explain *why*, no semicolons.
