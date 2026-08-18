import { useEffect, useRef, useState } from 'react'
import { Image, Mic, MicOff, Paperclip, Send, Video, X } from 'lucide-react'
import type { Note, NoteAttachment } from '../types'
import { putAttachmentBlob, putNote } from '../lib/db'

interface SpeechRecognitionEventLike extends Event {
  results: { [index: number]: { [index: number]: { transcript: string }; isFinal: boolean }; length: number }
  resultIndex: number
}

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

type PendingFile = { id: string; file: File; url: string; kind: 'image' | 'video' }

interface ComposerProps {
  compact?: boolean
  expanded?: boolean
  onExpand?: () => void
  onSaved: (note: Note) => void
  notify: (message: string) => void
}

export function Composer({ compact, expanded = true, onExpand, onSaved, notify }: ComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [listening, setListening] = useState(false)
  const [usedVoice, setUsedVoice] = useState(false)
  const [saving, setSaving] = useState(false)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const acceptMode = useRef<'image/*' | 'video/*' | 'image/*,video/*'>('image/*,video/*')

  useEffect(() => () => files.forEach((item) => URL.revokeObjectURL(item.url)), [files])

  const chooseFiles = (accept: typeof acceptMode.current) => {
    acceptMode.current = accept
    if (fileInput.current) {
      fileInput.current.accept = accept
      fileInput.current.click()
    }
  }

  const handleFiles = (selected: FileList | null) => {
    if (!selected) return
    const next = [...selected].filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/')).map((file) => ({
      id: crypto.randomUUID(), file, url: URL.createObjectURL(file), kind: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
    }))
    setFiles((current) => [...current, ...next])
  }

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop()
      setListening(false)
      return
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) {
      notify('当前浏览器不支持语音转文字，请使用最新版 Chrome、Edge 或 Safari')
      return
    }
    const instance = new Recognition()
    instance.lang = 'zh-CN'
    instance.continuous = true
    instance.interimResults = true
    let finalized = ''
    instance.onresult = (event) => {
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript
        if (event.results[index].isFinal) finalized += transcript
        else interim += transcript
      }
      setText((current) => `${current.replace(/\s*\[正在听….*\]$/, '')}${finalized}${interim ? ` [正在听…${interim}]` : ''}`)
      finalized = ''
    }
    instance.onend = () => {
      setListening(false)
      setText((current) => current.replace(/\s*\[正在听….*\]$/, ''))
    }
    instance.onerror = () => {
      setListening(false)
      notify('没有听清，请检查麦克风权限后再试')
    }
    recognition.current = instance
    instance.start()
    setUsedVoice(true)
    setListening(true)
  }

  const save = async () => {
    const cleanText = text.replace(/\s*\[正在听….*\]$/, '').trim()
    if (!cleanText && files.length === 0) return
    setSaving(true)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const attachments: NoteAttachment[] = files.map((item) => ({
      id: item.id,
      name: item.file.name,
      mime: item.file.type,
      size: item.file.size,
      kind: item.kind,
      localKey: `${id}:${item.id}`,
    }))
    const note: Note = { id, text: cleanText, createdAt: now, updatedAt: now, source: usedVoice ? 'voice' : 'typed', attachments }
    await Promise.all(files.map((item) => putAttachmentBlob(`${id}:${item.id}`, item.file)))
    await putNote(note)
    recognition.current?.stop()
    files.forEach((item) => URL.revokeObjectURL(item.url))
    setText('')
    setFiles([])
    setUsedVoice(false)
    setSaving(false)
    onSaved(note)
  }

  if (compact && !expanded) {
    return (
      <button className="mobile-capture-collapsed" onClick={onExpand}>
        <span>记下此刻</span><small>想到什么，就记下来…</small><span className="capture-mini"><Send size={20} /></span>
      </button>
    )
  }

  return (
    <section className={`composer ${compact ? 'composer-mobile' : ''}`} aria-label="新建记录">
      {compact && <button className="composer-close" onClick={onExpand} aria-label="收起"><X size={18} /></button>}
      <div className="composer-heading">记下此刻</div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="想到什么，就记下来…" rows={compact ? 3 : 4} autoFocus={compact} />
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((item) => (
            <div className="pending-file" key={item.id}>
              {item.kind === 'image' ? <img src={item.url} alt="待上传图片" /> : <video src={item.url} muted />}
              <button onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))} aria-label="移除附件"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-actions">
        <div className="composer-tools">
          <button className={listening ? 'active recording' : ''} onClick={toggleVoice}>{listening ? <MicOff /> : <Mic />}<span>{listening ? '停止' : '语音'}</span></button>
          <button onClick={() => chooseFiles('image/*')}><Image /><span>图片</span></button>
          <button onClick={() => chooseFiles('video/*')}><Video /><span>视频</span></button>
          <button className="paperclip" onClick={() => chooseFiles('image/*,video/*')} aria-label="添加附件"><Paperclip /></button>
        </div>
        <button className="save-note" disabled={saving || (!text.trim() && files.length === 0)} onClick={save} aria-label="保存记录"><Send /></button>
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
    </section>
  )
}
