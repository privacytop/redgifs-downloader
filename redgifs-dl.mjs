#!/usr/bin/env node
// @ts-nocheck
/*
 * RedGifs Downloader — zero-dependency Node CLI port of redgifs_dl.py.
 *
 * Single file, no npm install. Uses only Node built-ins (global fetch,
 * node:util parseArgs, node:stream, node:fs, node:readline). Requires Node 18+.
 *
 * Feature parity with the original Python:
 *   - anonymous temp-token auth + refresh (GET /v2/auth/temporary)
 *   - fetch a user's gifs across every search order, dedupe by URL, rank them
 *   - adaptive rate limiter (token-bucket + sliding delay + 429 `error.delay`
 *     parsing + exponential backoff + cooldown windows)
 *   - adaptive concurrency (grows/shrinks with failure-rate & response time)
 *   - resumable history so re-runs skip already-downloaded gifs, and re-rank
 *     (rename) a file when a better rank is found on a later run
 *   - rank-prefixed filenames for correct sorting, dry-run, batch, quality hd/sd
 *
 * Only intentional deviations from the Python (both improvements, noted inline):
 *   - history is a JSON file, not sqlite (no native dep); same schema/semantics
 *   - page ranks use the real page number, not async-completion order (the
 *     Python tied rank to completion order, making ranks nondeterministic)
 */

import { parseArgs } from 'node:util'
import { createWriteStream, promises as fs, readdirSync, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import process from 'node:process'

const VERSION = '2.1.0'

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

const sleep = (seconds) => new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1000))
const now = () => Date.now() / 1000 // seconds, like Python time.time()

const C = process.stdout.isTTY
  ? {
      reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m',
      yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m'
    }
  : new Proxy({}, { get: () => '' })

