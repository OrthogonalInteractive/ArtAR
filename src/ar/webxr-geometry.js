import { Matrix4, Vector3 } from 'three'
import { makeWall, localPoint, convexHull } from './walls.js'

const UP = new Vector3(0, 1, 0)

/** Depth is distance along camera -Z, not distance along the viewing ray.
 * getDepthInMeters handles the sensor-to-view rotation/crop internally.
 */
export function depthWorldPoints(depth, view, columns = 26, rows = 26) {
  if (!depth) return []
  const projectionInverse = new Matrix4()
    .fromArray(view.projectionMatrix)
    .invert()
  const world = new Matrix4().fromArray(view.transform.matrix)
  const points = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) / columns,
        y = (row + 0.5) / rows
      const meters = depth.getDepthInMeters(x, y)
      if (!Number.isFinite(meters) || meters < 0.25 || meters > 6) continue
      const ray = new Vector3(2 * x - 1, 1 - 2 * y, 0.5).applyMatrix4(
        projectionInverse,
      )
      if (ray.z >= 0) continue
      points.push(ray.multiplyScalar(meters / -ray.z).applyMatrix4(world))
    }
  }
  return points
}

export function verticalHit(pose, cameraPosition) {
  if (!pose || pose.emulatedPosition) return null
  const matrix = new Matrix4().fromArray(pose.transform.matrix)
  const normal = UP.clone().transformDirection(matrix)
  if (Math.abs(normal.y) > 0.12) return null
  const point = new Vector3().setFromMatrixPosition(matrix)
  const distance = point.distanceTo(cameraPosition)
  if (distance < 0.25 || distance > 7) return null
  if (normal.dot(cameraPosition.clone().sub(point)) < 0) normal.negate()
  return { point, normal }
}

/** Native plane extents are observed polygons, not semantic wall/obstacle bounds. */
export function planeCandidates(frame, referenceSpace, cameraPosition) {
  const candidates = []
  for (const plane of frame.detectedPlanes || []) {
    if (plane.orientation === 'horizontal') continue
    const pose = frame.getPose(plane.planeSpace, referenceSpace)
    const hit = verticalHit(pose, cameraPosition)
    if (!hit || plane.polygon.length < 3) continue
    const matrix = new Matrix4().fromArray(pose.transform.matrix)
    const wall = makeWall({
      origin: hit.point,
      normal: hit.normal,
      polygon: [],
    })
    const polygon = convexHull(
      Array.from(plane.polygon, (p) =>
        localPoint(wall, new Vector3(p.x, p.y, p.z).applyMatrix4(matrix)),
      ),
    )
    const xs = polygon.map((p) => p.x),
      ys = polygon.map((p) => p.y)
    if (
      Math.max(...xs) - Math.min(...xs) < 0.45 ||
      Math.max(...ys) - Math.min(...ys) < 0.4
    )
      continue
    candidates.push({
      origin: wall.origin,
      normal: wall.normal,
      polygon,
      source: 'webxr-plane',
    })
  }
  return candidates
}

/** Accumulate only actual vertical-surface hits; never invent a wall around one hit. */
export function createHitCloud() {
  const cells = new Map()
  return {
    add(hit, now) {
      if (!hit) return
      const p = hit.point
      const key = [p.x, p.y, p.z].map((v) => Math.round(v / 0.04)).join(':')
      cells.delete(key)
      cells.set(key, { point: p.clone(), time: now })
      while (cells.size > 800) cells.delete(cells.keys().next().value)
    },
    points(now, cameraPosition) {
      for (const [key, entry] of cells) {
        if (
          now - entry.time > 15000 ||
          entry.point.distanceTo(cameraPosition) > 7
        )
          cells.delete(key)
      }
      return Array.from(cells.values(), (entry) => entry.point)
    },
    clear() {
      cells.clear()
    },
  }
}
