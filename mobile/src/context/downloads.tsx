import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import {
  buildFilename,
  pickUrl,
  sanitize,
  type Content,
  type Quality
} from '@redloader/core'
import { MediaSaver } from '../plugins/mediaSaver'
import { storage } from '../lib/storage'

export type TaskStatus = 'downloading' | 'completed' | 'failed'

export interface DownloadTask {
  id: string
  label: string
  status: TaskStatus
  total: number
  done: number
  failed: number
  current: string
  error?: string
}

interface DownloadsCtx {
  tasks: DownloadTask[]
  activeCount: number
  /** Queue an already-resolved list of clips (player Save / card long-press). */
  enqueue: (contents: Content[], label: string, quality: Quality) => void
}

const Ctx = createContext<DownloadsCtx | null>(null)

const CONCURRENCY = 3
let seq = 0

/**
 * Foreground download queue. Each task saves its clips into the phone gallery
 * (Movies/RedLoader/<creator>) via the native MediaSaver plugin, with a small
 * worker pool. Screen must stay on (a foreground service is a TODO). Reuses
 * core's filename/url helpers so files match the desktop app.
 */
export function DownloadsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const tasksRef = useRef<Map<string, DownloadTask>>(new Map())

  const flush = useCallback(() => {
    setTasks([...tasksRef.current.values()].reverse())
  }, [])

  const update = useCallback(
    (id: string, patch: Partial<DownloadTask>) => {
      const t = tasksRef.current.get(id)
      if (!t) return
      Object.assign(t, patch)
      flush()
    },
    [flush]
  )

  const enqueue = useCallback(
    (contents: Content[], label: string, quality: Quality) => {
      const id = `t${++seq}`
      const task: DownloadTask = {
        id,
        label,
        status: 'downloading',
        total: contents.length,
        done: 0,
        failed: 0,
        current: ''
      }
      tasksRef.current.set(id, task)
      flush()

      let index = 0
      const worker = async (): Promise<void> => {
        while (index < contents.length) {
          const c = contents[index++]
          const url = pickUrl(c, quality)
          update(id, { current: c.username })
          if (!url) {
            task.failed++
          } else {
            try {
              const filename = buildFilename(c, index)
              const { bytes } = await MediaSaver.download({
                url,
                filename,
                subdir: sanitize(c.username || 'redloader')
              })
              await storage.addRecord({
                username: c.username,
                contentId: c.id,
                contentName: filename,
                filePath: filename,
                fileSize: bytes,
                duration: c.duration,
                width: c.width,
                height: c.height,
                hasAudio: c.hasAudio,
                downloadedAt: Date.now(),
                thumbnail: c.urls.thumbnail ?? '',
                searchOrder: '',
                rank: index
              })
              task.done++
            } catch {
              task.failed++
            }
          }
          update(id, {})
        }
      }

      Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
        .then(() => update(id, { status: task.failed && !task.done ? 'failed' : 'completed', current: '' }))
        .catch(() => update(id, { status: 'failed' }))
    },
    [flush, update]
  )

  const activeCount = tasks.filter((t) => t.status === 'downloading').length

  return <Ctx.Provider value={{ tasks, activeCount, enqueue }}>{children}</Ctx.Provider>
}

export function useDownloads(): DownloadsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDownloads must be used within a DownloadsProvider')
  return ctx
}
