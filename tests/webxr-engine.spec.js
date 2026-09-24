import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Matrix4,
  Vector3,
  PerspectiveCamera,
  Group,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  WebGLRenderer,
} from 'three'
import {
  createExperience,
  prepareAR,
  cameraUnsupportedReason,
} from '../src/ar/engine.js'
import { arBackend } from '../src/ar/platform.js'
import { seedArtworks, artDimensions } from '../src/data/catalog.js'

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
    render = vi.fn((scene, camera) => {
      scene.updateMatrixWorld()
      camera.updateMatrixWorld()
    })
    clear = vi.fn()
    dispose = vi.fn()
    setAnimationLoop(callback) {
      this.loop = callback
    }
  },
}))
vi.mock('../src/ar/artwork.js', async (original) => ({
  ...(await original()),
  createArtwork: vi.fn(async (art) => {
    const model = new Group(),
      size = artDimensions(art)
    model.name = 'test-artwork'
    model.add(
      new Mesh(
        new PlaneGeometry(size.width, size.height),
        new MeshBasicMaterial(),
      ),
    )
    return model
  }),
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
    onState: (s) => states.push({ ...states.at(-1), ...s }),
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
  depthMeters = 2,
  native = false,
  nativeSize = 1,
  extraPlanes = [],
  ceilingHeight = null,
  floorHeight = null,
  hits = [],
  yaw = 0,
  elapsed = 700,
} = {}) {
  now += elapsed
  const camera = new PerspectiveCamera(60, 360 / 640, 0.05, 30)
  const view = {
    projectionMatrix: camera.projectionMatrix.elements,
    transform: {
      matrix: new Matrix4().makeRotationY(yaw).setPosition(0, 1.5, 0).elements,
    },
  }
  const plane = {
    orientation: 'vertical',
    planeSpace: {
      matrix: new Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 1.5, -2),
    },
    polygon: [
      { x: -nativeSize, y: 0, z: -nativeSize },
      { x: nativeSize, y: 0, z: -nativeSize },
      { x: nativeSize, y: 0, z: nativeSize },
      { x: -nativeSize, y: 0, z: nativeSize },
    ],
  }
  const horizontal = [
    ['ceiling', ceilingHeight],
    ['floor', floorHeight],
  ]
    .filter(([, height]) => height !== null)
    .map(([kind, height]) => ({
      orientation: 'horizontal',
      semanticLabel: kind,
      planeSpace: {
        matrix: new Matrix4()
          .makeRotationZ(kind === 'ceiling' ? Math.PI : 0)
          .setPosition(0, height, -1.3),
      },
      polygon: [
        { x: -2, y: 0, z: -1 },
        { x: 2, y: 0, z: -1 },
        { x: 2, y: 0, z: 1 },
        { x: -2, y: 0, z: 1 },
      ],
    }))
  const f = {
    getViewerPose: () =>
      tracked ? { views: [view], emulatedPosition: false } : null,
    getDepthInformation: () =>
      depth ? { getDepthInMeters: () => depthMeters } : null,
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
    detectedPlanes: new Set([
      ...(native ? [plane] : []),
      ...extraPlanes,
      ...horizontal,
    ]),
    getPose: (space) => ({
      transform: {
        matrix: space.matrix.elements,
      },
    }),
  }
  renderer.loop(now, f)
}

