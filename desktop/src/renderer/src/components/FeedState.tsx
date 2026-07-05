import EmptyState from './EmptyState'

interface FeedStateProps {
  loading: boolean
  error?: string | null
  /** True when there is nothing to render (after loading, no error). */
  isEmpty: boolean
  /** Copy for the genuine "no results" case. */
  emptyMessage?: string
  emptyHint?: string
  /** Retry handler — shown as a button on the error state when provided. */
  onRetry?: () => void
  /** Skeleton shape while loading with no prior content. */
  skeleton?: 'grid' | 'none'
  /** Number of skeleton tiles to paint. */
  skeletonCount?: number
}

/**
 * The single place feed pages resolve loading / error / empty. Returns the
 * right affordance for the current state, or `null` when there is content to
 * show. Before this, pages each rolled their own "Loading…" string, swallowed
 * errors into a misleading empty state, or showed nothing at all on first
 * paint — this makes all three states look and behave the same everywhere.
 *
 * Render it directly above the grid: it only paints the skeleton when there is
 * no prior content (`isEmpty`), so paginating never flashes the loader.
 */
export default function FeedState({
  loading,
  error,
  isEmpty,
  emptyMessage = 'Nothing here yet',
  emptyHint,
  onRetry,
  skeleton = 'grid',
  skeletonCount = 12
}: FeedStateProps): JSX.Element | null {
  // Error takes priority — a failed fetch must never read as "empty".
  if (error && isEmpty) {
    return (
      <EmptyState
        message="Couldn’t load"
        hint={error}
        action={
          onRetry && (
            <button className="btn" onClick={onRetry}>
              Try again
            </button>
          )
        }
      />
    )
  }

  // First-load skeleton (only when we have nothing yet).
  if (loading && isEmpty) {
    if (skeleton === 'none') return null
    return (
      <div className="skel-grid" aria-busy="true" aria-label="Loading">
        {Array.from({ length: skeletonCount }, (_, i) => (
          <div key={i} className="skel skel-tile" />
        ))}
      </div>
    )
  }

  // Genuine empty result.
  if (isEmpty) {
    return <EmptyState message={emptyMessage} hint={emptyHint} />
  }

  return null
}
