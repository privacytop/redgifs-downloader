import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { buildFilename, pickUrl, sanitize, type Content, type Quality } from '@redloader/core'
import {
  MediaSaver,
  type NativeDownloadItem,
  type NativeDownloadTask
} from '../plugins/mediaSaver'
import { storage } from '../lib/storage'

export type TaskStatus = 'downloading' | 'completed' | 'failed' | 'cancelled'

export interface DownloadTask {
  id: string
  label: string
  status: TaskStatus
  createdAt: number
  total: number
  done: number
  failed: number
  current: string
  error?: string
}

interface DownloadsCtx {
  tasks: DownloadTask[]
  activeCount: number
  enqueue: (contents: Content[], label: string, quality: Quality) => void
  cancel: (id: string) => void
  retry: (id: string) => void
}

const Ctx = createContext<DownloadsCtx | null>(null)
let seq = 0

function publicTask(task: NativeDownloadTask): DownloadTask {
  return {
    id: task.id,
    label: task.label,
    status: task.status === 'queued' ? 'downloading' : task.status,
    createdAt: task.createdAt,
    total: task.total,
    done: task.done,
    failed: task.failed,
    current: task.current,
    error: task.error
  }
}

/** Native foreground download queue restored from Android task snapshots. */
export function DownloadsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const tasksRef = useRef<Map<string, DownloadTask>>(new Map())
  const indexed = useRef<Set<string>>(new Set())

  const flush = useCallback(() => {
    setTasks(
      [...tasksRef.current.values()].sort((a, b) => b.createdAt - a.createdAt)
    )
  }, [])

  const indexCompleted = useCallback(async (task: NativeDownloadTask): Promise<void> => {
    for (const item of task.items ?? []) {
      if (item.status !== 'completed') continue
      const key = `${task.id}:${item.contentId}`
      if (indexed.current.has(key)) continue
      try {
        await storage.addRecord({
          username: item.username,
          contentId: item.contentId,
          contentName: item.filename,
          filePath: item.uri ?? item.filename,
          fileSize: item.bytes ?? 0,
          duration: item.duration,
          width: item.width,
          height: item.height,
          hasAudio: item.hasAudio,
          downloadedAt: item.completedAt ?? Date.now(),
          thumbnail: item.thumbnail,
          searchOrder: '',
          rank: item.rank
        })
        indexed.current.add(key)
      } catch {
        // Leave it unmarked so the next task snapshot retries the local index.
      }
    }
  }, [])

  const accept = useCallback(
    (nativeTask: NativeDownloadTask) => {
      tasksRef.current.set(nativeTask.id, publicTask(nativeTask))
      flush()
      void indexCompleted(nativeTask)
    },
    [flush, indexCompleted]
  )

  useEffect(() => {
    let alive = true
    let remove: (() => Promise<void>) | undefined
    void MediaSaver.addListener('taskChanged', (task) => {
      if (alive) accept(task)
    }).then((handle) => {
      remove = () => handle.remove()
    })
    void MediaSaver.listTasks().then(({ tasks: restored }) => {
      if (!alive) return
      for (const task of restored) accept(task)
    })
    return () => {
      alive = false
      if (remove) void remove()
    }
  }, [accept])

  const enqueue = useCallback(
    (contents: Content[], label: string, quality: Quality) => {
      if (!contents.length) return
      const id = `download-${Date.now()}-${++seq}`
      const createdAt = Date.now()
      const items: NativeDownloadItem[] = contents.map((content, index) => ({
        url: pickUrl(content, quality) ?? '',
        filename: buildFilename(content, index + 1),
        subdir: sanitize(content.username || 'redloader'),
        contentId: content.id,
        username: content.username,
        duration: content.duration,
        width: content.width,
        height: content.height,
        hasAudio: content.hasAudio,
        thumbnail: content.urls.thumbnail ?? '',
        rank: index + 1
      }))
      tasksRef.current.set(id, {
        id,
        label,
        status: 'downloading',
        createdAt,
        total: items.length,
        done: 0,
        failed: 0,
        current: ''
      })
      flush()
      void (async () => {
        try {
          await MediaSaver.requestNotificationPermission()
          accept(await MediaSaver.startTask({ id, label, items }))
        } catch (error) {
          const task = tasksRef.current.get(id)
          if (!task) return
          task.status = 'failed'
          task.error = error instanceof Error ? error.message : String(error)
          flush()
        }
      })()
    },
    [accept, flush]
  )

  const cancel = useCallback((id: string) => {
    void MediaSaver.cancelTask({ id })
  }, [])

  const retry = useCallback((id: string) => {
    const task = tasksRef.current.get(id)
    if (task) {
      task.status = 'downloading'
      task.error = undefined
      flush()
    }
    void MediaSaver.retryTask({ id }).catch((error) => {
      const current = tasksRef.current.get(id)
      if (!current) return
      current.status = 'failed'
      current.error = error instanceof Error ? error.message : String(error)
      flush()
    })
  }, [flush])

  const activeCount = tasks.filter((task) => task.status === 'downloading').length
  return (
    <Ctx.Provider value={{ tasks, activeCount, enqueue, cancel, retry }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDownloads(): DownloadsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDownloads must be used within a DownloadsProvider')
  return ctx
}
