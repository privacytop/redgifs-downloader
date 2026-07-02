import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'

interface StubProps {
  title: string
  /** Kicker text; defaults to the title, lowercased. */
  kicker?: string
  kickerIndex?: number
}

/** Placeholder for a screen another agent will build later. */
export default function Stub({ title, kicker, kickerIndex }: StubProps): JSX.Element {
  return (
    <div className="page">
      <PageHeader
        kicker={kicker ?? title.toLowerCase()}
        kickerIndex={kickerIndex}
        title={title}
      />
      <EmptyState
        message="Coming together…"
        hint="This section is still being composed."
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M4 12h10" />
            <path d="M4 17h7" />
          </svg>
        }
      />
    </div>
  )
}
