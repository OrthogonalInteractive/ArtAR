import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Matrix4, PerspectiveCamera, Group, WebGLRenderer } from 'three'
import {
  createExperience,
  prepareAR,
  cameraUnsupportedReason,
} from '../src/ar/engine.js'
import { arBackend } from '../src/ar/platform.js'
import { seedArtworks } from '../src/data/catalog.js'

vi.mock('three', async (original) => ({
  ...(await original()),
  WebGLRenderer: class {
    static all = []
    shadowMap = {}
    constructor() {
      WebGLRenderer.all.push(this)
    }
    xr = {
      setReferenceSpaceType: vi.fn(),
      setSession: vi.fn(async () => {}),
      getReferenceSpace: () => window.testSpace,
    }
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
    render = vi.fn()
    clear = vi.fn()
    dispose = vi.fn()
    setAnimationLoop(callback) {
      this.loop = callback
    }
  },
}))
vi.mock('../src/ar/artwork.js', async (original) => ({
  ...(await original()),
  createArtwork: vi.fn(async () => new Group()),
}))

let engine, host, canvas, states, errors, session, source, renderer, now
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('testSpace', new EventTarget())
  vi.stubGlobal('XRRay', class {})
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  session = new EventTarget()
  source = { cancel: vi.fn() }
  Object.assign(session, {
    visibilityState: 'visible',
    domOverlayState: { type: 'screen' },
    depthUsage: 'cpu-optimized',
    requestReferenceSpace: vi.fn(async () => ({})),
    requestHitTestSource: vi.fn(async () => source),
    end: vi.fn(async () => session.dispatchEvent(new Event('end'))),
  })
  vi.stubGlobal('navigator', {
    userAgent: 'Android Chrome',
    platform: 'Linux',
    xr: {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => session),
    },
  })
  vi.stubGlobal('XR8', { stop: vi.fn() })
  canvas = document.createElement('canvas')
  host = document.createElement('div')
  host.className = 'app-shell'
  host.appendChild(canvas)
  document.body.appendChild(host)
  vi.spyOn(
    HTMLCanvasElement.prototype,
    'getBoundingClientRect',
  ).mockReturnValue({ left: 0, top: 0, width: 360, height: 640 })
  states = []
  errors = []
  engine = createExperience({
    canvas,
    onState: (s) => states.push(s),
    onError: (e) => errors.push(e),
  })
})
afterEach(async () => {
  engine.dispose()
  await flush()
  document.body.replaceChildren()
  WebGLRenderer.all = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function start() {
  await engine.setArt(seedArtworks[0])
  const starting = engine.startAR(host)
  // Session acquisition must happen before any asynchronous work loses the user gesture.
  expect(navigator.xr.requestSession).toHaveBeenCalledOnce()
  await starting
  renderer = WebGLRenderer.all.at(-1)
  await flush()
}
function frame({
  tracked = true,
  depth = true,
  native = false,
  hits = [],
} = {}) {
  now += 700
  const camera = new PerspectiveCamera(60, 360 / 640, 0.05, 30)
  const view = {
    projectionMatrix: camera.projectionMatrix.elements,
    transform: { matrix: new Matrix4().makeTranslation(0, 1.5, 0).elements },
  }
  const plane = {
    orientation: 'vertical',
    planeSpace: {},
    polygon: [
      { x: -1, y: 0, z: -1 },
      { x: 1, y: 0, z: -1 },
      { x: 1, y: 0, z: 1 },
      { x: -1, y: 0, z: 1 },
    ],
  }
  const f = {
    getViewerPose: () =>
      tracked ? { views: [view], emulatedPosition: false } : null,
    getDepthInformation: () => (depth ? { getDepthInMeters: () => 2 } : null),
    getHitTestResults: () => {
      const point = hits.shift()
      return point
        ? [
            {
              getPose: () => ({
                transform: {
                  matrix: new Matrix4()
                    .makeRotationX(Math.PI / 2)
                    .setPosition(...point).elements,
                },
              }),
            },
          ]
        : []
    },
    detectedPlanes: new Set(native ? [plane] : []),
    getPose: () => ({
      transform: {
        matrix: new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 1.5, -2)
          .elements,
      },
    }),
  }
  renderer.loop(now, f)
}

describe('Android WebXR routing and lifecycle', () => {
  it('prepares Android without loading 8th Wall and leaves iOS/iPadOS routed to XR8', async () => {
    expect(cameraUnsupportedReason()).toBeNull()
    await prepareAR()
    expect(navigator.xr.isSessionSupported).toHaveBeenCalledWith('immersive-ar')
    expect(document.querySelector('script[src*="8thwall"]')).toBeNull()
    expect(arBackend()).toBe('webxr')
    navigator.userAgent = 'iPhone Safari'
    expect(arBackend()).toBe('8thwall')
    expect(await prepareAR()).toBe(window.XR8)
    navigator.userAgent = 'Macintosh Safari'
    navigator.platform = 'MacIntel'
    navigator.maxTouchPoints = 5
    expect(arBackend()).toBe('8thwall')
  })
  it('reports unsupported Android and never silently starts XR8', async () => {
    navigator.xr.isSessionSupported.mockResolvedValue(false)
    await expect(prepareAR()).rejects.toThrow('WebXR')
    delete navigator.xr
    expect(cameraUnsupportedReason()).toContain('ARCore')
    await expect(engine.startAR(host)).rejects.toThrow('WebXR')
    expect(engine.mode).toBe('preview')
  })
  it('uses metric depth for a vertical wall, keeps placement on swap and hides tracking loss', async () => {
    engine.setDebug(true)
    await start()
    expect(navigator.xr.requestSession.mock.calls[0][1]).toMatchObject({
      requiredFeatures: ['local', 'hit-test', 'dom-overlay'],
      optionalFeatures: ['depth-sensing', 'plane-detection'],
      domOverlay: { root: host },
    })
    frame()
    frame()
    frame()
    expect(states.at(-1)).toMatchObject({
      backend: 'webxr',
      tracking: true,
      canPlace: true,
      debug: {
        backend: 'webxr',
        webxr: { depth: 'active', pointSource: 'depth' },
      },
    })
    expect(engine.place()).toBe(true)
    expect(states.at(-1).wallSource).toBe('webxr-depth')
    engine.nudge(0.01, 0)
    expect(states.at(-1).position.x).toBeCloseTo(0.01)
    expect(await engine.setArt(seedArtworks[1])).toBe(true)
    expect(states.at(-1).placed).toBe(true)
    frame({ tracked: false })
    expect(states.at(-1)).toMatchObject({
      tracking: false,
      canPlace: false,
      debug: { visible: false },
    })
    expect(engine.place()).toBe(false)
    expect(renderer.clear).toHaveBeenCalled()
    engine.stopAR()
    await flush()
    expect(session.end).toHaveBeenCalledOnce()
    expect(source.cancel).toHaveBeenCalled()
    expect(renderer.loop).toBeNull()
    expect(engine.mode).toBe('preview')
    expect(window.XR8.stop).not.toHaveBeenCalled()
    expect(canvas.hidden).toBe(false)
  })
  it('uses native polygons when Depth is unavailable and clears placement on origin reset', async () => {
    Object.defineProperty(session, 'depthUsage', {
      get() {
        throw new DOMException('Depth not enabled', 'InvalidStateError')
      },
    })
    engine.setDebug(true)
    await start()
    frame({ depth: false, native: true })
    frame({ depth: false, native: true })
    frame({ depth: false, native: true })
    expect(engine.place()).toBe(true)
    expect(states.at(-1).wallSource).toBe('webxr-plane')
    expect(states.at(-1).debug.webxr.depth).toBe('unavailable')
    window.testSpace.dispatchEvent(new Event('reset'))
    expect(states.at(-1)).toMatchObject({
      placed: false,
      canPlace: false,
      wallCount: 0,
    })
  })
  it('restores the preview on permission rejection and supports retry', async () => {
    navigator.xr.requestSession.mockRejectedValueOnce(
      new DOMException('Denied', 'NotAllowedError'),
    )
    await expect(engine.startAR(host)).rejects.toThrow('許可')
    expect(engine.mode).toBe('preview')
    expect(canvas.hidden).toBe(false)
    navigator.xr.requestSession.mockClear()
    await start()
    expect(engine.mode).toBe('ar')
  })
  it('scans real wall hits without Depth or plane polygons, and rejects an oversized replacement', async () => {
    session.depthUsage = undefined
    engine.setDebug(true)
    await start()
    for (let row = 0; row < 8; row++) {
      frame({
        depth: false,
        hits: [-0.9, -0.45, 0, 0.45, 0.9].map((x) => [x, 0.6 + row * 0.3, -2]),
      })
    }
    expect(states.at(-1).debug.webxr).toMatchObject({
      pointSource: 'hit-test',
      depth: 'unavailable',
    })
    expect(engine.place()).toBe(true)
    expect(states.at(-1).wallSource).toBe('webxr-hit-test')
    expect(
      await engine.setArt({ ...seedArtworks[0], widthCm: 300, heightCm: 300 }),
    ).toBe(false)
    expect(states.at(-1).placed).toBe(true)
  })
  it('ends the session when hit-test setup fails, and when DOM overlay is missing', async () => {
    session.requestHitTestSource.mockRejectedValue(
      new Error('Hit test unavailable'),
    )
    await expect(engine.startAR(host)).rejects.toThrow('Hit test unavailable')
    expect(session.end).toHaveBeenCalledOnce()
    expect(engine.mode).toBe('preview')
    session.domOverlayState = null
    await expect(engine.startAR(host)).rejects.toThrow('操作画面')
    expect(engine.mode).toBe('preview')
  })
  it('handles the browser exit button and permits another session', async () => {
    await start()
    session.dispatchEvent(new Event('end'))
    expect(engine.mode).toBe('preview')
    expect(session.end).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })
  it('ends a late session if the user exits while permissions are pending', async () => {
    let resolve
    navigator.xr.requestSession.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const pending = engine.startAR(host)
    engine.stopAR()
    resolve(session)
    expect(await pending).toBe(false)
    expect(session.end).toHaveBeenCalledOnce()
    expect(engine.mode).toBe('preview')
  })
  it('stops the camera on page hide and on disposal', async () => {
    await start()
    window.dispatchEvent(new Event('pagehide'))
    await flush()
    expect(session.end).toHaveBeenCalledOnce()
    expect(engine.mode).toBe('preview')
  })
})
