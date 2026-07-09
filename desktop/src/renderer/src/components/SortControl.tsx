import Dropdown from './Dropdown'
import { ORDERS, type Order } from '../lib/feedOptions'

interface SortControlProps {
  value: Order
  onChange: (order: Order) => void
  /** Option list override — Search passes SEARCH_ORDERS to offer Relevance. */
  options?: readonly { id: Order; label: string }[]
}

/**
 * The single sort control for every feed. A custom dropdown over the shared
 * `ORDERS` set — one widget, one option list, used identically app-wide.
 */
export default function SortControl({
  value,
  onChange,
  options = ORDERS
}: SortControlProps): JSX.Element {
  return (
    <Dropdown
      ariaLabel="Sort order"
      value={value}
      onChange={(id) => onChange(id as Order)}
      options={options}
    />
  )
}
