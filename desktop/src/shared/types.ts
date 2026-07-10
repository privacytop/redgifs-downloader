// Shared domain types now live in @redloader/core (packages/core/src/types),
// so desktop + mobile share one definition. This re-export keeps every
// `@shared/types` / `../shared/types` import in the desktop app working
// unchanged.
export * from '../../../packages/core/src/types'
