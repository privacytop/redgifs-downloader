import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface DataModeState {
  lowData: boolean
  metered: boolean
}

interface DataModePlugin {
  get(): Promise<DataModeState>
  addListener(
    event: 'change',
    listener: (state: DataModeState) => void
  ): Promise<PluginListenerHandle>
}

export const DataMode = registerPlugin<DataModePlugin>('DataMode')
