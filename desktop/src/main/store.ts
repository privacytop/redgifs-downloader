import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_SETTINGS,
  type DownloadRecord,
  type Settings,
  type Statistics
} from '../shared/types'

interface StoreData {
  settings: Settings
  userToken?: string
  history: DownloadRecord[]
  nextRecordId: number
}

/**
 * Simple atomic JSON persistence for settings, the captured user token and
 * download history. Kept behind this class so a SQLite backend can replace it
 * later without touching callers.
 */
export class Store {
  private file: string
  private data: StoreData

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'redgifs-data.json')
    this.data = this.load()
  }

  private load(): StoreData {
    const defaults: StoreData = {
      settings: {
        ...DEFAULT_SETTINGS,
        downloadPath: join(app.getPath('downloads'), 'RedGifs')
      },
      history: [],
      nextRecordId: 1
    }
    if (!existsSync(this.file)) return defaults
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<StoreData>
      return {
        settings: { ...defaults.settings, ...(parsed.settings ?? {}) },
        userToken: parsed.userToken,
        history: parsed.history ?? [],
        nextRecordId: parsed.nextRecordId ?? (parsed.history?.length ?? 0) + 1
      }
    } catch {
      return defaults
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    renameSync(tmp, this.file)
  }

  getSettings(): Settings {
    return this.data.settings
  }

  updateSettings(settings: Settings): void {
    this.data.settings = { ...this.data.settings, ...settings }
    this.save()
  }

  getUserToken(): string | undefined {
    return this.data.userToken
  }

  setUserToken(token: string): void {
    this.data.userToken = token
    this.save()
  }

  clearUserToken(): void {
    this.data.userToken = undefined
    this.save()
  }

  hasDownloaded(username: string, contentId: string): boolean {
    return this.data.history.some(
      (r) => r.contentId === contentId && (username === '' || r.username === username)
    )
  }

  addRecord(record: Omit<DownloadRecord, 'id'>): DownloadRecord {
    const full: DownloadRecord = { ...record, id: this.data.nextRecordId++ }
    this.data.history.push(full)
    this.save()
    return full
  }

  getHistory(username?: string, limit = 100): DownloadRecord[] {
    let rows = this.data.history
    if (username) rows = rows.filter((r) => r.username === username)
    return rows.slice().sort((a, b) => b.downloadedAt - a.downloadedAt).slice(0, limit)
  }

  getStats(): Statistics {
    const history = this.data.history
    const byUser = new Map<string, { downloads: number; size: number }>()
    let totalSize = 0
    for (const r of history) {
      totalSize += r.fileSize
      const u = byUser.get(r.username) ?? { downloads: 0, size: 0 }
      u.downloads++
      u.size += r.fileSize
      byUser.set(r.username, u)
    }
    const topUsers = [...byUser.entries()]
      .map(([username, v]) => ({ username, ...v }))
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 5)
    return {
      totalDownloads: history.length,
      totalSize,
      totalUsers: byUser.size,
      totalCollections: 0,
      recentDownloads: this.getHistory(undefined, 10),
      topUsers
    }
  }
}
