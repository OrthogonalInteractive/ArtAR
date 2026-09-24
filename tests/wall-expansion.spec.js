import { describe, expect, it } from 'vitest'
import { Scene, Vector3 } from 'three'
import { createWallExpansion } from '../src/ar/wall-expansion.js'
import {
  createWallTracker,
  makeWall,
  fitPlacement,
  worldPoint,
} from '../src/ar/walls.js'
import { makeHorizontalBoundary } from '../src/ar/room-boundaries.js'
import { createWallFeedback } from '../src/ar/wall-feedback.js'

const patch = (extra = {}) =>
  makeWall({
    id: 'front',
    origin: new Vector3(0, 1.5, 0),
    normal: new Vector3(0, 0, 1),
    polygon: [
      { x: -0.3, y: -0.3 },
      { x: 0.3, y: -0.3 },
      { x: 0.3, y: 0.3 },
      { x: -0.3, y: 0.3 },
    ],
    source: 'webxr-depth',
    ...extra,
  })
const horizontal = (kind, height, z = 0) =>
  makeHorizontalBoundary({
    id: kind,
    kind,
    origin: new Vector3(0, height, z),
    polygon: [
      { x: -2, y: z - 0.1 },
      { x: 2, y: z - 0.1 },
      { x: 2, y: z + 2 },
      { x: -2, y: z + 2 },
    ],
  })

describe('finite wall extension', () => {
  it('fits art beyond a small patch without changing the measured polygon, pose or identity', () => {
    const observed = patch()
    expect(fitPlacement(observed, { x: 0, y: 0 }, 0.62, 0.82)).toBeNull()
    const [surface] = createWallExpansion().update([observed])
    expect(surface.id).toBe(observed.id)
    expect(surface.polygon).toBe(observed.polygon)
    expect(surface.origin).toBe(observed.origin)
    expect(surface.normal).toBe(observed.normal)
    expect(fitPlacement(surface, { x: 1, y: 0.5 }, 0.62, 0.82)).toEqual({
      x: 1,
      y: 0.5,
      clamped: false,
    })
    const edge = fitPlacement(surface, { x: 20, y: 20 }, 0.62, 0.82)
    expect(edge.x).toBeCloseTo(1.97)
    expect(edge.y).toBeCloseTo(1.37)
  })

  it('ends at ceiling, floor and neighboring walls and fits the entire frame inside', () => {
    const front = patch()
    const left = patch({
      id: 'left',
      origin: new Vector3(-1.2, 1.5, 0.8),
      normal: new Vector3(1, 0, 0),
    })
    const right = patch({
      id: 'right',
      origin: new Vector3(1.8, 1.5, 0.8),
      normal: new Vector3(-1, 0, 0),
    })
    const [surface] = createWallExpansion().update(
      [front, left, right],
      [horizontal('ceiling', 2.5), horizontal('floor', 0)],
    )
    expect(surface.boundaryIds.sort()).toEqual([
      'ceiling',
      'floor',
      'left',
      'right',
    ])
    const fit = fitPlacement(surface, { x: 10, y: 10 }, 0.62, 0.82)
    expect(fit.x).toBeCloseTo(1.47)
    expect(worldPoint(surface, fit).y).toBeCloseTo(2.07)
    const bottom = fitPlacement(surface, { x: -10, y: -10 }, 0.62, 0.82)
    expect(bottom.x).toBeCloseTo(-0.87)
    expect(worldPoint(surface, bottom).y).toBeCloseTo(0.43)
  })

  it('can reach an observed boundary beyond the default unknown extent, but rejects distant/unrelated patches', () => {
    const expansion = createWallExpansion(),
      wall = patch()
    const [unknown] = expansion.update([wall])
    expect(expansion.update([wall], [horizontal('ceiling', 2.5, 2)])[0]).toBe(
      unknown,
    )
    expect(expansion.update([wall], [horizontal('floor', 1.6)])[0]).toBe(
      unknown,
    )
    expect(expansion.update([wall], [horizontal('ceiling', 9)])[0]).toBe(
      unknown,
    )
    const [tall] = expansion.update([wall], [horizontal('ceiling', 4)])
    expect(
      Math.max(...tall.surfacePolygon.map((p) => worldPoint(tall, p).y)),
    ).toBe(4)
  })

  it('keeps a fresh coplanar patch in the inferred area on the same wall ID, including after placement', () => {
    const tracker = createWallTracker(),
      expansion = createWallExpansion()
    let found
    for (let i = 0; i < 3; i++) found = tracker.update([patch()], i * 700)
    const surfaces = expansion.update(found)
    tracker.lock(found[0].id)
    const extra = patch({ origin: new Vector3(1.5, 1.5, 0.01) })
    const next = tracker.update([extra], 2100, {
      associationSurfaces: surfaces,
    })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(found[0].id)
    expect(next[0].origin).toEqual(found[0].origin)
    expect(next[0].normal).toEqual(found[0].normal)
    expect(Math.max(...next[0].polygon.map((p) => p.x))).toBeCloseTo(1.8)
    expect(new Set(tracker.snapshot().map((s) => s.id)).size).toBe(1)
    // Inferred surfaces cannot confirm anything without actual observations.
    const empty = createWallTracker()
    for (let i = 0; i < 5; i++)
      expect(
        empty.update([], i * 700, { associationSurfaces: surfaces }),
      ).toEqual([])
  })

  it('preserves cached geometry off-camera and rebuilds only when real bounds change', () => {
    const expansion = createWallExpansion(),
      wall = patch()
    const [first] = expansion.update([wall])
    expect(expansion.update([wall])[0]).toBe(first)
    const ceiling = horizontal('ceiling', 2.5)
    const [clipped] = expansion.update([wall], [ceiling])
    expect(clipped).not.toBe(first)
    expect(clipped.origin).toBe(first.origin)
    expect(expansion.update([wall], [ceiling])[0]).toBe(clipped)
    expansion.reset()
    expect(expansion.update([wall])[0].boundaryIds).toEqual([])
  })

  it('renders inferred area faintly with a dashed border, including while dragging', () => {
    const scene = new Scene(),
      feedback = createWallFeedback(scene)
    const [surface] = createWallExpansion().update([patch()])
    feedback.setTracking(true)
    for (const dragging of [false, true]) {
      feedback.update([surface], { selectedId: surface.id, dragging })
      const observed = scene.getObjectByName('wall-fill')
      const inferred = scene.getObjectByName('wall-extension-fill')
      expect(inferred.material.opacity).toBeLessThan(
        observed.material.opacity / 2,
      )
      expect(
        scene.getObjectByName('wall-extension-rim').material
          .isLineDashedMaterial,
      ).toBe(true)
      expect(inferred.geometry.attributes.position.count).toBe(4)
    }
    feedback.dispose()
    expect(scene.children).toHaveLength(0)
  })
})
