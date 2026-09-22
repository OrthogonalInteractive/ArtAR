import { describe, it, expect } from 'vitest'
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import {
  depthWorldPoints,
  planeCandidates,
  verticalHit,
  createHitCloud,
} from '../src/ar/webxr-geometry.js'
import { detectVerticalWalls } from '../src/ar/walls.js'

const pose = (matrix) => ({ transform: { matrix: matrix.elements } })
const wallPose = new Matrix4()
  .makeRotationX(Math.PI / 2)
  .setPosition(0, 1.5, -2)

describe('WebXR room geometry in meters', () => {
  it('unprojects camera-plane depth without turning a flat wall into a sphere', () => {
    const camera = new PerspectiveCamera(60, 1, 0.05, 20)
    const view = {
      projectionMatrix: camera.projectionMatrix.elements,
      transform: { matrix: new Matrix4().makeTranslation(1, 1.5, 0).elements },
    }
    const points = depthWorldPoints({ getDepthInMeters: () => 2 }, view, 20, 20)
    expect(points).toHaveLength(400)
    expect(points.every((p) => Math.abs(p.z + 2) < 1e-6)).toBe(true)
    const walls = detectVerticalWalls(points, new Vector3(1, 1.5, 0))
    expect(walls).toHaveLength(1)
    expect(walls[0].normal.z).toBeCloseTo(1)
    expect(
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    ).toBeCloseTo(2.194, 2)
  })
  it('applies camera rotation and skips invalid/out-of-range depth', () => {
    const camera = new PerspectiveCamera(60, 0.6, 0.05, 20)
    const view = {
      projectionMatrix: camera.projectionMatrix.elements,
      transform: {
        matrix: new Matrix4().makeRotationY(Math.PI / 2).setPosition(1, 2, 3)
          .elements,
      },
    }
    const points = depthWorldPoints({ getDepthInMeters: () => 2 }, view, 1, 1)
    expect(points[0].distanceTo(new Vector3(-1, 2, 3))).toBeLessThan(1e-6)
    for (const depth of [0, NaN, Infinity, 0.1, 8])
      expect(
        depthWorldPoints({ getDepthInMeters: () => depth }, view, 1, 1),
      ).toEqual([])
  })
  it('accepts vertical hit normals and rejects floors and emulated poses', () => {
    expect(
      verticalHit(pose(wallPose), new Vector3(0, 1.5, 0))?.normal.z,
    ).toBeCloseTo(1)
    expect(
      verticalHit(
        pose(new Matrix4().makeTranslation(0, -1, -2)),
        new Vector3(),
      ),
    ).toBeNull()
    expect(
      verticalHit({ ...pose(wallPose), emulatedPosition: true }, new Vector3()),
    ).toBeNull()
  })
  it('uses the actual native polygon transformed from plane-space XZ', () => {
    const polygon = [
      { x: -1, y: 0, z: -0.8 },
      { x: 1, y: 0, z: -0.8 },
      { x: 1, y: 0, z: 0.8 },
      { x: -1, y: 0, z: 0.8 },
    ]
    const plane = { orientation: 'vertical', polygon, planeSpace: {} }
    const frame = {
      detectedPlanes: new Set([plane]),
      getPose: () => pose(wallPose),
    }
    const walls = planeCandidates(frame, {}, new Vector3(0, 1.5, 0))
    expect(walls).toHaveLength(1)
    expect(walls[0].source).toBe('webxr-plane')
    expect(Math.max(...walls[0].polygon.map((p) => p.x))).toBeCloseTo(1)
    expect(Math.max(...walls[0].polygon.map((p) => p.y))).toBeCloseTo(0.8)
    plane.orientation = 'horizontal'
    expect(planeCandidates(frame, {}, new Vector3())).toEqual([])
  })
  it('deduplicates observed hits, expires stale samples and never grows a single hit into a wall', () => {
    const cloud = createHitCloud(),
      camera = new Vector3(0, 1.5, 0)
    const hit = verticalHit(pose(wallPose), camera)
    cloud.add(hit, 10)
    cloud.add(hit, 20)
    expect(cloud.points(30, camera)).toHaveLength(1)
    expect(detectVerticalWalls(cloud.points(30, camera), camera)).toEqual([])
    expect(cloud.points(16000, camera)).toEqual([])
    cloud.add(hit, 16000)
    cloud.clear()
    expect(cloud.points(16001, camera)).toEqual([])
  })
})
