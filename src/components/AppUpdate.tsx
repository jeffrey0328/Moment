import { useState } from 'react'
import { ArrowUpCircle, Check, Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { applyAppUpdate, checkAppUpdate, type AppUpdateCheck } from '../lib/app-update'

export function AppUpdateSection({ notify }: { notify: (message: string) => void }) {
  const [busy, setBusy] = useState<'check' | 'apply'>()
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<AppUpdateCheck>()

  const runCheck = async () => {
    setBusy('check')
    setError(undefined)
    try {
      if (!navigator.onLine) throw new Error('当前离线，无法检查应用更新')
      const next = await checkAppUpdate()
      setResult(next)
      notify(next.available ? `发现新版本 ${next.latest}` : '当前已是最新版本')
    } catch (err) {
      const message = err instanceof Error ? err.message : '暂时无法检查更新'
      setError(message)
      notify(message)
    } finally {
      setBusy(undefined)
    }
  }

  const runApply = async (update = result) => {
    if (!update) return
    setBusy('apply')
    setProgress(8)
    setError(undefined)
    try {
      await applyAppUpdate(update, setProgress)
      if (update.inAppInstall) notify('已开始安装，请按系统提示完成')
      else if (update.platform === 'web' && !update.releaseUrl && !update.downloadUrl) notify('正在刷新以加载新版本')
      else notify('已打开下载页面')
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新失败，请稍后重试'
      setError(message)
      notify(message)
    } finally {
      setBusy(undefined)
    }
  }

  const statusLabel = !result
    ? '可检查 GitHub 发布的安装包'
    : result.available
      ? `发现新版本 ${result.latest}`
      : '当前已是最新版本'

  return (
    <div className="update-card">
      <div className="update-card-head">
        <span><ArrowUpCircle /></span>
        <div>
          <strong>应用更新</strong>
          <p>{statusLabel}</p>
        </div>
      </div>
      <div className="setting-row"><span>当前版本</span><strong>{result?.current || __APP_VERSION__}</strong></div>
      {result?.available && result.notes && <p className="update-notes">{result.notes}</p>}
      {busy === 'apply' && (
        <div className="update-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <b><i style={{ width: `${progress}%` }} /></b>
          <span>正在下载 {progress}%</span>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}
      {result?.available ? (
        <button className="primary-setting" disabled={Boolean(busy)} onClick={() => void runApply()}>
          {busy === 'apply' ? <LoaderCircle className="spin" /> : <Download />}
          {result.inAppInstall ? '立即更新' : '打开下载页'}
        </button>
      ) : (
        <button className="primary-setting" disabled={Boolean(busy)} onClick={() => void runCheck()}>
          {busy === 'check' ? <LoaderCircle className="spin" /> : result && !result.available ? <Check /> : <RefreshCw />}
          {busy === 'check' ? '正在检查…' : result && !result.available ? '已是最新版本' : '检查应用更新'}
        </button>
      )}
    </div>
  )
}

export function UpdateBanner({ update, onLater, onApply }: {
  update: AppUpdateCheck
  onLater: () => void
  onApply: () => void
}) {
  return (
    <div className="update-banner">
      <ArrowUpCircle />
      <span>发现新版本 {update.latest}，可在应用内安装</span>
      <button type="button" onClick={onApply}>立即更新</button>
      <button type="button" className="update-later" onClick={onLater}>稍后</button>
    </div>
  )
}
