/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build flag for the on-device self-test (see src/mobiletest.ts). */
  readonly VITE_GRAFI_SELFTEST?: string
}
