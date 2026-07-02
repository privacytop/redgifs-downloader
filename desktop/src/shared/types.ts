// Shared domain types used by both the Electron main process and the React
// renderer. Ported from the original Go `types.go`, using camelCase.

export interface ContentUrls {
  hd?: string
  sd?: string
  thumbnail?: string
  poster?: string
  silent?: string
}

export interface Niche {
  id: string
  name: string
  description: string
  gifs: number
  subscribers: number
  thumbnail: string
  cover?: string
  owner?: string
}

export type ContentKind = 'g' | 'i'

export interface Content {
  id: string
  title: string
  description: string
  duration: number
  width: number
  height: number
  views: number
  likes: number
  username: string
  createDate: number
  hasAudio: boolean
  urls: ContentUrls
  tags: string[]
  niches: string[]
}

export interface ContentResponse {
  contents: Content[]
  page: number
  pages: number
  total: number
}

export interface UserResult {
  username: string
  name: string
  profileImageUrl: string
  profileUrl: string
  followers: number
  gifs: number
  views: number
  verified: boolean
}

export interface UserProfile {
  username: string
  name: string
  profileUrl: string
  profilePic: string
  followers: number
  following: number
  totalGifs: number
  views: number
  likes: number
  blockedTags: string[]
  preferences: string[]
}

export interface Collection {
  id: string
  name: string
  description: string
  contentCount: number
  thumbnailUrl: string
  published: boolean
}

export type DownloadType = 'user' | 'collection' | 'likes' | 'single'
export type Quality = 'hd' | 'sd'

export interface DownloadRequest {
  type: DownloadType
  username?: string
  collectionId?: string
  contentIds?: string[]
  searchOrders?: string[]
  quality?: Quality
  targetPath?: string
}

export type TaskStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadTask {
  id: string
  type: DownloadType
  username: string
  status: TaskStatus
  progress: number // 0..100
  totalItems: number
  downloaded: number
  failed: number
  skipped: number
  currentItem: string
  downloadPath: string
  error?: string
  startTime: number
  endTime?: number
}

export interface DownloadRecord {
  id: number
  username: string
  contentId: string
  contentName: string
  filePath: string
  fileSize: number
  duration: number
  width: number
  height: number
  hasAudio: boolean
  downloadedAt: number
  thumbnail: string
  searchOrder: string
  rank: number
}

export interface Settings {
  downloadPath: string
  maxConcurrentDownloads: number
  preferredQuality: Quality
  searchOrders: string[]
  createUserFolders: boolean
  overwriteExisting: boolean
  darkMode: boolean
  showNotifications: boolean
}

export interface Statistics {
  totalDownloads: number
  totalSize: number
  totalUsers: number
  totalCollections: number
  recentDownloads: DownloadRecord[]
  topUsers: { username: string; downloads: number; size: number }[]
}

export interface AuthStatus {
  authenticated: boolean // a real user token is present
  username?: string
}

export type ToastType = 'info' | 'success' | 'warning' | 'error'
export interface ToastPayload {
  title: string
  message: string
  type: ToastType
}

export const DEFAULT_SEARCH_ORDERS = ['best', 'latest', 'oldest', 'top28', 'trending']

export const DEFAULT_SETTINGS: Settings = {
  downloadPath: '',
  maxConcurrentDownloads: 4,
  preferredQuality: 'hd',
  searchOrders: ['best'],
  createUserFolders: true,
  overwriteExisting: false,
  darkMode: true,
  showNotifications: true
}
