import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted } from 'vue'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from '../src/App.vue'
import { defaults } from '../src/data/storage.js'

const setArt = vi.fn(async () => true)
const Studio = defineComponent({
  setup(_, { expose, emit }) {
    expose({
      setArt,
      nudge: vi.fn(),
      guides: vi.fn(),
      tone: vi.fn(),
      view: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    })
    onMounted(() => emit('ready'))
    return () => h('canvas', { 'data-testid': 'studio' })
  },
})
const Dialog = defineComponent({
  props: ['title'],
  setup(props, { slots }) {
    return () =>
      h('div', { role: 'dialog' }, [h('h2', props.title), slots.default?.()])
  },
})
const wrappers = []
function create() {
  const wrapper = mount(App, {
    props: { deployed: defaults(), loadError: '' },
    global: { stubs: { Studio, Dialog } },
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  history.replaceState({}, '', '/')
  localStorage.clear()
  setArt.mockClear()
  setArt.mockResolvedValue(true)
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  delete document.modelContext
})
describe('gallery flows', () => {
  it('selects a replacement with its registered size and updates the details', async () => {
    const w = create()
    await flushPromises()
    await w.findAll('.art-card')[1].trigger('click')
    await flushPromises()
    expect(w.find('.art-title').text()).toBe('午後のかたち')
    expect(w.find('.outer-dimensions').text()).toContain('70 × 70')
    expect(setArt.mock.lastCall[0].widthCm).toBe(60)
  })
  it('keeps the existing selection when the new work cannot fit on the wall', async () => {
    const w = create()
    await flushPromises()
    setArt.mockResolvedValueOnce(false)
    await w.findAll('.art-card')[1].trigger('click')
    await flushPromises()
    expect(w.find('.art-title').text()).toBe('青の余白')
  })
  it('does not expose management or unrelated artwork to the guest view', async () => {
    history.replaceState({}, '', '/?collection=quiet-room')
    const w = create()
    await flushPromises()
    expect(w.findAll('.art-card')).toHaveLength(3)
    expect(w.find('.header-nav').text()).not.toContain('コレクション管理')
    expect(
      w
        .findAll('.art-card')
        .map((a) => a.text())
        .join(' '),
    ).not.toContain('午後のかたち')
  })
  it('uses published content for guests even when local demo edits exist', async () => {
    const altered = defaults()
    altered.artworks[0].title = 'Local secret draft'
    localStorage.setItem('artar.catalog.v1', JSON.stringify(altered))
    history.replaceState({}, '', '/?collection=quiet-room')
    const w = create()
    await flushPromises()
    expect(w.find('.art-title').text()).toBe('青の余白')
  })
  it('shows an empty state for invalid distribution links', async () => {
    history.replaceState({}, '', '/?collection=unknown')
    const w = create()
    await flushPromises()
    expect(w.find('.empty-state').exists()).toBe(true)
    expect(w.findAll('.art-card')).toHaveLength(0)
  })
  it('validates the optional agent tool contract using the same selection action', async () => {
    const registry = new Map()
    document.modelContext = {
      registerTool: vi.fn((tool) => registry.set(tool.name, tool)),
    }
    const w = create()
    await flushPromises()
    expect([...registry.keys()]).toEqual(['list_artworks', 'select_artwork'])
    const select = registry.get('select_artwork')
    const result = await select.execute({ id: 'botanical' })
    expect(result.selected).toBe('botanical')
    expect(w.find('.art-title').text()).toBe('葉の記憶')
    await expect(select.execute({ id: 'missing' })).rejects.toThrow()
    expect(w.find('.art-title').text()).toBe('葉の記憶')
    expect(registry.get('list_artworks').execute().selected).toBe('botanical')
  })
})
