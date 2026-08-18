import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, Check, ChevronLeft, Cloud, CloudOff, FileText, LoaderCircle, Menu,
  MoreHorizontal, RefreshCw, Search, Settings, Sparkles, WifiOff, X,
} from 'lucide-react'
import { Composer } from './components/Composer'
import { NoteMedia, NotePreview } from './components/NoteContent'
import { getMeta, listNotes, putNote } from './lib/db'
import { connectBaidu, disconnectBaidu, getCloudStatus, syncNow } from './lib/sync'
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
      if (!silent) notify('已同步至百度网盘')
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
    : phase === 'synced' ? '已同步至百度网盘'
      : phase === 'offline' ? '离线可用'
        : phase === 'error' ? '同步遇到问题'
          : cloud.connected ? '自动同步' : cloud.configured ? '连接百度网盘' : '完成网盘配置'

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
                <div className="detail-meta"><div><time>{formatTime(selected.createdAt)}</time><span>{dayKey(new Date(selected.createdAt))}</span></div><span className="cloud-state"><Check />{selected.attachments.every((item) => item.remotePath) && cloud.connected ? '已同步至百度网盘' : '已保存在本机'}</span><button className="more-button" aria-label="更多操作"><MoreHorizontal /></button></div>
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

      {settingsOpen && <SettingsPanel cloud={cloud} lastSync={lastSync} phase={phase} onClose={() => setSettingsOpen(false)} onConnect={connectBaidu} onDisconnect={async () => { await disconnectBaidu(); setCloud((value) => ({ ...value, connected: false })); notify('已断开百度网盘') }} onSync={() => void runSync()} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function SettingsPanel({ cloud, lastSync, phase, onClose, onConnect, onDisconnect, onSync }: {
  cloud: CloudStatus; lastSync?: string; phase: SyncPhase; onClose: () => void; onConnect: () => void; onDisconnect: () => Promise<void>; onSync: () => void
}) {
  return (
    <div className="modal-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="settings-panel">
        <header><button onClick={onClose}><ChevronLeft /></button><div><h2>同步设置</h2><p>让每台设备看到同一份记录</p></div><button onClick={onClose}><X /></button></header>
        <div className="cloud-hero"><span><Cloud /></span><div><strong>百度网盘</strong><p>{cloud.connected ? cloud.accountName || '已安全连接' : cloud.configured ? '等待账号授权' : '服务端尚未配置应用凭证'}</p></div><i className={cloud.connected ? 'connected' : ''}>{cloud.connected ? '已连接' : '未连接'}</i></div>
        {!cloud.configured && <div className="setup-help"><strong>需要完成一次服务端配置</strong><p>复制项目中的 <code>.env.example</code> 为 <code>.env</code>，填写开放平台的 App Key、Secret、回调地址和随机加密密钥，然后重启服务。</p></div>}
        <div className="setting-row"><span>同步目录</span><strong>{cloud.remoteDir || '/apps/拾光记'}</strong></div>
        <div className="setting-row"><span>同步方式</span><strong>新内容自动上传</strong></div>
        <div className="setting-row"><span>最近同步</span><strong>{lastSync ? new Date(lastSync).toLocaleString('zh-CN') : '尚未同步'}</strong></div>
        {cloud.connected ? <><button className="primary-setting" disabled={phase === 'syncing'} onClick={onSync}>{phase === 'syncing' ? <LoaderCircle className="spin" /> : <RefreshCw />}立即检查更新</button><button className="disconnect" onClick={() => void onDisconnect()}>断开账号</button></> : <button className="primary-setting" disabled={!cloud.configured} onClick={onConnect}><Cloud />连接百度网盘</button>}
        <p className="privacy-note">记录内容只保存在你的浏览器和你授权的百度网盘目录中。应用不会把网盘令牌暴露给前端。</p>
      </section>
    </div>
  )
}

