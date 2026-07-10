import { describe, it, expect } from 'vitest'
import { buildContentsRequest, buildFilename, extFromUrl, pickUrl } from './download'

describe('download helpers', () => {
  it('parses extension and strips query strings', () => {
    expect(extFromUrl('https://x/AbC.mp4?token=1')).toBe('mp4')
    expect(extFromUrl('https://x/noext')).toBe('mp4')
  })

  it('builds a zero-padded sanitized filename', () => {
    expect(buildFilename({ id: 'g1', username: 'bo/b', urls: { hd: 'h.mp4' } } as any, 7))
      .toBe('0007_g1_bo_b.mp4')
  })

  it('picks hd then sd based on quality', () => {
    const urls = { hd: 'h.mp4', sd: 's.mp4' }
    expect(pickUrl({ urls } as any, 'hd')).toBe('h.mp4')
    expect(pickUrl({ urls: { sd: 's.mp4' } } as any, 'hd')).toBe('s.mp4')
    expect(pickUrl({ urls } as any, 'sd')).toBe('s.mp4')
  })

  it('threads an explicit quality override into the built request', () => {
    const req = buildContentsRequest([{ id: 'g1' } as any, { id: 'g2' } as any], 'bob', 'sd')
    expect(req).toMatchObject({ type: 'single', username: 'bob', contentIds: ['g1', 'g2'], quality: 'sd' })
  })

  it('leaves quality undefined when no override given, so the caller falls back to the global setting', () => {
    const req = buildContentsRequest([{ id: 'g1' } as any], 'bob')
    expect(req.quality).toBeUndefined()
  })
})
