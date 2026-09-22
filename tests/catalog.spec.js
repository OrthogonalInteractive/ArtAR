import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  defaults,
  validateArtwork,
  validateCatalog,
  saveCatalog,
  loadCatalog,
  resolveCollection,
  collectionUrl,
} from '../src/data/storage.js'
beforeEach(() => localStorage.clear())
describe('catalog and guest distribution', () => {
  it('saves dimensions and collection membership together', () => {
    const data = defaults()
    data.artworks[0].widthCm = 90
    data.collections[0].artworkIds = [data.artworks[0].id]
    saveCatalog(data)
    expect(loadCatalog().data.artworks[0].widthCm).toBe(90)
    expect(
      resolveCollection(loadCatalog().data, '?collection=all').artworks,
    ).toHaveLength(1)
  })
  it('fails closed for unknown or empty guest identifiers', () => {
    expect(
      resolveCollection(defaults(), '?collection=missing').artworks,
    ).toEqual([])
    expect(resolveCollection(defaults(), '?collection=').guest).toBe(true)
    expect(resolveCollection(defaults(), '?collection=').artworks).toEqual([])
  })
  it('does not leak unrelated artworks through a filtered collection', () => {
    const result = resolveCollection(defaults(), '?collection=quiet-room')
    expect(result.artworks.map((a) => a.id)).toEqual([
      'still-blue',
      'botanical',
      'tidelines',
    ])
    expect(result.guest).toBe(true)
  })
  it('rejects malformed sizes and unsafe imported assets', () => {
    const art = defaults().artworks[0]
    for (const widthCm of [NaN, -1, 0, 301, '50'])
      expect(() => validateArtwork({ ...art, widthCm })).toThrow()
    for (const image of [
      'javascript:alert(1)',
      'https://tracking.example/a.png',
      'data:image/svg+xml,<svg/>',
    ])
      expect(() => validateArtwork({ ...art, image })).toThrow()
  })
  it('rejects duplicate IDs and dangling distribution references', () => {
    const data = defaults()
    data.artworks.push({ ...data.artworks[0] })
    expect(() => validateCatalog(data)).toThrow()
    const second = defaults()
    second.collections[0].artworkIds.push('missing')
    expect(() => validateCatalog(second)).toThrow()
  })
  it('keeps repository paths in QR links and removes obsolete query parameters', () => {
    expect(
      collectionUrl(
        'quiet-room',
        'https://example.github.io/ArtAR/?debug=1#test',
      ),
    ).toBe('https://example.github.io/ArtAR/?collection=quiet-room')
  })
  it('recovers corrupt local data using the deployed catalog and reports it', () => {
    localStorage.setItem('artar.catalog.v1', '{broken')
    const deployed = defaults()
    deployed.artworks[0].title = 'Published'
    const loaded = loadCatalog(deployed)
    expect(loaded.data.artworks[0].title).toBe('Published')
    expect(loaded.error).toBeTruthy()
  })
  it('reports failed persistence rather than pretending it was saved', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota')
      })
    expect(() => saveCatalog(defaults())).toThrow('保存')
    spy.mockRestore()
  })
})