let VERBOSE = false
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const log = {
  info: (m) => console.error(`${C.dim}${stamp()}${C.reset} ${C.blue}INFO${C.reset}  ${m}`),
  warn: (m) => console.error(`${C.dim}${stamp()}${C.reset} ${C.yellow}WARN${C.reset}  ${m}`),
  error: (m) => console.error(`${C.dim}${stamp()}${C.reset} ${C.red}ERROR${C.reset} ${m}`),
  debug: (m) => VERBOSE && console.error(`${C.dim}${stamp()} DEBUG ${m}${C.reset}`)
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function makeConfig(overrides = {}) {
  return {
    rootPath: '',
    databasePath: 'redgifs-dl.json',

    minConcurrentDownloads: 5,
    maxConcurrentDownloads: 50,
    downloadTimeout: 60,
    apiTimeout: 30,
    retryAttempts: 5,
    retryDelay: 3,

    searchOrders: ['top', 'trending', 'recent', 'best', 'latest'],
    pageSize: 100,
    maxPagesPerOrder: 30,

    // live perf counters (mutated in place, mirror the Python dataclass)
    responseTimes: [], // keep last 100
    failedRequests: 0,
    successfulRequests: 0,

    // rate limiting
    rateLimitDelay: 0.5,
    rateLimitHits: 0,
    rateLimitResetTime: 0,
    rateLimitMaxBackoff: 60.0,
    rateLimitMinBackoff: 0.2,

    quality: 'hd',
    ...overrides
  }
}

function pushCapped(arr, value, cap = 100) {
  arr.push(value)
  if (arr.length > cap) arr.shift()
}

// ---------------------------------------------------------------------------
// RateLimiter — dynamic delay + 429 handling + backoff/cooldown
// ---------------------------------------------------------------------------

class RateLimiter {
  constructor(config) {
    this.config = config
    this.lastRequestTime = 0
    this.consecutiveFailures = 0
    this.consecutiveSuccesses = 0
    this.backoffFactor = 1.0
    this.currentDelay = config.rateLimitMinBackoff
    this.resetTimes = [] // last 10 server-requested delays
  }

  async waitIfNeeded() {
    const t = now()
    if (t < this.config.rateLimitResetTime) {
      const wait = this.config.rateLimitResetTime - t
      log.debug(`Rate limit cooldown active. Waiting ${wait.toFixed(2)}s until reset`)
      await sleep(wait)
      return
    }
    if (this.lastRequestTime > 0) {
      const elapsed = t - this.lastRequestTime
      if (elapsed < this.currentDelay) {
        let wait = this.currentDelay - elapsed
        wait += wait * (Math.random() * 0.2 - 0.1) // ±10% jitter
        if (wait > 0) {
          log.debug(`Rate limiting: waiting ${wait.toFixed(3)}s`)
          await sleep(wait)
        }
      }
    }
    this.lastRequestTime = now()
  }

  updateAfterSuccess() {
    this.consecutiveFailures = 0
    this.consecutiveSuccesses += 1
    if (this.consecutiveSuccesses >= 10) {
      this.currentDelay = Math.max(this.config.rateLimitMinBackoff, this.currentDelay * 0.95)
      log.debug(`Reduced rate limit delay to ${this.currentDelay.toFixed(3)}s`)
    }
  }

  updateAfterFailure(statusCode = null, responseData = null) {
    this.consecutiveSuccesses = 0
    this.consecutiveFailures += 1

    if (statusCode === 429 && responseData) {
      try {
        let data = responseData
        if (typeof data === 'string') {
          try { data = JSON.parse(data) } catch { /* leave as-is */ }
        }
        const delay = data?.error?.delay
        if (delay != null) {
          const delaySeconds = Number(delay)
          pushCapped(this.resetTimes, delaySeconds, 10)
          const avg = this.resetTimes.reduce((a, b) => a + b, 0) / this.resetTimes.length
          this.config.rateLimitResetTime = now() + avg
          this.currentDelay = Math.min(
            this.config.rateLimitMaxBackoff,
            Math.max(this.config.rateLimitMinBackoff, avg * 0.1)
          )
          log.warn(`Rate limited! API requested ${delaySeconds.toFixed(1)}s wait. `
            + `Setting delay to ${this.currentDelay.toFixed(2)}s`)
          return
        }
      } catch (e) {
        log.debug(`Error parsing rate limit response: ${e}`)
      }
    }

    if (statusCode === 429 || (this.consecutiveFailures > 2 && statusCode >= 500)) {
      this.backoffFactor = Math.min(32, this.backoffFactor * 2)
      this.currentDelay = Math.min(this.config.rateLimitMaxBackoff, this.currentDelay * 1.5)
      log.warn(`Increasing rate limit delay to ${this.currentDelay.toFixed(3)}s after failures`)
      if (this.consecutiveFailures >= 5) {
        const cooldown = this.currentDelay * 2
        this.config.rateLimitResetTime = now() + cooldown
        log.warn(`Too many consecutive failures. Cooling down for ${cooldown.toFixed(1)}s`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TokenBucket — smooth request rate
// ---------------------------------------------------------------------------

class TokenBucket {
  constructor(rate, capacity) {
    this.rate = rate
    this.capacity = capacity
    this.tokens = capacity
    this.lastUpdate = now()
  }

  consume(tokens = 1.0) {
    const t = now()
    const elapsed = t - this.lastUpdate
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate)
    this.lastUpdate = t
    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return 0.0
    }
    return (tokens - this.tokens) / this.rate
  }

  async waitForTokens(tokens = 1.0) {
    const wait = this.consume(tokens)
    if (wait > 0) {
      await sleep(wait)
      this.consume(tokens)
    }
  }
}

// ---------------------------------------------------------------------------
// Semaphore — resizable counting semaphore
// ---------------------------------------------------------------------------

class Semaphore {
  constructor(max) {
    this.permits = max
    this.waiters = []
  }
  async acquire() {
    if (this.permits > 0) { this.permits -= 1; return }
    await new Promise((resolve) => this.waiters.push(resolve))
  }
  release() {
    const next = this.waiters.shift()
    if (next) next() // hand the permit straight to a waiter
    else this.permits += 1
  }
  resize(newMax, oldMax) {
    const delta = newMax - oldMax
    if (delta > 0) for (let i = 0; i < delta; i++) this.release()
    else this.permits = Math.max(0, this.permits + delta)
  }
}

// ---------------------------------------------------------------------------
// AdaptiveConcurrency — grow/shrink concurrency + token rate from metrics
// ---------------------------------------------------------------------------

class AdaptiveConcurrency {
  constructor(config) {
    this.config = config
    this.currentConcurrency = config.minConcurrentDownloads
    this.semaphore = new Semaphore(this.currentConcurrency)
    this.lastAdjustment = now()
    this.adjustmentInterval = 5
    this.tokenBucket = new TokenBucket(10, 20)
  }

  async acquire() {
    await this.tokenBucket.waitForTokens()
    await this.semaphore.acquire()
  }
  release() { this.semaphore.release() }

  adjustConcurrency() {
    const t = now()
    if (t - this.lastAdjustment < this.adjustmentInterval) return
    this.lastAdjustment = t

    const total = this.config.successfulRequests + this.config.failedRequests
    if (total < 10) return

    const failureRate = total > 0 ? this.config.failedRequests / total : 0
    const rt = this.config.responseTimes
    const avgResponseTime = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 0

    if (failureRate > 0.2 || this.config.rateLimitHits > 0) {
      this.tokenBucket.rate = Math.max(1, this.tokenBucket.rate * 0.8)
      log.debug(`Reducing token bucket rate to ${this.tokenBucket.rate.toFixed(1)} req/s`)
      this.config.rateLimitHits = 0
    } else if (failureRate < 0.05 && avgResponseTime < 1.0) {
      this.tokenBucket.rate = Math.min(30, this.tokenBucket.rate * 1.1)
      log.debug(`Increasing token bucket rate to ${this.tokenBucket.rate.toFixed(1)} req/s`)
    }

    let next
    if (failureRate > 0.1) {
      next = Math.max(this.config.minConcurrentDownloads, Math.trunc(this.currentConcurrency * 0.8))
    } else if (avgResponseTime > 3.0 && this.currentConcurrency > this.config.minConcurrentDownloads) {
      next = Math.max(this.config.minConcurrentDownloads, this.currentConcurrency - 2)
    } else if (avgResponseTime < 1.0 && failureRate < 0.05) {
      next = Math.min(this.config.maxConcurrentDownloads, this.currentConcurrency + 3)
    } else {
      next = this.currentConcurrency
    }

    if (next !== this.currentConcurrency) {
      this.semaphore.resize(next, this.currentConcurrency)
      this.currentConcurrency = next
      log.info(`Adjusted concurrency to ${next} downloads`)
    }
  }
}

// ---------------------------------------------------------------------------
// History store (JSON) — same logical schema as the Python sqlite tables
// ---------------------------------------------------------------------------

const KEY = (username, videoName) => `${username} ${videoName}`

class HistoryStore {
  constructor(databasePath) {
    this.path = databasePath
    this.data = { downloads: {}, failed: {} }
    this.dirty = false
  }
  async load() {
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(await fs.readFile(this.path, 'utf-8'))
        this.data.downloads ??= {}
        this.data.failed ??= {}
      } catch (e) {
        log.warn(`Could not read history at ${this.path}, starting fresh: ${e}`)
        this.data = { downloads: {}, failed: {} }
      }
    }
  }
  async save() {
    if (!this.dirty) return
    await fs.writeFile(this.path, JSON.stringify(this.data))
    this.dirty = false
  }
  async close() { await this.save() }

  /** Map of videoName -> [rank, searchOrder] for a user. */
  getExistingDownloads(username) {
    const out = new Map()
    const prefix = `${username} `
    for (const [k, v] of Object.entries(this.data.downloads)) {
      if (k.startsWith(prefix)) out.set(k.slice(prefix.length), [v.rank, v.search_order])
    }
    return out
  }
  /** records: [username, videoName, rank, searchOrder][] */
  async recordDownloads(records) {
    if (!records.length) return
    for (const [username, videoName, rank, order] of records) {
      this.data.downloads[KEY(username, videoName)] = {
        rank, search_order: order, downloaded_at: new Date().toISOString()
      }
    }
    this.dirty = true
    await this.save()
  }
  async recordFailedDownload(username, videoName, url, errorMessage) {
    const k = KEY(username, videoName)
    const prev = this.data.failed[k]
    this.data.failed[k] = {
      url, error_message: errorMessage,
      attempts: (prev?.attempts ?? 0) + 1, last_attempt: new Date().toISOString()
    }
    this.dirty = true
    await this.save()
  }
  clearFailedDownloads(username) {
    const prefix = `${username} `
    for (const k of Object.keys(this.data.failed)) if (k.startsWith(prefix)) delete this.data.failed[k]
    this.dirty = true
  }
}

// ---------------------------------------------------------------------------
// RedGifsAPI
// ---------------------------------------------------------------------------

class RedGifsAPI {
  static BASE_URL = 'https://api.redgifs.com'

  constructor(config) {
    this.config = config
    this.token = null
    this.tokenExpiry = 0
    this.rateLimiter = new RateLimiter(config)
  }

  async getToken() {
    const t = now()
    if (this.token && t < this.tokenExpiry - 300) return this.token
    await this.rateLimiter.waitIfNeeded()
    let resp
    try {
      resp = await fetch(`${RedGifsAPI.BASE_URL}/v2/auth/temporary`,
        { signal: AbortSignal.timeout(this.config.apiTimeout * 1000) })
    } catch (e) {
      log.error(`Failed to get auth token: ${e}`)
      this.rateLimiter.updateAfterFailure()
      throw e
    }
    if (resp.status === 200) {
      const data = await resp.json()
      this.token = data.token
      this.tokenExpiry = t + 3600
      this.rateLimiter.updateAfterSuccess()
      return this.token
    }
    if (resp.status === 429) {
      const data = await resp.json().catch(() => null)
      this.rateLimiter.updateAfterFailure(429, data)
      throw new Error(`Rate limited while getting token: ${resp.status}`)
    }
    this.rateLimiter.updateAfterFailure(resp.status)
    throw new Error(`Failed to get token: ${resp.status}`)
  }

  async fetchWithRetry(url) {
    const maxTotalRetries = 20
    let nonRateRetries = 0

    for (;;) {
      try {
        const token = await this.getToken()
        await this.rateLimiter.waitIfNeeded()

        const start = now()
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.config.apiTimeout * 1000)
        })
        pushCapped(this.config.responseTimes, now() - start)

        if (resp.status === 200) {
          this.config.successfulRequests += 1
          this.rateLimiter.updateAfterSuccess()
          return await resp.json()
        }

        if (resp.status === 429) {
          this.config.rateLimitHits += 1
          let delay = 5
          try {
            const data = await resp.json()
            log.warn(`Rate limited! Response: ${JSON.stringify(data)}`)
            this.rateLimiter.updateAfterFailure(429, data)
            if (data?.error?.delay != null) delay = parseInt(data.error.delay, 10)
            log.warn(`Rate limited! Waiting ${delay}s before retrying...`)
            await sleep(delay + 1)
          } catch (e) {
            log.warn(`Error parsing rate limit response: ${e}`)
            this.rateLimiter.updateAfterFailure(429)
            await sleep(5)
          }
          continue
        }

        if (resp.status >= 500) {
          log.warn(`Server error ${resp.status}, retrying...`)
          nonRateRetries += 1
          this.rateLimiter.updateAfterFailure(resp.status)
          if (nonRateRetries >= maxTotalRetries) {
            this.config.failedRequests += 1
            throw new Error(`Maximum retries exceeded for server errors: ${resp.status}`)
          }
          await sleep(Math.min(60, 2 ** nonRateRetries))
          continue
        }

        if (resp.status === 404) {
          log.warn(`Resource not found (404): ${url}`)
          this.config.failedRequests += 1
          return { gifs: [], pages: 0, total: 0 }
        }

        // other client errors
        const body = await resp.text().catch(() => '')
        log.error(`API error: ${resp.status} - ${body}`)
        nonRateRetries += 1
        this.rateLimiter.updateAfterFailure(resp.status)
        if (nonRateRetries >= maxTotalRetries) {
          this.config.failedRequests += 1
          throw new Error(`Maximum retries exceeded: ${resp.status}`)
        }
        await sleep(Math.min(60, 2 ** nonRateRetries))
      } catch (e) {
        if (e instanceof Error && /Maximum retries exceeded/.test(e.message)) throw e
        log.warn(`Network/unexpected error: ${e}`)
        nonRateRetries += 1
        this.rateLimiter.updateAfterFailure()
        if (nonRateRetries >= maxTotalRetries) {
          this.config.failedRequests += 1
          throw new Error(`Maximum retries exceeded after errors: ${e}`)
        }
        await sleep(Math.min(60, 2 ** nonRateRetries))
      }
    }
  }

  fetchUserGifs(username, searchOrder, page) {
    const url = `${RedGifsAPI.BASE_URL}/v2/users/${encodeURIComponent(username)}`
      + `/search?order=${searchOrder}&count=${this.config.pageSize}&page=${page}`
    return this.fetchWithRetry(url)
  }
}

