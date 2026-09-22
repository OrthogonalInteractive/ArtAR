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
      frame('NORMAL', points)
    }
    const surfaces = xrScene.scene.getObjectByName('artar-wall-surfaces')
    expect(surfaces.visible).toBe(true)
    expect(surfaces.children).toHaveLength(1)
    expect(xrScene.scene.getObjectByName('artar-debug')).toBeUndefined()
    now += 700
    frame('LIMITED', [])
    expect(surfaces.visible).toBe(false)
    engine.stopAR()
    expect(xrScene.scene.getObjectByName('artar-wall-surfaces')).toBeUndefined()
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