describe('Android WebXR routing and lifecycle', () => {
  it('keeps hidden planes hidden through detection, dragging, artwork swaps and tracking recovery', async () => {
    engine.setDebug(true)
    await start()
    engine.setPlanesVisible(false)
    for (let i = 0; i < 3; i++) frame()
    const scene = renderer.render.mock.lastCall[0]
    const surfaces = scene.getObjectByName('artar-wall-surfaces')
    const debug = scene.getObjectByName('artar-debug')
    expect(states.at(-1)).toMatchObject({ planesVisible: false, wallCount: 1 })
    expect(surfaces.visible).toBe(false)
    expect(debug.visible).toBe(false)
    expect(engine.place()).toBe(true)
    const id = states.at(-1).placedWallId
    const position = scene.getObjectByName('test-artwork').position.clone()
    expect(await engine.setArt(seedArtworks[1])).toBe(true)
    const model = scene.getObjectByName('test-artwork')
    expect(model.position).toEqual(position)
    expect(model.visible).toBe(true)
    expect(model.getObjectByName('artar-drag-outline').visible).toBe(false)
    expect(states.at(-1).artHint).toBeNull()
    const arCanvas = host.querySelector('.ar-canvas')
    arCanvas.setPointerCapture = vi.fn()
    const pointer = (type, x) => {
      const event = new MouseEvent(type, {
        button: 0,
        clientX: x,
        clientY: 320,
      })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      arCanvas.dispatchEvent(event)
    }
    pointer('pointerdown', 180)
    pointer('pointermove', 220)
    expect(states.at(-1).dragging).toBe(true)
    expect(model.position.x).toBeGreaterThan(position.x)
    frame()
    expect(surfaces.visible).toBe(false)
    pointer('pointerup', 220)
    frame({ tracked: false })
    expect(model.visible).toBe(false)
    frame()
    expect(model.visible).toBe(true)
    expect(surfaces.visible).toBe(false)
    expect(debug.visible).toBe(false)
    const moved = model.position.clone()
    engine.setPlanesVisible(true)
    expect(surfaces.visible).toBe(true)
    expect(debug.visible).toBe(true)
    expect(model.getObjectByName('artar-drag-outline').visible).toBe(true)
    expect(model.position).toEqual(moved)
    expect(states.at(-1)).toMatchObject({
      placedWallId: id,
      wallCount: 1,
      planesVisible: true,
    })
    engine.setPlanesVisible(false)
    engine.reset()
    expect(states.at(-1)).toMatchObject({ planesVisible: true, wallCount: 0 })
  })
  const nativePlane = (x, z, yaw, width = 1, height = 1) => ({
    orientation: 'vertical',
    planeSpace: {
      matrix: new Matrix4()
        .makeRotationY(yaw)
        .multiply(new Matrix4().makeRotationX(Math.PI / 2))
        .setPosition(x, 1.5, z),
    },
    polygon: [
      { x: -width, y: 0, z: -height },
      { x: width, y: 0, z: -height },
      { x: width, y: 0, z: height },
      { x: -width, y: 0, z: height },
    ],
  })
  it('moves artwork from a deleted wall to the nearest fitting wall and retains the other walls', async () => {
    engine.setDebug(true)
    await start()
    const extraPlanes = [
      nativePlane(-1.2, -1, Math.PI / 2),
      nativePlane(2, -1, -Math.PI / 2),
    ]
    for (let i = 0; i < 3; i++)
      frame({ depth: false, native: true, extraPlanes })
    expect(states.at(-1).wallCount).toBe(3)
    const id = states.at(-1).focusedWallId
    expect(engine.place()).toBe(true)
    const scene = renderer.render.mock.lastCall[0],
      model = scene.getObjectByName('test-artwork')
    const before = model.position.clone()
    expect(engine.removeWall('missing')).toBe(false)
    expect(engine.removeWall(id)).toBe(true)
    expect(states.at(-1)).toMatchObject({ placed: true, wallCount: 2 })
    expect(states.at(-1).placedWallId).not.toBe(id)
    expect(model.position.x).toBeCloseTo(-1.192)
    expect(model.position.y).toBeCloseTo(before.y)
    expect(model.position.z).toBeCloseTo(-2)
    expect(
      new Vector3(0, 0, 1).applyQuaternion(model.quaternion).x,
    ).toBeCloseTo(1)
    expect(model.scale.toArray()).toEqual([1, 1, 1])
    expect(scene.getObjectByName(`surface-${id}`)).toBeUndefined()
    expect(states.at(-1).debug.wallCount).toBe(2)
    for (let i = 0; i < 6; i++)
      frame({ depth: false, native: true, extraPlanes })
    expect(states.at(-1).wallCount).toBe(2)
    expect(model.position.x).toBeCloseTo(-1.192)
  })
  it('deletes an unoccupied focused wall without moving the artwork on another wall', async () => {
    await start()
    for (let i = 0; i < 3; i++) frame()
    expect(engine.place()).toBe(true)
    const original = states.at(-1).placedWallId
    const scene = renderer.render.mock.lastCall[0],
      model = scene.getObjectByName('test-artwork')
    const position = model.position.clone(),
      rotation = model.quaternion.clone()
    for (let i = 0; i < 3; i++) frame({ yaw: Math.PI / 2 })
    const side = states.at(-1).focusedWallId
    expect(engine.removeWall(original)).toBe(false) // It is no longer highlighted.
    expect(engine.removeWall(side)).toBe(true)
    expect(states.at(-1)).toMatchObject({
      placedWallId: original,
      wallCount: 1,
    })
    expect(model.position).toEqual(position)
    expect(model.quaternion.toArray()).toEqual(rotation.toArray())
  })
  it.each([true, false])(
    'skips a nearer plane that cannot fit the frame (larger alternative: %s)',
    async (hasAlternative) => {
      await start()
      const extraPlanes = [nativePlane(-1.2, -1, Math.PI / 2, 0.25)]
      if (hasAlternative) extraPlanes.push(nativePlane(0, -6.5, 0, 3))
      for (let i = 0; i < 3; i++)
        frame({ depth: false, native: true, nativeSize: 3, extraPlanes })
      expect(await engine.setArt({ ...seedArtworks[0], widthCm: 480 })).toBe(
        true,
      )
      expect(engine.place()).toBe(true)
      const scene = renderer.render.mock.lastCall[0],
        model = scene.getObjectByName('test-artwork')
      expect(engine.removeWall(states.at(-1).focusedWallId)).toBe(true)
      expect(states.at(-1).placed).toBe(hasAlternative)
      expect(model.visible).toBe(hasAlternative)
      if (hasAlternative) expect(model.position.z).toBeCloseTo(-6.492)
    },
  )
  it('removes a plane before placement without placing artwork automatically', async () => {
    await start()
    const extraPlanes = [nativePlane(-1.2, -1, Math.PI / 2)]
    for (let i = 0; i < 3; i++)
      frame({ depth: false, native: true, extraPlanes })
    expect(engine.removeWall(states.at(-1).focusedWallId)).toBe(true)
    expect(states.at(-1)).toMatchObject({ placed: false, wallCount: 1 })
  })
  it('lets corrected depth replace a deleted native plane even if the native API keeps returning it', async () => {
    await start()
    for (let i = 0; i < 3; i++) frame({ native: true })
    expect(engine.removeWall(states.at(-1).focusedWallId)).toBe(true)
    for (let i = 0; i < 3; i++) frame({ native: true, depthMeters: 2.2 })
    expect(states.at(-1).wallCount).toBe(1)
    expect(engine.place()).toBe(true)
    expect(states.at(-1).wallSource).toBe('webxr-depth')
    const scene = renderer.render.mock.lastCall[0]
    expect(scene.getObjectByName('test-artwork').position.z).toBeCloseTo(-2.192)
  })
  it.each([
    { source: 'native', observation: { depth: false, native: true } },
    { source: 'depth', observation: { depth: true } },
  ])(
    'clears placement when deleting the only $source wall and excludes it until reset',
    async ({ observation }) => {
      engine.setDebug(true)
      await start()
      for (let i = 0; i < 3; i++) frame(observation)
      expect(engine.place()).toBe(true)
      const id = states.at(-1).focusedWallId
      const scene = renderer.render.mock.lastCall[0],
        model = scene.getObjectByName('test-artwork')
      frame({ ...observation, tracked: false })
      expect(engine.removeWall(id)).toBe(false)
      frame(observation)
      expect(engine.removeWall(id)).toBe(true)
      expect(states.at(-1)).toMatchObject({
        placed: false,
        placedWallId: null,
        wallCount: 0,
        canPlace: false,
      })
      expect(model.visible).toBe(false)
      for (let i = 0; i < 6; i++) frame(observation)
      expect(states.at(-1).wallCount).toBe(0)
      expect(states.at(-1).debug.trackedWalls).toEqual([])
      expect(states.at(-1).debug.candidates).toEqual([])
      engine.reset()
      for (let i = 0; i < 3; i++) frame(observation)
      expect(states.at(-1).wallCount).toBe(1)
      expect(engine.place()).toBe(true)
    },
  )
  it('places beyond a small patch, refits below a later ceiling and clears bounds on rescan', async () => {
    engine.setDebug(true)
    await start()
    const observation = { depth: false, native: true, nativeSize: 0.3 }
    for (let i = 0; i < 3; i++) frame(observation)
    expect(engine.place()).toBe(true) // The .6m measured patch is smaller than the framed artwork.
    engine.nudge(0.5, 1.2)
    const scene = renderer.render.mock.lastCall[0]
    const model = scene.getObjectByName('test-artwork')
    expect(model.position.y).toBeCloseTo(2.7)
    const rotation = model.quaternion.clone()
    const id = states.at(-1).placedWallId
    for (let i = 0; i < 3; i++) frame({ ...observation, ceilingHeight: 2.1 })
    expect(states.at(-1)).toMatchObject({
      placed: true,
      placedWallId: id,
      wallCount: 1,
      debug: { ceilingCount: 1, floorCount: 0 },
    })
    expect(model.position.y).toBeCloseTo(
      2.1 - artDimensions(seedArtworks[0]).height / 2 - 0.02,
    )
    expect(model.position.z).toBeCloseTo(-1.992)
    expect(model.quaternion.toArray()).toEqual(rotation.toArray())
    // A newly discovered room too small for the full frame must release placement.
    expect(
      await engine.setArt({ ...seedArtworks[0], widthCm: 100, heightCm: 200 }),
    ).toBe(true)
    for (let i = 0; i < 3; i++)
      frame({ ...observation, ceilingHeight: 2.1, floorHeight: 0.3 })
    expect(states.at(-1)).toMatchObject({
      placed: false,
      wallCount: 1,
      debug: { ceilingCount: 1, floorCount: 1 },
    })
    expect(scene.getObjectByName('test-artwork').visible).toBe(false)
    engine.reset()
    for (let i = 0; i < 3; i++) frame(observation)
    expect(states.at(-1)).toMatchObject({
      canPlace: true,
      debug: { ceilingCount: 0, floorCount: 0 },
    })
    expect(engine.place()).toBe(true)
  })
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
  it('shows confirmed walls without debug, highlights dragging, and clears feedback on tracking loss and reset', async () => {
    await start()
    frame()
    frame()
    const scene = renderer.render.mock.lastCall[0]
    const surfaces = scene.getObjectByName('artar-wall-surfaces')
    expect(surfaces.children).toHaveLength(0)
    frame()
    expect(surfaces.visible).toBe(true)
    expect(surfaces.children).toHaveLength(1)
    expect(scene.getObjectByName('artar-debug')).toBeUndefined()
    const fill = surfaces.getObjectByName('wall-fill')
    expect(fill.material.opacity).toBeGreaterThan(0.18)
    expect(engine.place()).toBe(true)
    frame()
    const idleOpacity = fill.material.opacity
    expect(states.at(-1).artHint).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    })
    expect(scene.getObjectByName('test-artwork').scale.toArray()).toEqual([
      1, 1, 1,
    ])
    expect(scene.getObjectByName('artar-drag-outline')).toBeDefined()
    const arCanvas = host.querySelector('.ar-canvas')
    arCanvas.setPointerCapture = vi.fn()
    const pointer = (type, x = 200, id = 1) => {
      const event = new MouseEvent(type, {
        button: 0,
        clientX: x,
        clientY: 320,
      })
      Object.defineProperty(event, 'pointerId', { value: id })
      arCanvas.dispatchEvent(event)
    }
    const before = states.at(-1).position
    pointer('pointerdown')
    expect(states.at(-1).position).toEqual(before) // Holding off-center must not jump the artwork.
    expect(states.at(-1).dragging).toBe(true)
    expect(fill.material.opacity).toBeGreaterThan(0.3)
    expect(arCanvas.classList.contains('is-dragging')).toBe(true)
    pointer('pointermove', 230)
    expect(states.at(-1).position.x).toBeGreaterThan(before.x)
    pointer('pointerdown', 100, 2)
    pointer('pointerup', 100, 2)
    expect(states.at(-1).dragging).toBe(true)
    pointer('pointercancel', 230)
    expect(states.at(-1).dragging).toBe(false)
    expect(fill.material.opacity).toBe(idleOpacity)
    pointer('pointerdown', 230)
    frame({ tracked: false })
    expect(surfaces.visible).toBe(false)
    expect(states.at(-1)).toMatchObject({
      dragging: false,
      artHint: null,
      canPlace: false,
    })
    expect(arCanvas.classList.contains('is-dragging')).toBe(false)
    frame()
    expect(surfaces.visible).toBe(true)
    engine.reset()
    expect(surfaces.children).toHaveLength(0)
    expect(states.at(-1)).toMatchObject({ placed: false, artHint: null })
  })
  it('moves between retained walls using the current camera focus without a reset', async () => {
    await start()
    for (let i = 0; i < 3; i++) frame()
    const front = states.at(-1).focusedWallId
    expect(engine.place()).toBe(true)
    expect(states.at(-1).placedWallId).toBe(front)
    const scene = renderer.render.mock.lastCall[0]
    const model = scene.getObjectByName('test-artwork')
    const initialPosition = model.position.clone()
    for (let i = 0; i < 3; i++) frame({ yaw: Math.PI / 2 })
    const side = states.at(-1).focusedWallId
    expect(side).not.toBe(front)
    expect(states.at(-1)).toMatchObject({
      placedWallId: front,
      canPlace: true,
      wallCount: 2,
    })
    expect(model.position).toEqual(initialPosition)
    expect(engine.place()).toBe(true)
    expect(states.at(-1)).toMatchObject({
      placedWallId: side,
      focusedWallId: side,
      wallCount: 2,
    })
    expect(model.position.x).toBeCloseTo(-1.992)
    expect(
      new Vector3(0, 0, 1).applyQuaternion(model.quaternion).x,
    ).toBeCloseTo(1)
    // Camera aiming must update before the next 650ms wall-detection cycle.
    frame({ depth: false, yaw: 0, elapsed: 100 })
    expect(states.at(-1)).toMatchObject({
      placedWallId: side,
      focusedWallId: front,
      canPlace: true,
      wallCount: 2,
    })
    expect(engine.place()).toBe(true)
    expect(model.position).toEqual(initialPosition)
    frame({ depth: false, yaw: Math.PI, elapsed: 100 })
    expect(states.at(-1)).toMatchObject({
      focusedWallId: null,
      placedWallId: front,
      canPlace: false,
    })
    expect(engine.place()).toBe(false)
    expect(model.position).toEqual(initialPosition)
    engine.reset()
    expect(states.at(-1)).toMatchObject({
      focusedWallId: null,
      placedWallId: null,
      placed: false,
      wallCount: 0,
      canPlace: false,
    })
  })
  it('never moves placed art onto a duplicate depth layer in front of its wall', async () => {
    await start()
    for (let i = 0; i < 3; i++) frame()
    expect(engine.place()).toBe(true)
    const scene = renderer.render.mock.lastCall[0]
    const surfaces = scene.getObjectByName('artar-wall-surfaces')
    const model = scene.getObjectByName('test-artwork')
    const position = model.position.clone()
    for (let i = 0; i < 6; i++) frame({ depthMeters: 1.8 })
    expect(states.at(-1).wallCount).toBe(1)
    expect(surfaces.children).toHaveLength(1)
    expect(engine.place()).toBe(true)
    expect(model.position).toEqual(position)
  })
  it('uses a native wall instead of drawing a second depth wall in front', async () => {
    await start()
    for (let i = 0; i < 3; i++) frame({ native: true, depthMeters: 1.8 })
    expect(states.at(-1).wallCount).toBe(1)
    expect(engine.place()).toBe(true)
    expect(states.at(-1).wallSource).toBe('webxr-plane')
    const scene = renderer.render.mock.lastCall[0]
    expect(scene.getObjectByName('test-artwork').position.z).toBeCloseTo(-1.992)
  })
  it.each([
    { source: 'depth', observation: { depth: true } },
    { source: 'plane', observation: { depth: false, native: true } },
  ])(
    'remembers an unplaced $source wall when facing away and returns without rescanning',
    async ({ source, observation }) => {
      await start()
      for (let i = 0; i < 3; i++) frame(observation)
      const scene = renderer.render.mock.lastCall[0]
      const surfaces = scene.getObjectByName('artar-wall-surfaces')
      const remembered = surfaces.children[0]
      const vertices = [
        ...remembered.getObjectByName('wall-fill').geometry.attributes.position
          .array,
      ]
      expect(states.at(-1)).toMatchObject({
        placed: false,
        wallCount: 1,
        canPlace: true,
      })
      now += 30000
      frame({ depth: false, yaw: Math.PI })
      expect(states.at(-1)).toMatchObject({
        tracking: true,
        wallCount: 1,
        canPlace: false,
      })
      expect(surfaces.children).toEqual([remembered])
      // Return with no new Depth/plane data: the remembered wall is already usable.
      frame({ depth: false })
      expect(states.at(-1).canPlace).toBe(true)
      expect([
        ...remembered.getObjectByName('wall-fill').geometry.attributes.position
          .array,
      ]).toEqual(vertices)
      expect(engine.place()).toBe(true)
      expect(states.at(-1).wallSource).toBe(`webxr-${source}`)
      now += 30000
      frame({ tracked: false, depth: false })
      expect(surfaces.visible).toBe(false)
      frame({ depth: false })
      expect(surfaces.visible).toBe(true)
      expect(surfaces.children).toEqual([remembered])
      expect(states.at(-1)).toMatchObject({ placed: true, canPlace: true })
    },
  )
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
    // Expiring raw hit samples must not erase the wall confirmed from them.
    now += 30000
    frame({ depth: false, yaw: Math.PI })
    expect(states.at(-1)).toMatchObject({ wallCount: 1, canPlace: false })
    frame({ depth: false })
    expect(engine.place()).toBe(true)
    expect(states.at(-1).wallSource).toBe('webxr-hit-test')
    expect(
      await engine.setArt({ ...seedArtworks[0], widthCm: 700, heightCm: 700 }),
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
