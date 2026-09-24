import { wallColors } from '../src/ar/wall-colors.js'
import { describe, it, expect, vi } from 'vitest'
import { Scene, Vector3 } from 'three'
import { mount, flushPromises } from '@vue/test-utils'
import {
  createARDebugLayer,
  debugSummary,
  detectionMessage,
  DEBUG_COLORS,
} from '../src/ar/debug.js'
import {
  detectVerticalWalls,
  makeWall,
  sampleWallPoints,
  WALL_DETECTION_LIMITS,
  createWallTracker,
} from '../src/ar/walls.js'
import ARDebug from '../src/components/ARDebug.vue'
const camera = new Vector3(0, 1, 2)
const wall = makeWall({
  id: 'scan-1',
  origin: new Vector3(),
  normal: new Vector3(0, 0, 1),
  polygon: [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 2 },
    { x: -1, y: 2 },
  ],
})
function random() {
  let n = 42
  return () => {
    n = (n * 1664525 + 1013904223) >>> 0
    return n / 4294967296
  }
}
function cloud(width = 2, height = 2) {
  const r = random()
  return Array.from({ length: 120 }, () => ({
    position: {
      x: r() * width - width / 2,
      y: r() * height,
      z: (r() - 0.5) * 0.004,
    },
  }))
}
describe('wall diagnostics', () => {
  it('reports a small vertical patch as too narrow without accepting it', () => {
    const diagnostics = {}
    const result = detectVerticalWalls(cloud(0.3, 1.2), camera, {
      random: random(),
      diagnostics,
    })
    expect(result).toHaveLength(0)
    expect(diagnostics.status).toBe('rejected')
    expect(diagnostics.candidates[0].reasons).toContain('narrow')
    expect(diagnostics.bestInliers).toBe(120)
  })
  it('reports point shortage and resets diagnostics rather than leaving an old candidate', () => {
    const diagnostics = {}
    detectVerticalWalls(cloud(), camera, { random: random(), diagnostics })
    expect(diagnostics.candidates).toHaveLength(1)
    detectVerticalWalls([{ x: 0, y: 1, z: 0 }], camera, { diagnostics })
    expect(diagnostics.status).toBe('few-points')
    expect(diagnostics.candidates).toEqual([])
    expect(diagnostics.bestInliers).toBe(0)
  })
  it('distinguishes a floor-only cloud from a point shortage', () => {
    const r = random(),
      diagnostics = {}
    const points = Array.from({ length: 150 }, () => ({
      x: r() * 3,
      y: 0,
      z: r() * 3,
    }))
    detectVerticalWalls(points, camera, { random: random(), diagnostics })
    expect(diagnostics.status).toBe('no-vertical-plane')
    expect(diagnostics.sampledPoints).toBe(150)
    expect(diagnostics.verticalSamples).toBe(0)
  })
  it('does not change detection results when diagnostics are enabled', () => {
    const points = cloud(),
      diagnostics = {}
    const before = detectVerticalWalls(points, camera, { random: random() })
    const after = detectVerticalWalls(points, camera, {
      random: random(),
      diagnostics,
    })
    expect(after).toEqual(before)
    expect(diagnostics.status).toBe('detected')
    expect(diagnostics.candidates[0].accepted).toBe(true)
  })
  it('counts only finite, near points and bounds the sample size', () => {
    const points = [
      null,
      { x: NaN, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      ...cloud(),
    ]
    expect(sampleWallPoints(points, camera)).toHaveLength(120)
    expect(
      sampleWallPoints(
        Array.from({ length: 3000 }, () => ({ x: 0, y: 0, z: 0 })),
        camera,
      ),
    ).toHaveLength(800)
  })
  it('reports pending, confirmed and locked wall states separately', () => {
    const tracker = createWallTracker()
    tracker.update([wall], 0)
    expect(tracker.snapshot()[0]).toMatchObject({
      confirmations: 1,
      confirmed: false,
      locked: false,
    })
    tracker.update([wall], 650)
    const [w] = tracker.update([wall], 1300)
    tracker.lock(w.id)
    expect(tracker.snapshot()[0]).toMatchObject({
      confirmations: 3,
      confirmed: true,
      locked: true,
    })
    tracker.reset()
    expect(tracker.snapshot()).toEqual([])
  })
})
describe('3D debug geometry', () => {
  it('draws the actual sampled coordinates, hides on tracking loss, and clears old buffers', () => {
    const scene = new Scene(),
      layer = createARDebugLayer(scene)
    layer.setEnabled(true)
    expect(layer.root.visible).toBe(false)
    layer.setTracking(true)
    expect(layer.root.visible).toBe(true)
    layer.updatePoints(
      [
        { position: { x: 1, y: 2, z: 0 } },
        { position: { x: NaN, y: 1, z: 0 } },
      ],
      camera,
    )
    const points = layer.root.children.find((c) => c.isPoints)
    expect(points.geometry.drawRange.count).toBe(1)
    expect(points.geometry.attributes.position.getX(0)).toBe(1)
    expect(points.geometry.attributes.position.getY(0)).toBe(2)
    expect(points.geometry.attributes.position.count).toBe(
      WALL_DETECTION_LIMITS.maxPoints,
    )
    layer.setTracking(false)
    expect(layer.root.visible).toBe(false)
    layer.clear()
    expect(points.geometry.drawRange.count).toBe(0)
    const dispose = vi.spyOn(points.geometry, 'dispose')
    layer.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(scene.children).toHaveLength(0)
  })
  it('does not draw accepted duplicate depth candidates over confirmed walls', () => {
    const layer = createARDebugLayer(new Scene())
    layer.updateWalls(
      [wall],
      [
        {
          ...wall,
          origin: wall.origin.clone().add(new Vector3(0, 0, 0.2)),
          plane: undefined,
          accepted: true,
        },
      ],
      null,
    )
    const meshes = []
    layer.root.traverse((o) => {
      if (o.isMesh) meshes.push(o)
    })
    expect(meshes).toHaveLength(1)
    layer.dispose()
  })
  it('keeps wall orientation colors on selection, highlights its border and removes old geometry', () => {
    const layer = createARDebugLayer(new Scene())
    layer.updateWalls([wall], [], null)
    let meshes = []
    layer.root.traverse((o) => {
      if (o.isMesh) meshes.push(o)
    })
    expect(meshes).toHaveLength(1)
    expect(meshes[0].material.color.getHex()).toBe(wallColors(wall).fill)
    const dispose = vi.spyOn(meshes[0].geometry, 'dispose')
    layer.updateWalls([wall], [], wall.id)
    expect(dispose).toHaveBeenCalledOnce()
    meshes = []
    layer.root.traverse((o) => {
      if (o.isMesh) meshes.push(o)
    })
    expect(meshes[0].material.color.getHex()).toBe(wallColors(wall).fill)
    const outlines = []
    layer.root.traverse((o) => {
      if (o.isLineLoop) outlines.push(o)
    })
    expect(outlines[0].material.color.getHex()).toBe(0xffffff)
    layer.clear()
    meshes = []
    layer.root.traverse((o) => {
      if (o.isMesh) meshes.push(o)
    })
    expect(meshes).toHaveLength(0)
    layer.dispose()
  })
})
describe('diagnostic UI and report', () => {
  it('separates tracking loss, pending agreement, aiming and footprint rejection', () => {
    expect(
      detectionMessage({ trackingStatus: 'LIMITED', walls: [wall] }),
    ).toContain('復帰待ち')
    expect(
      detectionMessage({
        trackingStatus: 'NORMAL',
        diagnostics: { status: 'detected' },
        walls: [],
      }),
    ).toContain('一致')
    expect(
      detectionMessage({
        trackingStatus: 'NORMAL',
        diagnostics: {},
        walls: [wall],
      }),
    ).toContain('画面中央')
    expect(
      detectionMessage({
        trackingStatus: 'NORMAL',
        diagnostics: {},
        walls: [wall],
        hit: wall,
        fits: false,
      }),
    ).toContain('収まりません')
  })
  it('copies useful metrics without raw coordinates or camera images', async () => {
    const diagnostics = {}
    detectVerticalWalls(cloud(0.3, 1.2), camera, {
      random: random(),
      diagnostics,
    })
    const data = debugSummary({
      trackingStatus: 'NORMAL',
      tracking: true,
      rawCount: 120,
      sampledCount: 120,
      diagnostics,
    })
    const clipboard = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboard },
    })
    const wrapper = mount(ARDebug, { props: { data } })
    expect(wrapper.text()).toContain('幅45cm未満')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    const copied = JSON.parse(clipboard.mock.calls[0][0])
    expect(copied.rawCount).toBe(120)
    expect(copied.candidates[0].accepted).toBe(false)
    expect(copied.candidates[0]).not.toHaveProperty('origin')
    expect(copied).not.toHaveProperty('worldPoints')
    expect(wrapper.text()).toContain('コピー済み')
    wrapper.unmount()
    delete navigator.clipboard
  })
})
