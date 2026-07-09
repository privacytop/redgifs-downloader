import { useCallback } from 'react'
import type { Content } from '@shared/types'
import { useNotify } from '../context/notify'
import { useQuality } from '../context/quality'

/**
 * The one download-a-single-item helper every feed page previously copy-pasted:
 * queues the item at the app-wide quality and toasts success/failure.
 */
export function useDownload(): (c: Content) => void {
  const notify = useNotify()
  const { quality } = useQuality()

  return useCallback(
    (c: Content): void => {
      window.api
        .downloadContents([c], c.username, quality)
        .then(() => notify('Saving @' + c.username, 'success'))
        .catch((e) => notify('Download failed: ' + (e as Error).message, 'error'))
    },
    [notify, quality]
  )
}
