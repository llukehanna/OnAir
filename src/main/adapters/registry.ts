import type { SourceAdapter } from './base'

const adapters = new Map<string, SourceAdapter>()

export function register(adapter: SourceAdapter): void {
  adapters.set(adapter.sourceId, adapter)
}

export function getAdapter(sourceId: string): SourceAdapter | undefined {
  return adapters.get(sourceId)
}

export function getAllAdapters(): SourceAdapter[] {
  return Array.from(adapters.values())
}

export function clearAdapters(): void {
  adapters.clear()
}
