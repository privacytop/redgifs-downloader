import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import FeedControls from '../components/FeedControls'
import FeedState from '../components/FeedState'
import SignInGate from '../components/SignInGate'
import FeedGrid from '../components/FeedGrid'
import { usePlayableFeed } from '../hooks/usePlayableFeed'
import { useViewMode } from '../hooks/useViewMode'
import { useDownload } from '../hooks/useDownload'
import { useAuthed } from '../hooks/useAuthed'
import type { Content } from '@shared/types'

export default function Likes(): JSX.Element {
  const authed = useAuthed()
  const download = useDownload()
  const [mode, setMode] = useViewMode('likes', 'grid')

  const feed = usePlayableFeed((p) => window.api.getLikes(p), 'Likes', [authed])

  // Mirror the player's like toggles without a refetch: the likes feed is
  // eventually consistent, so an immediate reload can still return a just
  // un-liked gif — hide/restore it locally instead (same event wiring
  // CollectionDetail uses for 'rgd:collection-changed').
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const onLike = (e: Event): void => {
      const d = (e as CustomEvent<{ gifId?: string; liked?: boolean }>).detail
      const gifId = d?.gifId
      if (!gifId) return
      const unliked = d?.liked === false
      setHidden((prev) => {
        const next = new Set(prev)
        if (unliked) next.add(gifId)
        else next.delete(gifId)
        return next
      })
    }
    window.addEventListener('rgd:like-changed', onLike)
    return () => window.removeEventListener('rgd:like-changed', onLike)
  }, [])

  const items = feed.contents.filter((c) => !hidden.has(c.id))

  // The player paginates the unfiltered feed list, so map the grid's index in
  // the filtered view back to the item's position in feed.contents.
  const open = (c: Content, _index: number): void => {
    feed.openAt(
      c,
      feed.contents.findIndex((x) => x.id === c.id)
    )
  }

  if (authed === false) {
    return (
      <div className="page">
        <PageHeader kicker="library" kickerIndex={6} title="Likes" />
        <SignInGate
          message="Sign in to see your likes"
          hint="Your liked clips sync once you connect a RedGifs account."
        />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        kicker="library"
        kickerIndex={6}
        title="Likes"
        right={<FeedControls mode={mode} onModeChange={setMode} />}
      />
      <FeedState
        loading={feed.loading}
        error={feed.error}
        isEmpty={items.length === 0}
        emptyMessage="Nothing here yet"
        emptyHint="Gifs you like on RedGifs will show up here."
        onRetry={feed.reload}
      />
      <FeedGrid
        items={items}
        mode={mode}
        onOpen={open}
        onDownload={download}
        onEndReached={feed.loadMore}
        hasMore={feed.hasMore}
        loading={feed.loading}
        error={feed.error}
        onRetry={feed.loadMore}
      />
    </div>
  )
}
