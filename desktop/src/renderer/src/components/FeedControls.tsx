import QualityToggle from './QualityToggle'
import SortControl from './SortControl'
import TypeFilter from './TypeFilter'
import ViewToggle, { type ViewMode } from './ViewToggle'
import type { Order, ContentType } from '../lib/feedOptions'

interface FeedControlsProps {
  /** View mode is always present on a feed. */
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  /** Sort — omit on feeds whose backend has no order param. */
  order?: Order
  onOrderChange?: (order: Order) => void
  /** Video/image filter — omit on single-type feeds. */
  type?: ContentType
  onTypeChange?: (type: ContentType) => void
  /** Verified-only toggle — Discover only. */
  verified?: boolean
  onVerifiedChange?: (verified: boolean) => void
}

/**
 * The one control cluster every feed page mounts in `PageHeader`'s `right`
 * slot. Renders only the controls a page opts into, always in the same order
 * (type · sort · verified · quality · view) and the same place, so no two
 * feeds arrange their controls differently again.
 */
export default function FeedControls({
  mode,
  onModeChange,
  order,
  onOrderChange,
  type,
  onTypeChange,
  verified,
  onVerifiedChange
}: FeedControlsProps): JSX.Element {
  return (
    <div className="controls">
      {type !== undefined && onTypeChange && <TypeFilter value={type} onChange={onTypeChange} />}
      {order !== undefined && onOrderChange && <SortControl value={order} onChange={onOrderChange} />}
      {verified !== undefined && onVerifiedChange && (
        <button
          type="button"
          className={verified ? 'btn btn-sm btn-ember' : 'btn btn-sm btn-ghost'}
          aria-pressed={verified}
          onClick={() => onVerifiedChange(!verified)}
        >
          Verified
        </button>
      )}
      <QualityToggle />
      <ViewToggle value={mode} onChange={onModeChange} />
    </div>
  )
}