// ---------------------------------------------------------------------------
// Downloader
// ---------------------------------------------------------------------------

class Downloader {
  constructor(config, history, api) {
    this.config = config
    this.db = history
    this.api = api
    this.ac = new AdaptiveConcurrency(config)
    this.successfulDownloads = 0
    this.skippedDownloads = 0
    this.failedDownloads = 0
  }

  formatRank(rank, totalCount) {
    const digits = String(totalCount).length
    return String(rank).padStart(digits, '0')
  }

  async downloadFile(url, outputPath) {
    const maxOtherRetries = this.config.retryAttempts
    let otherRetries = 0
    let rateLimitRetries = 0

    for (;;) {
      try {
        await this.api.rateLimiter.waitIfNeeded()
        const start = now()
        const resp = await fetch(url, { signal: AbortSignal.timeout(this.config.downloadTimeout * 1000) })

        if (resp.status === 200) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true })
          // Stream to a .part file, then atomically rename — a crash mid-write
          // never leaves a truncated file that later looks "already downloaded".
          const partPath = `${outputPath}.part`
          await pipeline(Readable.fromWeb(resp.body), createWriteStream(partPath))
          await fs.rename(partPath, outputPath)

          pushCapped(this.config.responseTimes, now() - start)
          this.config.successfulRequests += 1
          this.api.rateLimiter.updateAfterSuccess()
          this.ac.adjustConcurrency()
          return true
        }

