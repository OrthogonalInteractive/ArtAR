import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scene, PerspectiveCamera, Group, WebGLRenderer } from 'three'
import { createExperience } from '../src/ar/engine.js'
import { seedArtworks } from '../src/data/catalog.js'

vi.mock('three', async (original) => ({
  ...(await original()),
  WebGLRenderer: class {
    shadowMap = {}
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose = vi.fn()
  },
}))
vi.mock('../src/ar/artwork.js', async (original) => ({
  ...(await original()),
  createArtwork: vi.fn(async () => new Group()),
}))
let engine, pipeline, xrScene, now, updates, stop
beforeEach(async () => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('navigator', {
    userAgent: 'iPhone Safari',
    platform: 'iPhone',
    mediaDevices: { getUserMedia: vi.fn() },
  })
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
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  stop = vi.fn()
  updates = []
  const canvas = document.createElement('canvas')
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 360,
    height: 640,
  })
  const host = document.createElement('div')
  host.appendChild(canvas)
  document.body.appendChild(host)
  xrScene = {
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    renderer: new WebGLRenderer(),
  }
  xrScene.camera.position.set(0, 1, 2)
  vi.stubGlobal('XR8', {
    stop,
    clearCameraPipelineModules: vi.fn(),
    XrController: {
      configure: vi.fn(),
      pipelineModule: () => ({ name: 'controller' }),
    },
    GlTextureRenderer: { pipelineModule: () => ({ name: 'background' }) },
    Threejs: {
      pipelineModule: () => ({ name: 'three' }),
      xrScene: () => xrScene,
    },
    XrConfig: { device: () => ({ MOBILE: 'mobile' }) },
    addCameraPipelineModules: (modules) => {
      pipeline = modules.find((m) => m.name === 'artar-wall-gallery')
    },
    run: () => pipeline.onStart(),
  })
  engine = createExperience({
    canvas,
    onState: (s) => updates.push({ ...updates.at(-1), ...s }),
    onError: (message) => {
      throw new Error(message)
    },
  })
  await engine.setArt(seedArtworks[0])
  engine.startAR(host)
  await Promise.resolve()
})
afterEach(() => {
  engine?.dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function frame(status, points) {
  pipeline.onUpdate({
    processCpuResult: {
      reality: {
        trackingStatus: status,
        trackingReason: status === 'NORMAL' ? 'UNSPECIFIED' : 'INITIALIZING',
        worldPoints: points,
      },
    },
  })
}
describe('XR8 debug pipeline lifecycle', () => {
  it('uses observed horizontal feature points to stop extension at a ceiling', () => {
    engine.setDebug(true)
    const points = []
    for (let x = -1; x <= 1; x += 0.1)
      for (let y = 0.2; y <= 2.2; y += 0.1)
        points.push({ position: { x, y, z: 0 } })
    for (let i = 0; i < 100; i++)
      points.push({
        position: {
          x: (i % 10) * 0.12 - 0.6,
          y: 2.5,
          z: Math.floor(i / 10) * 0.12,
        },
      })
    for (let i = 0; i < 3; i++) {
      now += 700
      xrScene.camera.position.x = i * 0.04
      frame('NORMAL', points)
    }
    expect(updates.at(-1)).toMatchObject({
      wallCount: 1,
      debug: { ceilingCount: 1 },
    })
    const positions = xrScene.scene.getObjectByName('wall-extension-fill')
      .geometry.attributes.position
    expect(
      Math.max(
        ...Array.from({ length: positions.count }, (_, i) => positions.getY(i)),
      ),
    ).toBeCloseTo(2.5)
  })
  it('adds no debug layer until enabled and exposes received point counts', () => {
    frame('NORMAL', [])
    expect(xrScene.scene.getObjectByName('artar-debug')).toBeUndefined()
    engine.setDebug(true)
    now = 1800
    frame('NORMAL', [{ position: { x: 0, y: 1, z: 0 } }])
    const layer = xrScene.scene.getObjectByName('artar-debug')
    expect(layer.visible).toBe(true)
    expect(updates.at(-1).debug).toMatchObject({
      rawCount: 1,
      sampledCount: 1,
      status: 'few-points',
      visible: true,
    })
    engine.setDebug(false)
    expect(layer.visible).toBe(false)
    expect(updates.at(-1).debug).toBeNull()
  })
  it('shows confirmed XR8 walls even when diagnostics are disabled', () => {
    const points = []
    for (let x = -1; x <= 1; x += 0.1)
      for (let y = 0.2; y <= 2.2; y += 0.1)
        points.push({ position: { x, y, z: 0 } })
    for (let i = 0; i < 3; i++) {
      now += 700
      xrScene.camera.position.x = i * 0.04
      frame('NORMAL', points)
    }
    const surfaces = xrScene.scene.getObjectByName('artar-wall-surfaces')
    expect(surfaces.visible).toBe(true)
    expect(surfaces.children).toHaveLength(1)
    expect(xrScene.scene.getObjectByName('artar-debug')).toBeUndefined()
    const remembered = surfaces.children[0]
    now += 30000
    frame('NORMAL', [])
    expect(updates.at(-1)).toMatchObject({ wallCount: 1, placed: false })
    expect(surfaces.children).toEqual([remembered])
    now += 700
    frame('LIMITED', [])
    expect(surfaces.visible).toBe(false)
    now += 30000
    frame('NORMAL', [])
    expect(surfaces.visible).toBe(true)
    expect(surfaces.children).toEqual([remembered])
    engine.stopAR()
    expect(xrScene.scene.getObjectByName('artar-wall-surfaces')).toBeUndefined()
  })
  it('waits for translation before confirming a feature-point wall and reports why', () => {
    engine.setDebug(true)
    const points = []
    for (let x = -1; x <= 1; x += 0.1)
      for (let y = 0.2; y <= 2.2; y += 0.1)
        points.push({ position: { x, y, z: 0 } })
    for (let i = 0; i < 5; i++) {
      now += 700
      // Turning the camera in place is not a new triangulation baseline.
      xrScene.camera.rotation.y = i * 0.02
      frame('NORMAL', points)
      expect(updates.at(-1).wallCount).toBe(0)
    }
    expect(updates.at(-1).debug.message).toContain(
      '端末の位置を左右に少し動かして',
    )
    xrScene.camera.position.x = 0.08
    now += 700
    frame('NORMAL', points)
    expect(updates.at(-1).wallCount).toBe(1)
  })
  it('restarts provisional evidence after tracking is lost', () => {
    const points = []
    for (let x = -1; x <= 1; x += 0.1)
      for (let y = 0.2; y <= 2.2; y += 0.1)
        points.push({ position: { x, y, z: 0 } })
    for (let i = 0; i < 2; i++) {
      now += 700
      xrScene.camera.position.x = i * 0.04
      frame('NORMAL', points)
    }
    now += 100
    frame('LIMITED', [])
    now += 700
    xrScene.camera.position.x = 0.08
    frame('NORMAL', points)
    expect(updates.at(-1).wallCount).toBe(0)
    for (let i = 0; i < 2; i++) {
      now += 700
      xrScene.camera.position.x += 0.04
      frame('NORMAL', points)
    }
    expect(updates.at(-1).wallCount).toBe(1)
  })
  it('hides stale geometry during tracking loss and removes it on camera shutdown', () => {
    engine.setDebug(true)
    frame('NORMAL', [{ position: { x: 0, y: 1, z: 0 } }])
    const layer = xrScene.scene.getObjectByName('artar-debug')
    now = 1400
    frame('LIMITED', [])
    expect(layer.visible).toBe(false)
    expect(updates.at(-1).debug).toMatchObject({
      trackingStatus: 'LIMITED',
      visible: false,
      status: 'tracking-paused',
      detectionAgeMs: null,
    })
    expect(updates.at(-1).canPlace).toBe(false)
    engine.stopAR()
    expect(stop).toHaveBeenCalledOnce()
    expect(xrScene.scene.getObjectByName('artar-debug')).toBeUndefined()
    expect(updates.at(-1).mode).toBe('preview')
  })
})
