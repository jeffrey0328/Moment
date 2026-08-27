/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface Window {
  momentDesktop?: {
    isDesktop: true
    platform: string
    getVersion?: () => Promise<string>
    installUpdate?: (url: string) => Promise<{ ok: boolean }>
    onUpdateProgress?: (callback: (percent: number) => void) => () => void
  }
}
