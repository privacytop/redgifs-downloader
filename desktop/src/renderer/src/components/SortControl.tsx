import { ORDERS, type Order } from '../lib/feedOptions'

interface SortControlProps {
  value: Order
  onChange: (order: Order) => void
}

/**
 * The single sort control for every feed. A compact styled `.select` over the
 * shared `ORDERS` set — one widget, one option list, used identically app-wide.
 */
export default function SortControl({ value, onChange }: SortControlProps): JSX.Element {
  return (
    <select
      className="select"
      aria-label="Sort order"
      value={value}
      onChange={(e) => onChange(e.target.value as Order)}
    >
      {ORDERS.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