        if (resp.status === 429) {
          rateLimitRetries += 1
          let delay = 5
          try {
            const data = await resp.json()
            if (data?.error?.delay != null) delay = parseInt(data.error.delay, 10)
            log.warn(`Rate limited during download! Waiting ${delay}s... (attempt ${rateLimitRetries})`)
            this.api.rateLimiter.updateAfterFailure(429, data)
            await sleep(delay + 1)
          } catch {
            this.api.rateLimiter.updateAfterFailure(429)
            await sleep(5)
          }
          continue
        }

        log.warn(`Download failed: HTTP Error ${resp.status} (attempt ${otherRetries + 1}/${maxOtherRetries})`)
        this.api.rateLimiter.updateAfterFailure(resp.status)
        otherRetries += 1
        if (otherRetries >= maxOtherRetries) { this.config.failedRequests += 1; return false }
        await sleep(Math.min(60, this.config.retryDelay * 2 ** otherRetries))
      } catch (e) {
        const msg = String(e?.message ?? e)
        log.warn(`Error during download: ${msg} (attempt ${otherRetries + 1}/${maxOtherRetries})`)
        // Connection resets often mean an implicit rate limit — back off harder.
        if (/ECONNRESET|reset|disconnect/i.test(msg)) {
          rateLimitRetries += 1
          this.api.rateLimiter.updateAfterFailure(429, null)
          await sleep(Math.min(60, 5 * 2 ** rateLimitRetries))
        } else {
          this.api.rateLimiter.updateAfterFailure()
          otherRetries += 1
          if (otherRetries >= maxOtherRetries) { this.config.failedRequests += 1; return false }
          await sleep(Math.min(60, this.config.retryDelay * 2 ** otherRetries))
        }
      }
    }
  }

  // Returns [downloaded, skipped, failed] counts (each 0 or 1), like the Python.
  async processVideo(username, url, folderPath, rank, totalCount, searchOrder,
    existingVideos, pendingVideos, folderFiles, dryRun) {
    const videoName = decodeURIComponent(new URL(url).pathname.split('/').pop().split('?')[0])
    const rankedName = `${this.formatRank(rank, totalCount)}_${videoName}`
    const videoPath = path.join(folderPath, rankedName)

    if (pendingVideos.has(videoName)) return [0, 1, 0]
    pendingVideos.add(videoName)

    const suffixRe = new RegExp(`^(\\d+)_${escapeRegExp(videoName)}$`)
    const findExisting = () => {
      for (const name of folderFiles) if (suffixRe.test(name)) return name
      return null
    }

    // Already in history: only act if the new rank is strictly better.
    if (existingVideos.has(videoName)) {
      const [storedRank] = existingVideos.get(videoName)
      if (storedRank != null && rank >= storedRank) return [0, 1, 0]
      const existing = findExisting()
      if (existing) {
        try {
          if (!dryRun) {
            await fs.rename(path.join(folderPath, existing), videoPath)
            folderFiles.delete(existing); folderFiles.add(rankedName)
          }
          log.info(`Renamed ${existing} to ${rankedName} (better rank)`)
          return [0, 1, 0]
        } catch (e) {
          log.error(`Failed to rename ${existing}: ${e}`)
          return [0, 0, 1]
        }
      }
      // in history but file gone → fall through and re-download
    }

    // File already on disk under some rank: rename if this rank is better, skip download.
    const onDisk = findExisting()
    if (onDisk) {
      const m = onDisk.match(/^(\d+)_/)
      if (m && rank < parseInt(m[1], 10) && !dryRun) {
        try {
          await fs.rename(path.join(folderPath, onDisk), videoPath)
          folderFiles.delete(onDisk); folderFiles.add(rankedName)
          log.info(`Renamed ${onDisk} to ${rankedName} (better rank)`)
        } catch (e) {
          log.error(`Failed to rename ${onDisk}: ${e}`)
        }
      }
      return [0, 1, 0]
    }

    if (dryRun) return [1, 0, 0]

    await this.ac.acquire()
    try {
      const ok = await this.downloadFile(url, videoPath)
      if (ok) {
        folderFiles.add(rankedName)
        log.info(`Downloaded ${rankedName}`)
        return [1, 0, 0]
      }
      log.error(`Failed to download ${rankedName}`)
      await this.db.recordFailedDownload(username, videoName, url, 'Download failed after retries')
      return [0, 0, 1]
    } finally {
      this.ac.release()
    }
  }

  // Fetch every gif for a user across all search orders, deduped by URL, ranked.
  async fetchAllGifs(username) {
    const allGifs = [] // [url, rank, order]
    const seenUrls = new Set()
    const stats = {}

    const pick = (gif) => {
      const links = gif.urls || {}
      return links[this.config.quality] || links.hd || links.sd
    }

    for (const searchOrder of this.config.searchOrders) {
      stats[searchOrder] = { total: 0, new: 0 }
      try {
        const firstPage = await this.api.fetchUserGifs(username, searchOrder, 1)
        if (!firstPage) { log.warn(`No data returned for search order: ${searchOrder}`); continue }

        const totalPages = Math.min(firstPage.pages ?? 1, this.config.maxPagesPerOrder)
        const totalGifs = firstPage.total ?? 0
        if (totalGifs === 0) { log.info(`No gifs found for order=${searchOrder}`); continue }
        log.info(`Found ${totalGifs} gifs across ${totalPages} pages with order=${searchOrder}`)

        const ingest = (gifs, baseRank) => {
          gifs.forEach((gif, i) => {
            const url = pick(gif)
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url)
              allGifs.push([url, baseRank + i + 1, searchOrder])
              stats[searchOrder].new += 1
            }
          })
          stats[searchOrder].total += gifs.length
        }

        ingest(firstPage.gifs ?? [], 0)

        // Fetch remaining pages concurrently; rank by the real page number
        // (deterministic — the Python used async-completion order here).
        const pages = []
        for (let p = 2; p <= totalPages; p++) pages.push(p)
        await Promise.all(pages.map(async (p) => {
          try {
            const data = await this.api.fetchUserGifs(username, searchOrder, p)
            ingest(data.gifs ?? [], (p - 1) * this.config.pageSize)
            log.info(`Fetched ${(data.gifs ?? []).length} gifs from page ${p} for order=${searchOrder}`)
          } catch (e) {
            log.error(`Error fetching page ${p} for order=${searchOrder}: ${e}`)
          }
        }))
      } catch (e) {
        log.error(`Error processing search order=${searchOrder}: ${e}`)
      }
    }

    for (const [order, d] of Object.entries(stats)) {
      log.info(`Order '${order}': ${d.total} total gifs, ${d.new} new unique gifs`)
    }
    log.info(`Total unique gifs found across all orders: ${allGifs.length}`)
    allGifs.sort((a, b) => a[1] - b[1])
    return allGifs
  }

  async downloadUserContent(username, dryRun = false, skipHistory = false) {
    username = username.replace('https://www.redgifs.com/users/', '').trim()
    log.info(`Processing content for user: ${username}`)
    const startTime = now()

    const downloadFolder = this.config.rootPath
      ? path.join(this.config.rootPath, `RedGifs - ${username}`)
      : `RedGifs - ${username}`
    if (!existsSync(downloadFolder) && !dryRun) await fs.mkdir(downloadFolder, { recursive: true })

    // `--skip-history` bypasses the resume DB so everything re-downloads.
    const existingVideos = skipHistory ? new Map() : this.db.getExistingDownloads(username)
    log.info(`Found ${existingVideos.size} existing downloads in history`)
    this.db.clearFailedDownloads(username)

    const folderFiles = new Set(existsSync(downloadFolder) ? readdirSync(downloadFolder) : [])

    const allGifs = await this.fetchAllGifs(username)

    if (dryRun) {
      log.info(`DRY RUN: Would download ${allGifs.length} videos`)
      return {
        username, total_found: allGifs.length, would_download: allGifs.length,
        already_exists: existingVideos.size, elapsed_time: now() - startTime
      }
    }
    if (!allGifs.length) {
      log.info('No new videos to download')
      return {
        username, total_found: 0, downloaded: 0, skipped: 0, failed: 0,
        already_exists: existingVideos.size, elapsed_time: now() - startTime
      }
    }

    const totalCount = allGifs.length
    const pendingVideos = new Set()
    let downloadRecords = []
    this.successfulDownloads = 0; this.skippedDownloads = 0; this.failedDownloads = 0
    const downloadStart = now()

    let completed = 0
    const prog = new Progress(totalCount, username)

    // Launch every video; they self-throttle through the adaptive semaphore.
    await Promise.all(allGifs.map(async ([url, rank, order]) => {
      const [d, s, f] = await this.processVideo(
        username, url, downloadFolder, rank, totalCount, order,
        existingVideos, pendingVideos, folderFiles, dryRun)

      this.successfulDownloads += d; this.skippedDownloads += s; this.failedDownloads += f
      if (d) {
        const videoName = decodeURIComponent(new URL(url).pathname.split('/').pop().split('?')[0])
        downloadRecords.push([username, videoName, rank, order])
      }
      completed += 1
      prog.update(completed, this.successfulDownloads, this.skippedDownloads, this.failedDownloads)

      if (downloadRecords.length >= 10) {
        await this.db.recordDownloads(downloadRecords)
        downloadRecords = []
      }
    }))
    prog.done()

    if (downloadRecords.length) await this.db.recordDownloads(downloadRecords)

    const elapsedTotal = now() - startTime
    const downloadSpeed = this.successfulDownloads > 0
      ? this.successfulDownloads / (now() - downloadStart) : 0

    return {
      username, total_found: totalCount, downloaded: this.successfulDownloads,
      skipped: this.skippedDownloads, failed: this.failedDownloads,
      already_exists: existingVideos.size, elapsed_time: elapsedTotal, download_speed: downloadSpeed
    }
  }
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// ---------------------------------------------------------------------------
// Progress line (zero-dep replacement for rich.Progress)
// ---------------------------------------------------------------------------

