import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  createWallTracker,
  detectVerticalWalls,
  makeWall,
} from '../src/ar/walls.js'

const randomFor = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const camera = new Vector3(0, 1.5, 3)
const candidate = (angle = 0, depth = 0) =>
  makeWall({
    origin: new Vector3(0, 0, depth),
    normal: new Vector3(Math.sin(angle), 0, Math.cos(angle)),
    polygon: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 2 },
      { x: -1, y: 2 },
    ],
  })

describe('conservative wall acceptance', () => {
  it('rejects a diagonal strip even though its bounding box is wide and tall', () => {
    const random = randomFor(42)
    const points = Array.from({ length: 160 }, () => {
      const x = random() * 2
      return { x, y: x + random() * 0.03, z: 0 }
    })
    expect(detectVerticalWalls(points, camera, { random })).toEqual([])
  })

  it('does not bridge two separate vertical edges into a large wall', () => {
    const random = randomFor(43)
    const points = Array.from({ length: 160 }, (_, i) => ({
      x: (i % 2 ? -1 : 1) + random() * 0.03,
      y: random() * 2,
      z: 0,
    }))
    expect(detectVerticalWalls(points, camera, { random })).toEqual([])
  })

  it('does not accumulate walls from accidental planes in clutter over 40 scans', () => {
    const random = randomFor(44)
    const points = Array.from({ length: 600 }, () => ({
      x: random() * 4 - 2,
      y: random() * 2.5,
      z: random() * 4 - 2,
    }))
    const tracker = createWallTracker()
    for (let scan = 0; scan < 40; scan++) {
      const walls = detectVerticalWalls(points, camera, {
        random: randomFor(scan + 1),
      })
      expect(walls).toEqual([])
      expect(tracker.update(walls, scan * 700)).toEqual([])
    }
  })

  it('keeps two real room walls in clutter over repeated observations', () => {
    const random = randomFor(45)
    const points = []
    for (let i = 0; i < 220; i++) {
      points.push({
        x: random() * 2,
        y: random() * 2.5,
        z: (random() - 0.5) * 0.012,
      })
      points.push({
        x: (random() - 0.5) * 0.012,
        y: random() * 2.5,
        z: random() * 2,
      })
    }
    for (let i = 0; i < 180; i++)
      points.push({ x: random() * 2, y: random() * 2.5, z: random() * 2 })
    const tracker = createWallTracker()
    for (let scan = 0; scan < 40; scan++) {
      const walls = detectVerticalWalls(points, new Vector3(3, 1.5, 3), {
        random: randomFor(scan + 10),
      })
      const found = tracker.update(walls, scan * 700)
      expect(found.length).toBeLessThanOrEqual(2)
      if (scan >= 2) expect(found).toHaveLength(2)
    }
  })

  it.each([
    { axis: 'angle', step: Math.PI / 90 },
    { axis: 'angle', step: Math.PI / 30 },
    { axis: 'depth', step: 0.025 },
    { axis: 'depth', step: 0.07 },
  ])(
    'never confirms a drifting $axis (step $step) through chained pair matches',
    ({ axis, step }) => {
      const tracker = createWallTracker()
      for (let scan = 0; scan < 5; scan++) {
        const wall =
          axis === 'angle' ? candidate(scan * step) : candidate(0, scan * step)
        expect(tracker.update([wall], scan * 700)).toEqual([])
      }
    },
  )

  it('requires consecutive observations, rather than collecting sporadic matches', () => {
    const tracker = createWallTracker()
    for (let scan = 0; scan < 9; scan++)
      expect(tracker.update(scan % 2 ? [] : [candidate()], scan * 700)).toEqual(
        [],
      )
    tracker.update([candidate()], 6300)
    expect(tracker.update([candidate()], 7000)).toHaveLength(1)
  })

  it('requires a small change of viewpoint for feature-point walls, while retaining confirmed walls', () => {
    const tracker = createWallTracker()
    for (let scan = 0; scan < 6; scan++)
      expect(
        tracker.update([candidate()], scan * 700, { cameraPosition: camera }),
      ).toEqual([])
    const found = tracker.update([candidate()], 4200, {
      cameraPosition: camera.clone().add(new Vector3(0.08, 0, 0)),
    })
    expect(found).toHaveLength(1)
    expect(tracker.update([], 60000, { cameraPosition: camera })).toEqual(found)
  })
})
