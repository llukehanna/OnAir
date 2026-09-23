import { register, getAdapter, getAllAdapters, clearAdapters } from '../../src/main/adapters/registry'
import { StubAdapter } from '../../src/main/adapters/sources/stub'

describe('Adapter Registry', () => {
  beforeEach(() => {
    clearAdapters()
  })

  afterEach(() => {
    clearAdapters()
  })

  it('register() stores adapter and getAdapter() retrieves it by sourceId', () => {
    const adapter = new StubAdapter()
    register(adapter)
    expect(getAdapter('stub')).toBe(adapter)
  })

  it('getAllAdapters() returns all registered adapters', () => {
    const adapter = new StubAdapter()
    register(adapter)
    const all = getAllAdapters()
    expect(all).toHaveLength(1)
    expect(all[0]).toBe(adapter)
  })

  it('getAdapter() returns undefined for unknown sourceId', () => {
    expect(getAdapter('nonexistent')).toBeUndefined()
  })

  it('clearAdapters() empties the registry', () => {
    const adapter = new StubAdapter()
    register(adapter)
    expect(getAllAdapters()).toHaveLength(1)
    clearAdapters()
    expect(getAllAdapters()).toHaveLength(0)
    expect(getAdapter('stub')).toBeUndefined()
  })

  it('getAllAdapters() returns empty array when nothing is registered', () => {
    expect(getAllAdapters()).toEqual([])
  })
})