class Progress {
  constructor(total, label) {
    this.total = total
    this.label = label
    this.tty = process.stdout.isTTY
    this.lastLine = 0
  }
  update(done, downloaded, skipped, failed) {
    const pct = this.total ? (done / this.total) * 100 : 100
    if (this.tty) {
      const width = 24
      const filled = Math.round((done / this.total) * width)
      const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
      const line = `${C.cyan}${this.label}${C.reset} ${bar} ${done}/${this.total} `
        + `(${pct.toFixed(1)}%) ${C.green}↓${downloaded}${C.reset} `
        + `${C.yellow}⤼${skipped}${C.reset} ${C.red}✗${failed}${C.reset}`
      process.stdout.write(`\r${line}\x1b[K`)
    } else if (done % 10 === 0 || done === this.total) {
      log.info(`Progress: ${done}/${this.total} (${pct.toFixed(1)}%) - `
        + `Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}`)
    }
  }
  done() { if (this.tty) process.stdout.write('\n') }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `${C.bold}RedGifs Downloader v${VERSION}${C.reset} — zero-dependency Node CLI

Usage: node redgifs-dl.mjs [options]

Main:
  -u, --username <user>      Username or profile URL to download
  -b, --batch <file|list>    Path to a file with usernames, or comma-separated list
  -o, --root-path <dir>      Root path for downloaded files
  -d, --database-path <file> Path for the download-history JSON (default: redgifs-dl.json)

Performance:
  -c, --max-concurrency <n>  Maximum concurrent downloads (default: 50)
  -t, --timeout <sec>        Download timeout in seconds (default: 60)
  -r, --retries <n>          Retry attempts for failed downloads (default: 5)
      --quality <hd|sd>      Download quality (default: hd)

Other:
      --dry-run              Don't download, just show what would be downloaded
      --skip-history         Download files even if they are in the history
      --verbose              Enable verbose (debug) logging
      --version              Print version and exit
  -h, --help                 Show this help
`

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      username: { type: 'string', short: 'u' },
      batch: { type: 'string', short: 'b' },
      'root-path': { type: 'string', short: 'o' },
      'database-path': { type: 'string', short: 'd' },
      'max-concurrency': { type: 'string', short: 'c' },
      timeout: { type: 'string', short: 't' },
      retries: { type: 'string', short: 'r' },
      'dry-run': { type: 'boolean', default: false },
      'skip-history': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      quality: { type: 'string', default: 'hd' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })
  return values
}

