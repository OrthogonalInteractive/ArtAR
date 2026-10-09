import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Scene, Matrix4 } from 'three'
import { createARKitSession } from '../src/ar/arkit.js'
import { arBackend, arRequirementError } from '../src/ar/platform.js'

let driver, options, postMessage
const identity = new Matrix4().toArray()
const emit = (packet) => window.dispatchEvent(new CustomEvent('artar-arkit', {
  detail: { id: postMessage.mock.calls[0][0].id, ...packet },
}))
const frame = (packet = {}) => emit({ type: 'frame', tracking: 'normal',
  camera: identity, projection: identity, planes: [], ...packet })
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone' })
  postMessage = vi.fn()
  window.webkit = { messageHandlers: { artarAR: { postMessage } } }
  options = {
    renderer: { render: vi.fn(), clear: vi.fn(), setSize: vi.fn(), setAnimationLoop: vi.fn() },
    camera: new PerspectiveCamera(), scene: new Scene(),
    onFrame: vi.fn(), onEnd: vi.fn(), onError: vi.fn(), onReset: vi.fn(),
  }
  driver = createARKitSession(options)
})
afterEach(async () => {
  await driver.stop()
  delete window.webkit
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('ARKit native bridge', () => {
  it('requires the native bridge only in the isolated ARKit test build', () => {
    vi.stubEnv('VITE_REQUIRE_ARKIT', 'true')
    expect(arRequirementError()).toBeNull()
    delete window.webkit
    expect(arRequirementError()).toContain('TestFlight')
    vi.stubEnv('VITE_REQUIRE_ARKIT', undefined)
    expect(arRequirementError()).toBeNull()
    window.webkit = { messageHandlers: { artarAR: { postMessage } } }
  })
  it('selects the companion runtime only when its native handler exists', () => {
    expect(arBackend()).toBe('arkit')
    delete window.webkit
    expect(arBackend()).toBe('8thwall')
    navigator.xr = { requestSession() {} }
    expect(arBackend()).toBe('webxr')
    window.webkit = { messageHandlers: { artarAR: { postMessage } } }
  })
  it('waits for a pose and converts a real vertical polygon into a wall', async () => {
    const started = driver.start()
    const transform = new Matrix4().makeRotationX(Math.PI / 2)
    transform.setPosition(0, 1.5, -2)
    frame({ planes: [{ orientation: 'vertical', transform: transform.toArray(),
      polygon: [{ x: -1, y: 0, z: -1 }, { x: 1, y: 0, z: -1 },
        { x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }] }] })
    expect(await started).toBe(true)
    expect(options.onFrame.mock.calls.at(-1)[0]).toMatchObject({
      trackingStatus: 'NORMAL', nativeWalls: [{ source: 'arkit-plane' }],
    })
    expect(options.renderer.render).toHaveBeenCalledOnce()
    expect(document.documentElement.classList.contains('arkit-active')).toBe(true)
  })
  it('clears stale rendering when the native session is interrupted', async () => {
    const started = driver.start(); frame(); await started
    emit({ type: 'frame', tracking: 'interrupted' })
    expect(options.renderer.clear).toHaveBeenCalledOnce()
    expect(options.onFrame.mock.calls.at(-1)[0].trackingStatus).toBe('LIMITED')
  })
  it('ignores old session packets and drops malformed geometry', async () => {
    const started = driver.start()
    frame({ id: 'old-session' })
    expect(options.renderer.render).not.toHaveBeenCalled()
    frame({ planes: [{ transform: identity, orientation: 'vertical',
      polygon: [{ x: NaN, y: 0, z: 0 }, {}, {}] }] })
    await started
    expect(options.onFrame.mock.calls.at(-1)[0].nativeWalls).toEqual([])
  })
  it('cancels startup and detaches the native listener on stop', async () => {
    const started = driver.start()
    await driver.stop()
    expect(await started).toBe(false)
    frame()
    expect(options.renderer.render).not.toHaveBeenCalled()
    expect(document.documentElement.classList.contains('arkit-active')).toBe(false)
    expect(postMessage.mock.calls.at(-1)[0].action).toBe('stop')
  })
  it('drops null planes and invalid collections without crashing', async () => {
    const started = driver.start()
    frame({ planes: [null, {}] })
    expect(await started).toBe(true)
    frame({ planes: {} })
    expect(options.onError).not.toHaveBeenCalled()
    expect(options.onFrame.mock.calls.at(-1)[0].nativeWalls).toEqual([])
  })
  it('resizes the render buffer when the device rotates', async () => {
    const started = driver.start(); frame(); await started
    options.renderer.setSize.mockClear()
    vi.stubGlobal('innerWidth', 640)
    vi.stubGlobal('innerHeight', 360)
    frame()
    expect(options.renderer.setSize).toHaveBeenCalledWith(640, 360, false)
    frame()
    expect(options.renderer.setSize).toHaveBeenCalledOnce()
  })
  it('rejects a broken native transport and clears startup state', async () => {
    postMessage.mockImplementation(() => { throw new Error('transport failed') })
    await expect(driver.start()).rejects.toThrow('transport failed')
    expect(document.documentElement.classList.contains('arkit-active')).toBe(false)
    await expect(driver.stop()).resolves.toBeUndefined()
  })
  it('ends the session when rendering fails after startup', async () => {
    const started = driver.start(); frame(); await started
    options.renderer.render.mockImplementation(() => { throw new Error('render failed') })
    frame()
    expect(options.onError).toHaveBeenCalledWith('render failed')
    expect(options.onEnd).toHaveBeenCalledOnce()
    expect(document.documentElement.classList.contains('arkit-active')).toBe(false)
  })
  it('waits for normal tracking and rejects timeout', async () => {
    const started = driver.start()
    const rejected = expect(started).rejects.toThrow('応答')
    frame({ tracking: 'limited' })
    expect(options.renderer.render).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20000)
    await rejected
    expect(document.documentElement.classList.contains('arkit-active')).toBe(false)
  })
  it('rejects permission failure and handles coordinate resets', async () => {
    const failed = driver.start()
    const rejection = expect(failed).rejects.toThrow('カメラ')
    emit({ type: 'error', message: 'カメラ権限がありません。' })
    await rejection
    driver = createARKitSession(options)
    const started = driver.start()
    // The second driver has its own session ID.
    const id = postMessage.mock.calls.at(-1)[0].id
    frame({ id }); await started
    emit({ id, type: 'reset' })
    expect(options.onReset).toHaveBeenCalledOnce()
  })
})
