import type { ReactNode } from 'react'
import Kicker from './Kicker'

interface PageHeaderProps {
  /** Kicker text (rendered mono/uppercase above the title). */
  kicker: string
  /** Optional running number for the kicker (`№ NN —`). */
  kickerIndex?: number
  /** Fraunces display title. */
  title: string
  /** Optional right-aligned slot (e.g. a ViewToggle or actions). */
  right?: ReactNode
}

/** Kicker + Fraunces title (+ optional right slot) over a hairline rule. */
export default function PageHeader({ kicker, kickerIndex, title, right }: PageHeaderProps): JSX.Element {
  return (
    <header className="page-header">
      <Kicker index={kickerIndex} text={kicker} />
      <div className="page-header-top">
        <h1 className="title">{title}</h1>
        {right && <div className="page-header-right">{right}</div>}
      </div>
      <hr className="rule" />
    </header>
  )
}
