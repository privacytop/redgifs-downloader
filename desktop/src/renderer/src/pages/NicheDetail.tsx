import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { useNav } from '../context/nav'
import { formatCount } from '../lib/format'
import type { Niche } from '@shared/types'

/**
 * Niche detail page. There is no niche-content endpoint, so this surfaces the
 * niche's related niches as a responsive grid of cards.
 */
export default function NicheDetail({ id, title }: { id: string; title: string }): JSX.Element {
  const { navigate } = useNav()
  const [related, setRelated] = useState<Niche[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    window.api
      .getRelatedNiches(id)
      .then((niches) => {
        if (!alive) return
        setRelated(niches)
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

  return (
    <div className="page">
      <PageHeader kicker="niche" title={title} />

      {error && <EmptyState message="Couldn't load related niches" hint={error} />}

      {!error && !loading && related.length === 0 && (
        <EmptyState
          message="No related niches"
          hint="Nothing else is linked to this niche yet."
        />
      )}

      {!error && related.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14
          }}
        >
          {related.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => navigate({ name: 'niche', id: n.id, title: n.name })}
              style={{
                textAlign: 'left',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '16px 16px 14px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'border-color .15s ease, transform .15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--line2)'
                e.currentTarget.style.transform = 'translateY(-2px)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--line)'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--serif)',
                  fontSize: 18,
                  fontWeight: 560,
                  color: 'var(--cream)',
                  lineHeight: 1.2
                }}
              >
                {n.name}
              </div>
              {n.description && (
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--mut)',
                    lineHeight: 1.45,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                >
                  {n.description}
                </div>
              )}
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--dim)',
                  marginTop: 'auto',
                  paddingTop: 6
                }}
              >
                {formatCount(n.subscribers)} subs
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
