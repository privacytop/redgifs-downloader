import { ORDERS, type Order } from '../lib/feedOptions'

interface SortControlProps {
  value: Order
  onChange: (order: Order) => void
  /** Option list override — Search passes SEARCH_ORDERS to offer Relevance. */
  options?: readonly { id: Order; label: string }[]
}

/**
 * The single sort control for every feed. A compact styled `.select` over the
 * shared `ORDERS` set — one widget, one option list, used identically app-wide.
 */
export default function SortControl({
  value,
  onChange,
  options = ORDERS
}: SortControlProps): JSX.Element {
  return (
    <select
      className="select"
      aria-label="Sort order"
      value={value}
      onChange={(e) => onChange(e.target.value as Order)}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
