import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CalendarDays, Check, ChevronLeft, Cloud, CloudOff, FileText, LoaderCircle, Menu,
  MoreHorizontal, RefreshCw, Search, Settings, Sparkles, WifiOff, X,
} from 'lucide-react'
import { Composer } from './components/Composer'
import { NoteMedia, NotePreview } from './components/NoteContent'
import { getMeta, listNotes, putNote } from './lib/db'
import { getCloudStatus, loginAccount, logoutAccount, registerAccount, syncNow } from './lib/sync'
import type { CloudStatus, Note, SyncPhase } from './types'

const navItems = [
  { key: 'all', label: '全部记录', icon: FileText },
  { key: 'today', label: '今天', icon: CalendarDays },
  { key: 'yesterday', label: '昨天', icon: RefreshCw },
] as const

function dayKey(date: Date) {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const local = date.toDateString()
  if (local === now.toDateString()) return '今天'
  if (local === yesterday.toDateString()) return '昨天'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [activeFilter, setActiveFilter] = useState<'all' | 'today' | 'yesterday'>('all')
  const [query, setQuery] = useState('')
  const [cloud, setCloud] = useState<CloudStatus>({ configured: false, connected: false })
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [syncProgress, setSyncProgress] = useState(0)
  const [lastSync, setLastSync] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileComposer, setMobileComposer] = useState(false)
  const [toast, setToast] = useState<string>()

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(undefined), 3200)
  }, [])

  const runSync = useCallback(async (silent = false) => {
    if (!navigator.onLine) {
      setPhase('offline')
      if (!silent) notify('当前离线，记录已安全保存在这台设备')
      return
    }
    if (!cloud.configured) {
      setPhase('unconfigured')
      if (!silent) setSettingsOpen(true)
      return
    }
    if (!cloud.connected) {
      setPhase('idle')
      if (!silent) setSettingsOpen(true)
      return
    }
    setPhase('syncing')
    setSyncProgress(8)
    try {
      const merged = await syncNow(setSyncProgress)
      setNotes(merged)
      setSelectedId((current) => current || merged[0]?.id)
      const now = new Date().toISOString()
      setLastSync(now)
      setPhase('synced')
      if (!silent) notify('已同步至阿里云 OSS')
    } catch (error) {
      setPhase('error')
      if (!silent) notify(error instanceof Error ? error.message : '同步失败，请稍后重试')
    }
  }, [cloud.configured, cloud.connected, notify])

  useEffect(() => {
    Promise.all([listNotes(), getCloudStatus(), getMeta<string>('lastSyncAt')]).then(([stored, status, syncedAt]) => {
      setNotes(stored)
      setSelectedId(stored[0]?.id)
      setCloud(status)
      setLastSync(syncedAt)
      if (!navigator.onLine) setPhase('offline')
      else if (!status.configured) setPhase('unconfigured')
      else if (status.connected) {
        setPhase('idle')
        window.setTimeout(() => {
          setPhase('syncing')
          setSyncProgress(8)
          syncNow(setSyncProgress).then((merged) => {
            setNotes(merged)
            setSelectedId((current) => current || merged[0]?.id)
            setLastSync(new Date().toISOString())
            setPhase('synced')
          }).catch(() => setPhase('error'))
        }, 350)
      }
    }).catch(() => notify('本地数据读取失败，请刷新页面重试'))
  }, [notify])

  useEffect(() => {
    const online = () => {
      setPhase('idle')
      if (cloud.connected) void runSync(true)
    }
    const offline = () => setPhase('offline')
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [cloud.connected, runSync])

  const filteredNotes = useMemo(() => notes.filter((note) => {
    const date = new Date(note.createdAt)
    const label = dayKey(date)
    const filterMatch = activeFilter === 'all' || (activeFilter === 'today' && label === '今天') || (activeFilter === 'yesterday' && label === '昨天')
    const queryMatch = !query || note.text.toLowerCase().includes(query.toLowerCase()) || note.attachments.some((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    return filterMatch && queryMatch
  }), [notes, activeFilter, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, Note[]>()
    filteredNotes.forEach((note) => {
      const key = dayKey(new Date(note.createdAt))
      groups.set(key, [...(groups.get(key) || []), note])
    })
    return [...groups.entries()]
  }, [filteredNotes])

  const selected = notes.find((note) => note.id === selectedId)

  const noteSaved = async (note: Note) => {
    setNotes((current) => [note, ...current])
    setSelectedId(note.id)
    setMobileComposer(false)
    notify('已保存在本机，正在上传…')
    if (cloud.connected) await runSync(true)
  }

  const removeNote = async (note: Note) => {
    const deleted = { ...note, updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString() }
    await putNote(deleted)
    setNotes((current) => current.filter((item) => item.id !== note.id))
    setSelectedId(notes.find((item) => item.id !== note.id)?.id)
    if (cloud.connected) void runSync(true)
  }

  const syncLabel = phase === 'syncing' ? `正在同步 ${syncProgress}%`
    : phase === 'synced' ? '已同步至阿里云 OSS'
      : phase === 'offline' ? '离线可用'
        : phase === 'error' ? '同步遇到问题'
          : cloud.connected ? '自动同步' : cloud.configured ? '登录同步账号' : '完成云存储配置'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Sparkles size={20} /></span><strong>拾光记</strong></div>
        <nav>
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={activeFilter === key ? 'active' : ''} onClick={() => setActiveFilter(key)}><Icon /><span>{label}</span></button>
          ))}
        </nav>
        <button className="settings-link" onClick={() => setSettingsOpen(true)}><Settings /><span>设置</span></button>
        <div className="offline-note"><CloudOff /><div><strong>离线可用</strong><small>先保存，联网后同步</small></div></div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSettingsOpen(true)} aria-label="设置"><Menu /></button>
          <div className="mobile-brand">拾光记</div>
          <label className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录" /></label>
          <button className={`sync-button ${phase}`} onClick={() => void runSync()}>
            {phase === 'syncing' ? <LoaderCircle className="spin" /> : phase === 'offline' ? <WifiOff /> : phase === 'synced' ? <Check /> : <Cloud />}
            <span>{syncLabel}</span>
            {cloud.connected && <i />}
          </button>
          <button className="mobile-settings" onClick={() => setSettingsOpen(true)} aria-label="设置"><Settings /></button>
        </header>

        <div className="content-grid">
          <section className="note-rail" aria-label="记录列表">
            {grouped.length === 0 ? (
              <div className="empty-state"><span><Sparkles /></span><h2>还没有记录</h2><p>想到什么就写下来，图片和视频也可以。</p><button onClick={() => setMobileComposer(true)}>记下第一条</button></div>
            ) : grouped.map(([label, items]) => (
              <div className="day-group" key={label}>
                <h2>{label}</h2>
                {items.map((note) => (
                  <button className={`note-preview ${selectedId === note.id ? 'selected' : ''}`} key={note.id} onClick={() => setSelectedId(note.id)}>
                    <time>{formatTime(note.createdAt)}</time>
                    <NotePreview note={note} />
                  </button>
                ))}
              </div>
            ))}
          </section>

          <section className="detail-pane">
            <Composer onSaved={noteSaved} notify={notify} />
            {selected ? (
              <article className="note-detail">
                <div className="detail-meta"><div><time>{formatTime(selected.createdAt)}</time><span>{dayKey(new Date(selected.createdAt))}</span></div><span className="cloud-state"><Check />{selected.attachments.every((item) => item.remotePath) && cloud.connected ? '已同步至阿里云 OSS' : '已保存在本机'}</span><button className="more-button" aria-label="更多操作"><MoreHorizontal /></button></div>
                <div className="detail-body">
                  <p>{selected.text || (selected.attachments.some((item) => item.kind === 'video') ? '视频记录' : '图片记录')}</p>
                  {selected.attachments.length > 0 && <div className="detail-media">{selected.attachments.map((item) => <NoteMedia key={item.id} attachment={item} />)}</div>}
                </div>
                <button className="delete-note" onClick={() => void removeNote(selected)}>删除这条记录</button>
              </article>
            ) : <div className="detail-placeholder"><Sparkles /><p>选择一条记录，在这里查看完整内容</p></div>}
          </section>
        </div>
      </main>

      <div className={`mobile-composer-wrap ${mobileComposer ? 'expanded' : ''}`}>
        <Composer compact expanded={mobileComposer} onExpand={() => setMobileComposer((value) => !value)} onSaved={noteSaved} notify={notify} />
      </div>

      <nav className="mobile-nav">
        {navItems.map(({ key, label, icon: Icon }) => <button className={activeFilter === key ? 'active' : ''} onClick={() => setActiveFilter(key)} key={key}><Icon /><span>{label}</span></button>)}
        <button onClick={() => setSettingsOpen(true)}><Settings /><span>设置</span></button>
      </nav>

      {settingsOpen && (
        <SettingsPanel
          cloud={cloud}
          lastSync={lastSync}
          phase={phase}
          onClose={() => setSettingsOpen(false)}
          onLoggedIn={(status) => {
            setCloud(status)
            notify('已登录同步账号')
            void runSync(true)
          }}
          onDisconnect={async () => {
            await logoutAccount()
            setCloud((value) => ({ ...value, connected: false, accountName: undefined }))
            notify('已退出同步账号')
          }}
          onSync={() => void runSync()}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function SettingsPanel({ cloud, lastSync, phase, onClose, onLoggedIn, onDisconnect, onSync }: {
  cloud: CloudStatus
  lastSync?: string
  phase: SyncPhase
  onClose: () => void
  onLoggedIn: (status: CloudStatus) => void
  onDisconnect: () => Promise<void>
  onSync: () => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const result = mode === 'register'
        ? await registerAccount(username, password, inviteCode)
        : await loginAccount(username, password)
      onLoggedIn({
        configured: true,
        connected: true,
        accountName: result.accountName || username,
        remoteDir: result.remoteDir,
        inviteRequired: cloud.inviteRequired,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const heroDetail = cloud.connected
    ? cloud.accountName || '已安全连接'
    : cloud.configured
      ? '使用同一账号即可在手机和电脑间同步'
      : '服务端尚未配置 OSS 凭证'

  return (
    <div className="modal-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="settings-panel">
        <header><button onClick={onClose}><ChevronLeft /></button><div><h2>同步设置</h2><p>让每台设备看到同一份记录</p></div><button onClick={onClose}><X /></button></header>
        <div className="cloud-hero"><span><Cloud /></span><div><strong>阿里云 OSS</strong><p>{heroDetail}</p></div><i className={cloud.connected ? 'connected' : ''}>{cloud.connected ? '已连接' : '未连接'}</i></div>
        {!cloud.configured && <div className="setup-help"><strong>需要完成一次服务端配置</strong><p>网页请复制 <code>.env.example</code> 为 <code>.env</code>，填写阿里云 OSS 与 <code>APP_SECRET</code> 后重启服务。手机或桌面安装包还要在构建时设置 <code>VITE_API_BASE_URL</code> 指向该 HTTPS 后端，否则只能离线使用。</p></div>}
        <div className="setting-row"><span>对象前缀</span><strong>{cloud.remoteDir || 'oss://bucket/shiguang/&lt;账号&gt;/'}</strong></div>
        <div className="setting-row"><span>同步方式</span><strong>新内容自动上传</strong></div>
        <div className="setting-row"><span>最近同步</span><strong>{lastSync ? new Date(lastSync).toLocaleString('zh-CN') : '尚未同步'}</strong></div>
        {cloud.connected ? (
          <>
            <button className="primary-setting" disabled={phase === 'syncing'} onClick={onSync}>{phase === 'syncing' ? <LoaderCircle className="spin" /> : <RefreshCw />}立即检查更新</button>
            <button className="disconnect" onClick={() => void onDisconnect()}>退出账号</button>
          </>
        ) : cloud.configured ? (
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={2} maxLength={32} /></label>
            <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} /></label>
            {mode === 'register' && cloud.inviteRequired && <label>邀请码<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" required /></label>}
            {error && <p className="auth-error">{error}</p>}
            <button className="primary-setting" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" /> : <Cloud />}{mode === 'register' ? '注册并同步' : '登录并同步'}</button>
            <button className="auth-switch" type="button" onClick={() => { setMode((value) => value === 'login' ? 'register' : 'login'); setError(undefined) }}>{mode === 'login' ? '没有账号？注册一个' : '已有账号？去登录'}</button>
          </form>
        ) : (
          <button className="primary-setting" disabled><Cloud />登录同步账号</button>
        )}
        <p className="privacy-note">记录先保存在你的设备，登录后写入你在服务端配置的阿里云 OSS 私有 Bucket，并按账号前缀隔离。OSS 密钥只留在服务端，安装包和浏览器都拿不到。</p>
      </section>
    </div>
  )
}
