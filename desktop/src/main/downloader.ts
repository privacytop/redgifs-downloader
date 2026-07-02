import { createWriteStream } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { randomUUID } from 'crypto'
import type {
  Content, DownloadRequest, DownloadTask, Quality, Settings
} from '../shared/types'
import type { RedgifsApi } from './api'
import type { Storage } from './storage'
import { RateLimiter } from './ratelimit'

export function extFromUrl(url: string): string {
  const path = url.split('?')[0]
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  if (dot > slash && dot !== -1) return path.slice(dot + 1)
  return 'mp4'
}

export function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_')
}

export function pickUrl(c: Content, quality: Quality): string {
  const { hd, sd } = c.urls
  if (quality === 'sd') return sd || hd || ''
  return hd || sd || ''
}

export function buildFilename(c: Content, rank: number): string {
  const ext = extFromUrl(c.urls.hd || c.urls.sd || '')
  return sanitize(`${String(rank).padStart(4, '0')}_${c.id}_${c.username}.${ext}`)
}

export interface DownloaderDeps {
  api: RedgifsApi
  storage: Storage
  onUpdate: (task: DownloadTask) => void
  onProgress: (task: DownloadTask) => void
}

export class Downloader {
  private tasks = new Map<string, DownloadTask>()
  private aborters = new Map<string, AbortController>()
  private rl = new RateLimiter(150)

  constructor(private deps: DownloaderDeps) {}

  list(): DownloadTask[] {
    return [...this.tasks.values()]
  }

  start(request: DownloadRequest): DownloadTask {
    const settings = this.deps.storage.getSettings()
    const task: DownloadTask = {
      id: randomUUID(), type: request.type, username: request.username ?? '',
      status: 'queued', progress: 0, totalItems: 0, downloaded: 0, failed: 0, skipped: 0,
      currentItem: '', downloadPath: this.pathFor(request, settings), startTime: Date.now()
    }
    this.tasks.set(task.id, task)
    this.aborters.set(task.id, new AbortController())
    void this.run(task, request, settings)
    return task
  }

  pause(id: string): void {
    const t = this.tasks.get(id)
    if (t && t.status === 'downloading') { this.setStatus(t, 'paused'); this.abort(id) }
  }

  resume(id: string): void {
    const t = this.tasks.get(id)
    if (!t || t.status !== 'paused') return
    this.aborters.set(id, new AbortController())
    const req = { type: t.type, username: t.username, quality: undefined } as DownloadRequest
    void this.run(t, req, this.deps.storage.getSettings())
  }

  cancel(id: string): void {
    const t = this.tasks.get(id)
    if (!t) return
    this.setStatus(t, 'cancelled')
    t.endTime = Date.now()
    this.abort(id)
  }

  private abort(id: string): void {
    this.aborters.get(id)?.abort()
  }

  private pathFor(req: DownloadRequest, s: Settings): string {
    if (req.targetPath) return req.targetPath
    const base = s.downloadPath
    if (req.type === 'user') return s.createUserFolders ? join(base, 'users', req.username ?? '') : join(base, req.username ?? '')
    if (req.type === 'collection') return join(base, 'collections', req.collectionId ?? '')
    if (req.type === 'likes') return join(base, 'likes')
    return base
  }

  private setStatus(t: DownloadTask, status: DownloadTask['status']): void {
    t.status = status
    this.deps.onUpdate({ ...t })
  }

  private async resolveContent(req: DownloadRequest, s: Settings): Promise<Content[]> {
    const seen = new Map<string, Content>()
    const addAll = (items: Content[]): void => { for (const c of items) if (!seen.has(c.id)) seen.set(c.id, c) }
    if (req.type === 'user') {
      const orders = req.searchOrders?.length ? req.searchOrders : s.searchOrders
      for (const order of orders) {
        let page = 1
        while (true) {
          const r = await this.deps.api.getUserContent(req.username ?? '', order, page)
          addAll(r.contents)
          if (page >= r.pages || r.contents.length === 0) break
          page++
        }
      }
    } else if (req.type === 'likes') {
      let page = 1
      while (true) {
        const r = await this.deps.api.getLikes(page)
        addAll(r.contents)
        if (page >= r.pages || r.contents.length === 0) break
        page++
      }
    } else if (req.type === 'collection') {
      let page = 1
      while (true) {
        const r = await this.deps.api.getCollectionContent(req.collectionId ?? '', page)
        addAll(r.contents)
        if (page >= r.pages || r.contents.length === 0) break
        page++
      }
    } else if (req.type === 'single') {
      for (const id of req.contentIds ?? []) addAll([await this.deps.api.getGif(id)])
    }
    return [...seen.values()]
  }

  private async run(task: DownloadTask, req: DownloadRequest, s: Settings): Promise<void> {
    this.setStatus(task, 'downloading')
    let content: Content[]
    try {
      content = await this.resolveContent(req, s)
    } catch (e) {
      task.error = (e as Error).message
      this.setStatus(task, 'failed')
      task.endTime = Date.now()
      return
    }
    task.totalItems = content.length
    const quality: Quality = req.quality ?? s.preferredQuality
    const signal = this.aborters.get(task.id)!.signal

    let index = 0
    const worker = async (): Promise<void> => {
      while (index < content.length) {
        if (signal.aborted || task.status !== 'downloading') return
        const i = index++
        const c = content[i]
        task.currentItem = c.id
        if (!s.overwriteExisting && this.deps.storage.hasDownloaded(task.username, c.id)) {
          task.skipped++
        } else {
          try {
            await this.downloadOne(task, c, i + 1, quality, s, signal, req.searchOrders?.[0] ?? s.searchOrders[0] ?? '')
            task.downloaded++
          } catch {
            task.failed++
          }
        }
        task.progress = Math.round(((task.downloaded + task.failed + task.skipped) / task.totalItems) * 100)
        this.deps.onProgress({ ...task })
      }
    }
    const pool = Array.from({ length: Math.max(1, s.maxConcurrentDownloads) }, () => worker())
    await Promise.all(pool)

    if (task.status === 'downloading') {
      this.setStatus(task, 'completed')
      task.endTime = Date.now()
    }
  }

  private async downloadOne(task: DownloadTask, c: Content, rank: number, quality: Quality,
    s: Settings, signal: AbortSignal, order: string): Promise<void> {
    const url = pickUrl(c, quality)
    if (!url) throw new Error('no url')
    await mkdir(task.downloadPath, { recursive: true })
    const filename = buildFilename(c, rank)
    const finalPath = join(task.downloadPath, filename)
    const tmpPath = finalPath + '.tmp'
    await this.rl.wait()
    const resp = await fetch(url, { signal, headers: { 'User-Agent': 'RedGifs-Downloader/4.0' } })
    if (!resp.ok || !resp.body) throw new Error(`download HTTP ${resp.status}`)
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmpPath)
      Readable.fromWeb(resp.body as any).pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
    })
    const size = (await stat(tmpPath)).size
    await rename(tmpPath, finalPath).catch(async (e) => { await rm(tmpPath, { force: true }); throw e })
    this.deps.storage.addRecord({
      username: task.username || c.username, contentId: c.id, contentName: filename,
      filePath: finalPath, fileSize: size, duration: c.duration, width: c.width, height: c.height,
      hasAudio: c.hasAudio, downloadedAt: Date.now(), thumbnail: c.urls.thumbnail ?? '',
      searchOrder: order, rank
    })
  }
}
