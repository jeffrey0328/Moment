import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { apiUrl } from './api'

export function isNativeMobile() {
  return Capacitor.isNativePlatform()
}

export function mobileOAuthReturnUrl() {
  return isNativeMobile() ? 'com.jeffrey.moment://oauth-complete' : undefined
}

export async function initializeNativeOAuth() {
  const desktopCode = new URL(window.location.href).searchParams.get('native_code')
  if (window.momentDesktop?.isDesktop && desktopCode) {
    await redeemNativeCode(desktopCode)
    return
  }
  if (!isNativeMobile()) return
  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (url.startsWith('com.jeffrey.moment://oauth-complete')) {
      void completeNativeOAuth(url)
    }
  })
}

async function completeNativeOAuth(url: string) {
  const code = new URL(url).searchParams.get('native_code')
  if (!code) return
  await redeemNativeCode(code, true)
}

async function redeemNativeCode(code: string, closeMobileBrowser = false) {
  const response = await fetch(apiUrl('/api/auth/baidu/native-session'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (closeMobileBrowser) await Browser.close().catch(() => undefined)
  window.location.replace(response.ok ? './?baidu=connected' : './?baidu=error')
}

export async function openMobileOAuth(url: string) {
  await Browser.open({ url, presentationStyle: 'popover' })
}
