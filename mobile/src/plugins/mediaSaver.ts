import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativeTaskStatus = 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled'
export type NativeItemStatus = 'queued' | 'downloading' | 'completed' | 'failed'

export interface NativeDownloadItem {
  url: string
  filename: string
  subdir: string
  contentId: string
  username: string
  duration: number
  width: number
  height: number
  hasAudio: boolean
  thumbnail: string
  rank: number
  status?: NativeItemStatus
  uri?: string
  bytes?: number
  completedAt?: number
  error?: string
}

export interface NativeDownloadTask {
  id: string
  label: string
  status: NativeTaskStatus
  createdAt: number
  total: number
  done: number
  failed: number
  current: string
  error?: string
  items: NativeDownloadItem[]
}

interface MediaSaverPlugin {
  startTask(options: { id: string; label: string; items: NativeDownloadItem[] }): Promise<NativeDownloadTask>
  listTasks(): Promise<{ tasks: NativeDownloadTask[] }>
  cancelTask(options: { id: string }): Promise<void>
  retryTask(options: { id: string }): Promise<void>
  /** Delete a finished task snapshot from the native store (rejects for active tasks). */
  removeTask(options: { id: string }): Promise<void>
  /** Fire an ACTION_VIEW intent for a content:// or file:// uri. */
  open(options: { uri: string; mime?: string }): Promise<void>
  requestNotificationPermission(): Promise<void>
  addListener(
    event: 'taskChanged',
    listener: (task: NativeDownloadTask) => void
  ): Promise<PluginListenerHandle>
}

export const MediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver')
