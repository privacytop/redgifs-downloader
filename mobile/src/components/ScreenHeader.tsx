import { useNavigate } from 'react-router-dom'
import IconButton from './IconButton'
import { IconChevronLeft } from './icons'

interface ScreenHeaderProps {
  title: string
  /** Show a top-left back chevron. `true` = navigate(-1); pass a fn to override. */
  back?: boolean | (() => void)
  /** Optional right-aligned slot (e.g. a settings gear). */
  right?: React.ReactNode
}

/**
 * The one header every screen uses: optional back chevron (top-left), the
 * title, and an optional right slot — with consistent spacing baked in. This is
 * the abstraction that ends the per-screen mix of hand-rolled title rows, stray
 * <hr>s, and one-off back buttons. Tab-root screens omit `back`; pushed detail
 * screens pass `back`.
 */
export default function ScreenHeader({ title, back, right }: ScreenHeaderProps): React.JSX.Element {
  const navigate = useNavigate()
  const onBack = typeof back === 'function' ? back : (): void => navigate(-1)

  return (
    <header className="screen-header">
      {back && (
        <IconButton label="Back" onClick={onBack} className="screen-header-back">
          <IconChevronLeft />
        </IconButton>
      )}
      <h1 className="title">{title}</h1>
      {right && <div className="screen-header-right">{right}</div>}
    </header>
  )
}
