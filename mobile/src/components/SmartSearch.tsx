import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TagSuggestion, UserResult } from '@redloader/core'
import { api } from '../lib/api'
import { formatCount } from '../lib/format'
import { useToast } from '../context/toast'
import { CachedImage } from './CachedMedia'

type Option =
  | { key: string; kind: 'creator'; label: string; sub: string; creator: UserResult }
  | { key: string; kind: 'tag'; label: string; sub: string; tag: TagSuggestion }

const DEBOUNCE_MS = 250

/** Debounced performer/tag autocomplete with touch and keyboard selection. */
export default function SmartSearch(): React.JSX.Element {
  const navigate = useNavigate()
  const notify = useToast()
  const root = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)
  const [query, setQuery] = useState('')
  const [creators, setCreators] = useState<UserResult[]>([])
  const [tags, setTags] = useState<TagSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const options = useMemo<Option[]>(
    () => [
      ...creators.slice(0, 5).map((creator) => ({
        key: `creator:${creator.username}`,
        kind: 'creator' as const,
        label: `@${creator.username}`,
        sub: `${formatCount(creator.followers)} followers`,
        creator
      })),
      ...tags.slice(0, 8).map((tag) => ({
        key: `tag:${tag.text}`,
        kind: 'tag' as const,
        label: `#${tag.text}`,
        sub: `${formatCount(tag.gifs)} gifs`,
        tag
      }))
    ],
    [creators, tags]
  )

  useEffect(() => {
    const q = query.trim()
    const id = ++requestId.current
    setActive(-1)
    if (q.length < 2) {
      setCreators([])
      setTags([])
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = window.setTimeout(() => {
      void Promise.allSettled([api.searchUsers(q), api.searchSuggest(q)]).then(([users, suggested]) => {
        if (requestId.current !== id) return
        setCreators(users.status === 'fulfilled' ? users.value : [])
        setTags(suggested.status === 'fulfilled' ? suggested.value : [])
        setLoading(false)
        setOpen(true)
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const submit = (): void => {
    const q = query.trim()
    if (!q) {
      notify('Type something to search', 'warning')
      return
    }
    setOpen(false)
    navigate(`/search/${encodeURIComponent(q)}`)
  }

  const choose = (option: Option): void => {
    setOpen(false)
    if (option.kind === 'creator') {
      navigate(`/creator/${encodeURIComponent(option.creator.username)}`)
    } else {
      navigate(`/tag/${encodeURIComponent(option.tag.text)}`)
    }
  }

  return (
    <div
      ref={root}
      className="smart-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <input
        className="search"
        type="search"
        role="combobox"
        value={query}
        placeholder="Search creators, tags, videos…"
        aria-label="Search"
        aria-autocomplete="list"
        aria-expanded={open && (loading || options.length > 0)}
        aria-controls="smart-search-list"
        aria-activedescendant={active >= 0 ? `smart-search-${active}` : undefined}
        enterKeyHint="search"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, -1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (open && active >= 0 && options[active]) choose(options[active])
            else submit()
          } else if (e.key === 'Escape') {
            setOpen(false)
            setActive(-1)
          }
        }}
      />

      {open && query.trim().length >= 2 && (loading || options.length > 0) && (
        <div id="smart-search-list" className="smart-search-list" role="listbox">
          {loading && options.length === 0 ? (
            <div className="smart-search-loading">Looking up…</div>
          ) : (
            options.map((option, index) => (
              <button
                id={`smart-search-${index}`}
                key={option.key}
                type="button"
                role="option"
                aria-selected={active === index}
                className={`smart-search-option ${active === index ? 'on' : ''}`}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.kind === 'creator' ? (
                  <span className="smart-search-avatar">
                    {option.creator.profileImageUrl ? (
                      <CachedImage
                        cacheKey={`creator:${option.creator.username}`}
                        src={option.creator.profileImageUrl}
                        alt=""
                      />
                    ) : '@'}
                  </span>
                ) : (
                  <span className="smart-search-tag">#</span>
                )}
                <span className="smart-search-copy">
                  <span>{option.label}</span>
                  <small>{option.kind === 'creator' ? 'Creator' : 'Tag'} · {option.sub}</small>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
