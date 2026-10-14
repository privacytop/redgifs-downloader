/** Small least-recently-used cache backed by insertion-ordered Map semantics. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>()
  private readonly capacity: number

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('LRU capacity must be a positive integer')
    }
    this.capacity = capacity
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size <= this.capacity) return
    const oldest = this.entries.keys().next().value as K | undefined
    if (oldest !== undefined) this.entries.delete(oldest)
  }

  delete(key: K): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