async function readUsernames(args) {
  if (args.batch) {
    const p = args.batch
    if (existsSync(p) && (await fs.stat(p)).isFile()) {
      const text = await fs.readFile(p, 'utf-8')
      return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    }
    return args.batch.split(',').map((u) => u.trim()).filter(Boolean)
  }
  if (args.username) return [args.username]
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Enter RedGifs username to download: ')
  rl.close()
  return [answer.trim()].filter(Boolean)
}

function printSummary(result, dryRun) {
  if (dryRun) {
    console.log(`${C.green}Would download ${C.bold}${result.would_download}${C.reset}${C.green} `
      + `videos for ${C.bold}${result.username}${C.reset}`)
  } else {
    console.log(`${C.green}Downloaded ${C.bold}${result.downloaded}${C.reset}${C.green} `
      + `videos for ${C.bold}${result.username}${C.reset}`)
    console.log(`${C.yellow}Skipped: ${C.bold}${result.skipped}${C.reset}`)
    console.log(`${C.red}Failed: ${C.bold}${result.failed}${C.reset}`)
  }
  const mins = Math.floor(result.elapsed_time / 60)
  const secs = Math.floor(result.elapsed_time % 60)
  console.log(`${C.blue}Time taken: ${C.bold}${mins}m ${secs}s${C.reset}`)
  if (result.download_speed) {
    console.log(`${C.cyan}Download speed: ${C.bold}${result.download_speed.toFixed(2)}${C.reset}`
      + `${C.cyan} files/second${C.reset}`)
  }
}

