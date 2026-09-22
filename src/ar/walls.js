import { Vector3, Matrix4, Quaternion, Plane } from 'three'

const UP = new Vector3(0, 1, 0)
const EPS = 1e-7
const cross2 = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return []
  const lower = [],
    upper = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower.at(-2), lower.at(-1), p) <= EPS)
      lower.pop()
    lower.push(p)
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross2(upper.at(-2), upper.at(-1), p) <= EPS)
      upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export function makeWall({ id, origin, normal, polygon, source = 'scan' }) {
  const n = new Vector3(normal.x, 0, normal.z).normalize()
  if (n.lengthSq() < 0.99) throw new Error('垂直面の法線が必要です')
  const right = new Vector3().crossVectors(UP, n).normalize()
  const o = new Vector3().copy(origin)
  return {
    id,
    origin: o,
    normal: n,
    right,
    up: UP.clone(),
    polygon: convexHull(polygon),
    source,
    rotation: new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, UP, n),
    ),
    plane: new Plane().setFromNormalAndCoplanarPoint(n, o),
  }
}
export const localPoint = (wall, point) => {
  const d = new Vector3().subVectors(point, wall.origin)
  return { x: d.dot(wall.right), y: d.dot(wall.up) }
}
export const worldPoint = (wall, point, depth = 0) =>
  wall.origin
    .clone()
    .addScaledVector(wall.right, point.x)
    .addScaledVector(wall.up, point.y)
    .addScaledVector(wall.normal, depth)

function clip(polygon, a, b, c) {
  const result = []
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length]
    const dp = a * p.x + b * p.y - c,
      dq = a * q.x + b * q.y - c
    if (dp >= -EPS) result.push(p)
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq)
      result.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  }
  return result
}

/** Erode a convex wall by the complete framed rectangle, then clip room corners. */
export function placementArea(
  wall,
  width,
  height,
  neighbors = [],
  depth = 0.04,
  margin = 0.02,
) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) return []
  let area = wall.polygon.map((p) => ({ ...p }))
  const hx = width / 2 + margin,
    hy = height / 2 + margin
  for (let i = 0; i < wall.polygon.length && area.length; i++) {
    const p = wall.polygon[i],
      q = wall.polygon[(i + 1) % wall.polygon.length]
    const a = p.y - q.y,
      b = q.x - p.x
    area = clip(
      area,
      a,
      b,
      a * p.x + b * p.y + Math.abs(a) * hx + Math.abs(b) * hy,
    )
  }
  for (const other of neighbors) {
    if (other.id === wall.id || Math.abs(other.normal.dot(wall.normal)) > 0.98)
      continue
    // Consider only neighboring scanned patches near this wall, not arbitrary planes across the room.
    if (other.origin.distanceTo(wall.origin) > 6) continue
    const a = other.normal.dot(wall.right),
      b = other.normal.dot(wall.up)
    const signedOrigin = other.plane.distanceToPoint(wall.origin)
    const extrusion = Math.min(0, other.normal.dot(wall.normal) * depth)
    area = clip(
      area,
      a,
      b,
      margin +
        (Math.abs(a) * width) / 2 +
        (Math.abs(b) * height) / 2 -
        signedOrigin -
        extrusion,
    )
  }
  return area
}

