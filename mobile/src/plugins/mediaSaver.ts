import { registerPlugin } from '@capacitor/core'

interface MediaSaverPlugin {
  /** Download a URL into Movies/RedLoader/<subdir> via MediaStore. */
  download(opts: { url: string; filename: string; subdir?: string }): Promise<{ uri: string; bytes: number }>
}

export const MediaSaver = registerPlugin<MediaSaverPlugin>('MediaSaver')