async function main() {
  let args
  try {
    args = parseCli(process.argv.slice(2))
  } catch (e) {
    console.error(`${C.red}${e.message}${C.reset}\n`)
    process.stdout.write(HELP)
    process.exit(2)
  }

  if (args.help) { process.stdout.write(HELP); return }
  if (args.version) { console.log(`RedGifs Downloader v${VERSION}`); return }
  VERBOSE = args.verbose

  if (args.quality !== 'hd' && args.quality !== 'sd') {
    console.error(`${C.red}--quality must be 'hd' or 'sd'${C.reset}`)
    process.exit(2)
  }

  const config = makeConfig({
    rootPath: args['root-path'] || '',
    databasePath: args['database-path'] || 'redgifs-dl.json',
    maxConcurrentDownloads: args['max-concurrency'] ? parseInt(args['max-concurrency'], 10) : 50,
    downloadTimeout: args.timeout ? parseInt(args.timeout, 10) : 60,
    retryAttempts: args.retries ? parseInt(args.retries, 10) : 5,
    quality: args.quality
  })

  console.log(`${C.bold}${C.cyan}RedGifs Downloader v${VERSION}${C.reset}`)
  console.log(`${C.yellow}Super-fast, concurrent downloader for RedGifs content${C.reset}`)
  console.log(`${C.dim}Running on Node ${process.version} — ${process.platform} ${process.arch}${C.reset}\n`)

  const history = new HistoryStore(config.databasePath)
  await history.load()
  const api = new RedGifsAPI(config)
  const downloader = new Downloader(config, history, api)

  const usernames = await readUsernames(args)
  if (!usernames.length) { log.error('No username provided.'); process.exit(1) }

  const results = []
  try {
    for (const username of usernames) {
      try {
        console.log(`\n${C.bold}${'='.repeat(40)}\nProcessing ${username}\n${'='.repeat(40)}${C.reset}\n`)
        const result = await downloader.downloadUserContent(username, args['dry-run'], args['skip-history'])
        results.push(result)
        printSummary(result, args['dry-run'])
      } catch (e) {
        log.error(`Error processing ${username}: ${e}`)
      }
    }

    if (results.length > 1) {
      const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0)
      const downloaded = sum('downloaded'), skipped = sum('skipped'), failed = sum('failed')
      console.log(`\n${'='.repeat(40)}\nOverall Summary\n${'='.repeat(40)}`)
      console.log(`${C.green}Total Downloaded: ${downloaded}${C.reset}`)
      console.log(`${C.yellow}Total Skipped: ${skipped}${C.reset}`)
      console.log(`${C.red}Total Failed: ${failed}${C.reset}`)
      console.log(`${C.blue}Total Files Processed: ${downloaded + skipped + failed}${C.reset}`)
    }
  } finally {
    await history.close()
  }
}

// Node 18+ required for global fetch.
const major = parseInt(process.versions.node.split('.')[0], 10)
if (major < 18) {
  console.error(`This tool needs Node 18+ (for built-in fetch). You have ${process.version}.`)
  process.exit(1)
}

process.on('SIGINT', () => {
  console.error('\nDownload interrupted by user. Exiting...')
  process.exit(1)
})

main().catch((e) => {
  log.error(`Unhandled error: ${e?.stack || e}`)
  process.exit(1)
})
