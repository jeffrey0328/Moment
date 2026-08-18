import { useEffect, useState } from 'react'
import { Image as ImageIcon, Mic, Video } from 'lucide-react'
import { getAttachmentBlob } from '../lib/db'
import type { Note, NoteAttachment } from '../types'

export function NoteMedia({ attachment }: { attachment: NoteAttachment }) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    let localUrl: string | undefined
    if (attachment.localKey) {
      getAttachmentBlob(attachment.localKey).then((blob) => {
        if (!blob) return
        localUrl = URL.createObjectURL(blob)
        setUrl(localUrl)
      })
    } else if (attachment.remotePath) {
      setUrl(`/api/sync/media?path=${encodeURIComponent(attachment.remotePath)}`)
    }
    return () => { if (localUrl) URL.revokeObjectURL(localUrl) }
  }, [attachment.localKey, attachment.remotePath])

  if (!url) return <div className="media-placeholder">{attachment.kind === 'image' ? <ImageIcon /> : <Video />}</div>
  return attachment.kind === 'image'
    ? <img src={url} alt={attachment.name} loading="lazy" />
    : <video src={url} controls preload="metadata" />
}

export function NotePreview({ note }: { note: Note }) {
  const title = note.text.split(/\n|[。！？]/)[0] || (note.attachments[0]?.kind === 'video' ? '视频记录' : '图片记录')
  return (
    <>
      <div className="note-preview-title">{note.source === 'voice' && <Mic size={15} />}{title.slice(0, 22)}</div>
      {note.text && <p>{note.text.slice(title.length, title.length + 70) || note.text}</p>}
      {note.attachments.length > 0 && (
        <div className="preview-media">
          {note.attachments.slice(0, 3).map((item) => <NoteMedia attachment={item} key={item.id} />)}
        </div>
      )}
    </>
  )
}

