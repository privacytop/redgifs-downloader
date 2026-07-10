/**
 * Collection-membership signal. The sqlite index is the source of truth for
 * which collections a gif is in (see storage.gifCollectionIds); this event lets
 * the player's Collect button reflect a change made in the add-to-collection
 * sheet without re-querying. `rgd:collect-changed` carries {gifId, collected}
 * where `collected` is true when the gif is in at least one collection.
 */
export const COLLECT_EVENT = 'rgd:collect-changed'

export interface CollectChange {
  gifId: string
  collected: boolean
}

export function emitCollectChange(gifId: string, collected: boolean): void {
  window.dispatchEvent(
    new CustomEvent<CollectChange>(COLLECT_EVENT, { detail: { gifId, collected } })
  )
}