export function fitPlacement(
  wall,
  requested,
  width,
  height,
  neighbors = [],
  depth = 0.04,
  margin = 0.02,
) {
  const area = placementArea(wall, width, height, neighbors, depth, margin)
  if (area.length < 3) return null
  const inside = area.every(
    (a, i) => cross2(a, area[(i + 1) % area.length], requested) >= -EPS,
  )
  if (inside) return { ...requested, clamped: false }
  let best,
    distance = Infinity
  for (let i = 0; i < area.length; i++) {
    const a = area[i],
      b = area[(i + 1) % area.length]
    const dx = b.x - a.x,
      dy = b.y - a.y
    const t = Math.max(
      0,
      Math.min(
        1,
        ((requested.x - a.x) * dx + (requested.y - a.y) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    )
    const p = { x: a.x + t * dx, y: a.y + t * dy }
    const d = (requested.x - p.x) ** 2 + (requested.y - p.y) ** 2
    if (d < distance) {
      best = p
      distance = d
    }
  }
  return { ...best, clamped: true }
}

export const WALL_DETECTION_LIMITS = Object.freeze({
  minPoints: 20,
  minWidth: 0.45,
  minHeight: 0.4,
  maxPoints: 800,
  maxDistance: 7,
  confirmations: 3,
})

// The overlay and detector deliberately use the same finite, nearby sample.
export function sampleWallPoints(rawPoints, cameraPosition) {
  const points = []
  for (const raw of rawPoints) {
    const p = raw?.position || raw
    if (!p || !Number.isFinite(p.x + p.y + p.z)) continue
    const point = new Vector3().copy(p)
    if (point.distanceTo(cameraPosition) >= WALL_DETECTION_LIMITS.maxDistance)
      continue
    points.push(point)
    if (points.length === WALL_DETECTION_LIMITS.maxPoints) break
  }
  return points
}

/** RANSAC uses three independent points so horizontal floors cannot become walls.
 * Optional diagnostics describe this exact run, without changing its samples.
 */
export function detectVerticalWalls(
  rawPoints,
  cameraPosition,
  {
    random = Math.random,
    iterations = 110,
    tolerance = 0.035,
    diagnostics,
  } = {},
) {
  let remaining = sampleWallPoints(rawPoints, cameraPosition)
  if (diagnostics)
    Object.assign(diagnostics, {
      rawPoints: rawPoints.length,
      sampledPoints: remaining.length,
      verticalSamples: 0,
      bestInliers: 0,
      candidates: [],
      status:
        remaining.length < WALL_DETECTION_LIMITS.minPoints
          ? 'few-points'
          : 'no-vertical-plane',
    })
  const walls = []
  for (
    let pass = 0;
    pass < 3 && remaining.length >= WALL_DETECTION_LIMITS.minPoints;
    pass++
  ) {
    let best = []
    for (let i = 0; i < iterations; i++) {
      const a = remaining[Math.floor(random() * remaining.length)]
      const b = remaining[Math.floor(random() * remaining.length)]
      const c = remaining[Math.floor(random() * remaining.length)]
      const ab = b.clone().sub(a),
        ac = c.clone().sub(a)
      const n = new Vector3().crossVectors(ab, ac)
      if (n.length() < 0.015) continue
      n.normalize()
      if (Math.abs(n.y) > 0.12) continue
      if (diagnostics) diagnostics.verticalSamples++
      n.y = 0
      n.normalize()
      const inliers = remaining.filter(
        (p) => Math.abs(n.dot(p.clone().sub(a))) <= tolerance,
      )
      if (inliers.length > best.length) best = inliers
    }
    if (diagnostics)
      diagnostics.bestInliers = Math.max(diagnostics.bestInliers, best.length)
    if (best.length < WALL_DETECTION_LIMITS.minPoints) break
    const mean = best
      .reduce((s, p) => s.add(p), new Vector3())
      .multiplyScalar(1 / best.length)
    let xx = 0,
      xz = 0,
      zz = 0
    for (const p of best) {
      const x = p.x - mean.x,
        z = p.z - mean.z
      xx += x * x
      xz += x * z
      zz += z * z
    }
    const angle = 0.5 * Math.atan2(2 * xz, xx - zz)
    const n = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
    if (n.dot(cameraPosition.clone().sub(mean)) < 0) n.negate()
    const right = new Vector3().crossVectors(UP, n)
    const projected = best.map((p) => ({
      x: p.clone().sub(mean).dot(right),
      y: p.y - mean.y,
    }))
    const xs = projected.map((p) => p.x),
      ys = projected.map((p) => p.y)
    const width = Math.max(...xs) - Math.min(...xs),
      height = Math.max(...ys) - Math.min(...ys)
    const residual = Math.sqrt(
      best.reduce((s, p) => s + n.dot(p.clone().sub(mean)) ** 2, 0) /
        best.length,
    )
    // Reject thin lines and broad noisy point clouds.
    const candidate = {
      origin: mean,
      normal: n,
      polygon: convexHull(projected),
      pointCount: best.length,
      residual,
      source: 'scan',
    }
    const accepted =
      width >= WALL_DETECTION_LIMITS.minWidth &&
      height >= WALL_DETECTION_LIMITS.minHeight &&
      residual < tolerance * 0.8
    if (accepted) walls.push(candidate)
    if (diagnostics)
      diagnostics.candidates.push({
        ...candidate,
        width,
        height,
        accepted,
        reasons: [
          ...(width < WALL_DETECTION_LIMITS.minWidth ? ['narrow'] : []),
          ...(height < WALL_DETECTION_LIMITS.minHeight ? ['short'] : []),
          ...(residual >= tolerance * 0.8 ? ['noisy'] : []),
        ],
      })
    const used = new Set(best)
    remaining = remaining.filter((p) => !used.has(p))
  }
  if (
    diagnostics &&
    diagnostics.sampledPoints >= WALL_DETECTION_LIMITS.minPoints
  ) {
    diagnostics.status = walls.length
      ? 'detected'
      : diagnostics.candidates.length
        ? 'rejected'
        : diagnostics.verticalSamples
          ? 'few-inliers'
          : 'no-vertical-plane'
  }
  return walls
}

/** Require repeated agreement before exposing a plane to the user. Lock it after selection. */
export function createWallTracker() {
  let entries = [],
    counter = 0
  return {
    update(candidates, now) {
      for (const candidate of candidates) {
        let entry = entries.find(
          (e) =>
            e.wall.normal.dot(candidate.normal) > 0.985 &&
            Math.abs(e.wall.plane.distanceToPoint(candidate.origin)) < 0.1 &&
            e.wall.origin.distanceTo(candidate.origin) < 2.5,
        )
        if (!entry) {
          entry = {
            wall: makeWall({ ...candidate, id: `scan-${++counter}` }),
            seen: 0,
            updated: now,
            locked: false,
          }
          entries.push(entry)
        }
        if (!entry.locked)
          entry.wall = makeWall({ ...candidate, id: entry.wall.id })
        entry.seen++
        entry.updated = now
      }
      entries = entries.filter((e) => e.locked || now - e.updated < 2500)
      return entries
        .filter((e) => e.seen >= WALL_DETECTION_LIMITS.confirmations)
        .map((e) => e.wall)
    },
    snapshot() {
      return entries.map((e) => ({
        id: e.wall.id,
        confirmations: e.seen,
        locked: e.locked,
        confirmed: e.seen >= WALL_DETECTION_LIMITS.confirmations,
      }))
    },
    lock(id) {
      const e = entries.find((e) => e.wall.id === id)
      if (e) e.locked = true
    },
    reset() {
      entries = []
      counter = 0
    },
  }
}
