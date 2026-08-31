import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

interface PipModeEvent { active: boolean }

interface PictureInPicturePlugin {
  setActive(opts: { active: boolean; width?: number; height?: number }): Promise<void>
  enter(opts: { width?: number; height?: number }): Promise<{ active: boolean }>
  addListener(eventName: 'pipModeChanged', listener: (event: PipModeEvent) => void): Promise<PluginListenerHandle>
}

export const PictureInPicture = registerPlugin<PictureInPicturePlugin>('PictureInPicture')
