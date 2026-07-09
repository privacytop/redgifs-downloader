import { useCallback } from 'react'
import type { Content, Quality } from '@shared/types'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'

/**
 * The one download-a-single-item helper every feed page shares: queues the
 * item at the app default quality (or an explicit per-call override) and
 * toasts the outcome. Copy names the download, not just the creator.
 */
export function useDownload(): (c: Content, quality?: Quality) => void {
  const notify = useNotify()
  const { quality: defaultQuality } = useQuality()

  return useCallback(
    (c: Content, quality?: Quality): void => {
      const q = quality ?? defaultQuality
      window.api
        .downloadContents([c], c.username, q)
        .then(() => notify(`Download queued (${q.toUpperCase()}) — @${c.username}`, 'success'))
        .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
    },
    [notify, defaultQuality]
  )
}
