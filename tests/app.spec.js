import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onMounted } from 'vue'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import App from '../src/App.vue'
import { defaults } from '../src/data/storage.js'

const setArt = vi.fn(async () => true)
const setDebug = vi.fn()
const startAR = vi.fn(async () => true)
const place = vi.fn()
const reset = vi.fn()
const removeWall = vi.fn()
vi.mock('../src/ar/engine.js', () => ({
  prepareAR: vi.fn(async () => {}),
  cameraUnsupportedReason: () => null,
}))
const Studio = defineComponent({
  setup(_, { expose, emit }) {
    expose({
      setArt,
      setDebug,
      startAR,
      nudge: vi.fn(),
      guides: vi.fn(),
      tone: vi.fn(),
      view: vi.fn(),
      reset,
      place,
      removeWall,
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
  setDebug.mockClear()
  place.mockClear()
  reset.mockClear()
  removeWall.mockClear()
  startAR.mockReset().mockResolvedValue(true)
  setArt.mockResolvedValue(true)
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  delete document.modelContext
})
describe('gallery flows', () => {
  it('shows an asynchronous AR startup rejection and allows a new attempt', async () => {
    const w = create()
    await flushPromises()
    const arButton = w.findAll('button').find((b) => b.text().includes('ARで'))
    expect(arButton).toBeDefined()
    await arButton.trigger('click')
    await flushPromises()
    startAR.mockRejectedValueOnce(new Error('カメラの権限を確認してください'))
    const start = w
      .findAll('button')
      .find((b) => b.text().includes('カメラを開始'))
    await start.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('カメラの権限')
    expect(startAR).toHaveBeenCalledOnce()
    const retry = w.findAll('button').find((b) => b.text() === '再試行')
    await retry.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
  it('enables diagnostics from the shared debug URL and allows switching them off in AR', async () => {
    history.replaceState({}, '', '/?debug=1')
    const w = create()
    await flushPromises()
    expect(setDebug).toHaveBeenCalledWith(true)
    w.findComponent(Studio).vm.$emit('state', {
      mode: 'ar',
      placed: false,
      tracking: false,
    })
    await flushPromises()
    expect(w.find('.ar-debug-panel').exists()).toBe(true)
    await w.find('.debug-toggle').trigger('click')
    expect(setDebug).toHaveBeenLastCalledWith(false)
    expect(w.find('.ar-debug-panel').exists()).toBe(false)
  })
  it('explains dragging and removes the manual calibration and boundary flows', async () => {
    const w = create()
    await flushPromises()
    const studio = w.findComponent(Studio)
    studio.vm.$emit('state', {
      mode: 'ar',
      placed: true,
      tracking: true,
      artHint: { x: 50, y: 60 },
    })
    await flushPromises()
    expect(w.find('.art-drag-hint').text()).toContain('つかんで移動')
    expect(w.find('.ar-move-instruction').text()).toContain(
      '作品をドラッグして移動',
    )
    expect(
      w
        .find('.ar-mobile-bar')
        .findAll('button')
        .map((b) => b.text()),
    ).toEqual(['作品を切り替え', '壁の再検出'])
    expect(w.text()).not.toMatch(/実寸補正|実測してサイズ|飾れる範囲を指定/)
    studio.vm.$emit('state', { dragging: true })
    await flushPromises()
    expect(w.find('.art-drag-hint').text()).toContain('移動中')
    expect(w.find('.ar-move-instruction').text()).toContain('指を離して配置')
    studio.vm.$emit('state', {
      tracking: false,
      dragging: false,
      artHint: null,
    })
    await flushPromises()
    expect(w.find('.art-drag-hint').exists()).toBe(false)
    expect(w.find('.ar-move-instruction').text()).toContain('壁を再認識')
  })
  it('re-enables placement only for another focused wall without rescanning', async () => {
    const w = create()
    await flushPromises()
    const studio = w.findComponent(Studio)
    const update = async (value) => {
      studio.vm.$emit('state', value)
      await flushPromises()
    }
    const button = () => w.find('.scan-center .primary')
    await update({
      mode: 'ar',
      tracking: true,
      placed: false,
      focusedWallId: 'wall-a',
      placedWallId: null,
      canPlace: true,
    })
    expect(button().attributes('disabled')).toBeUndefined()
    await update({ placed: true, placedWallId: 'wall-a' })
    expect(button().exists()).toBe(false)
    await update({ focusedWallId: 'wall-b' })
    expect(button().text()).toBe('ここに飾る')
    expect(button().attributes('disabled')).toBeUndefined()
    await button().trigger('click')
    expect(place).toHaveBeenCalledOnce()
    expect(reset).not.toHaveBeenCalled()
    await update({ placedWallId: 'wall-b' })
    expect(button().exists()).toBe(false)
    await update({ focusedWallId: 'wall-a', canPlace: false })
    expect(button().attributes('disabled')).toBeDefined()
    expect(w.find('.scan-center').text()).toContain('収まりません')
    await update({ canPlace: true, dragging: true })
    expect(button().exists()).toBe(false)
    await update({ dragging: false, tracking: false })
    expect(button().exists()).toBe(false)
    await update({ tracking: true, focusedWallId: null, canPlace: false })
    expect(button().exists()).toBe(false)
    await w
      .findAll('.ar-mobile-bar button')
      .find((b) => b.text() === '壁の再検出')
      .trigger('click')
    expect(reset).toHaveBeenCalledOnce()
  })
  it('deletes only the focused plane and hides the action while dragging or tracking is lost', async () => {
    const w = create()
    await flushPromises()
    const studio = w.findComponent(Studio)
    const update = async (state) => {
      studio.vm.$emit('state', state)
      await flushPromises()
    }
    const button = () => w.find('.remove-plane')
    expect(button().exists()).toBe(false)
    await update({
      mode: 'ar',
      tracking: true,
      placed: true,
      focusedWallId: 'wall-a',
      placedWallId: 'wall-a',
      canPlace: true,
    })
    expect(w.find('.scan-center .primary').exists()).toBe(false)
    expect(w.find('.scan-reticle').exists()).toBe(true)
    expect(button().text()).toBe('平面を削除')
    expect(button().attributes('aria-label')).toBe('画面中央の平面を削除')
    await button().trigger('click')
    expect(removeWall).toHaveBeenLastCalledWith('wall-a')
    expect(reset).not.toHaveBeenCalled()
    await update({ focusedWallId: 'wall-b', canPlace: false })
    expect(button().attributes('disabled')).toBeUndefined()
    await button().trigger('click')
    expect(removeWall).toHaveBeenLastCalledWith('wall-b')
    for (const state of [
      { dragging: true },
      { dragging: false, tracking: false },
      { tracking: true, focusedWallId: null },
    ]) {
      await update(state)
      expect(button().exists()).toBe(false)
    }
    await update({ focusedWallId: 'wall-a' })
    await w.find('.ar-mobile-bar button').trigger('click')
    expect(button().exists()).toBe(false)
  })
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
