import * as THREE from 'three'
import {
  makeWall,
  sampleWallPoints,
  worldPoint,
  WALL_DETECTION_LIMITS,
} from './walls.js'
import { disposeObject } from './artwork.js'

export const DEBUG_COLORS = Object.freeze({
  points: 0x58d9ff,
  pending: 0xffd36b,
  rejected: 0xff7474,
  confirmed: 0x95f98a,
  selected: 0xc59bff,
})
export const CANDIDATE_REASONS = Object.freeze({
  narrow: '幅45cm未満',
  short: '高さ40cm未満',
  noisy: '面からのばらつき大',
})

export function detectionMessage({
  trackingStatus,
  trackingReason,
  diagnostics,
  walls = [],
  hit = null,
  fits = null,
}) {
  if (trackingStatus === 'INITIALIZING' || trackingReason === 'INITIALIZING')
    return '空間を初期化しています。カメラ本体をゆっくり移動してください。'
  if (trackingStatus !== 'NORMAL')
    return '空間追跡の復帰待ち。点群・壁の表示を一時停止しています。'
  if (!diagnostics) return '点群の受信と壁の判定を待っています。'
  if (walls.length) {
    if (!hit)
      return '認識済みの壁があります。画面中央を色の付いた範囲へ向けてください。'
    if (fits === false)
      return '中央に壁がありますが、額装外寸が範囲に収まりません。'
    if (fits === null) return '壁を認識しました。作品の読み込みを待っています。'
    return '画面中央の壁に配置できます。'
  }
  return (
    {
      'few-points': `処理対象の点が${WALL_DETECTION_LIMITS.minPoints}点未満です。`,
      'no-vertical-plane': '垂直な平面候補をまだ推定できません。',
      'few-inliers': '同じ垂直面に集まる点が20点に届いていません。',
      rejected:
        '平面候補はありますが、広さ・ばらつきの条件を満たしていません。',
      detected: '壁候補を検出。複数回の一致を待っています。',
    }[diagnostics.status] || '壁の判定を待っています。'
  )
}

/** No video, images or raw room coordinates are included in the copyable report. */
export function debugSummary({
  trackingStatus = 'INITIALIZING',
  trackingReason = '',
  rawCount = 0,
  sampledCount = 0,
  diagnostics = null,
  walls = [],
  tracker = [],
  hit = null,
  fits = null,
  detectionMs = 0,
  detectionAgeMs = null,
  tracking = false,
} = {}) {
  return {
    trackingStatus,
    trackingReason,
    rawCount,
    sampledCount,
    wallCount: walls.length,
    visible: tracking,
    bestInliers: diagnostics?.bestInliers || 0,
    status: tracking ? diagnostics?.status || 'waiting' : 'tracking-paused',
    hitWall: hit?.id || null,
    fits,
    detectionMs: Math.round(detectionMs * 10) / 10,
    detectionAgeMs: detectionAgeMs === null ? null : Math.round(detectionAgeMs),
    message: detectionMessage({
      trackingStatus,
      trackingReason,
      diagnostics,
      walls,
      hit,
      fits,
    }),
    candidates: (diagnostics?.candidates || []).map((c, i) => ({
      number: i + 1,
      pointCount: c.pointCount,
      widthCm: Math.round(c.width * 100),
      heightCm: Math.round(c.height * 100),
      residualMm: Math.round(c.residual * 1000),
      accepted: c.accepted,
      reasons: [...c.reasons],
    })),
    trackedWalls: tracker.map((e) => ({ ...e })),
    limits: { ...WALL_DETECTION_LIMITS },
  }
}

/** Uses XR8's scene/camera, so all debug geometry shares its world coordinates. */
export function createARDebugLayer(scene) {
  const root = new THREE.Group()
  root.name = 'artar-debug'
  root.visible = false
  scene.add(root)
  const positions = new Float32Array(WALL_DETECTION_LIMITS.maxPoints * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  )
  geometry.setDrawRange(0, 0)
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: DEBUG_COLORS.points,
      size: 5,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    }),
  )
  points.frustumCulled = false
  points.renderOrder = 1004
  root.add(points)
  let planes = new THREE.Group(),
    enabled = false,
    tracked = false
  root.add(planes)

  function plane(wall, color) {
    if (wall.polygon.length < 3) return
    const vertices = wall.polygon.map((p) => worldPoint(wall, p, 0.006))
    const g = new THREE.BufferGeometry().setFromPoints(vertices)
    const indices = []
    for (let i = 1; i < vertices.length - 1; i++) indices.push(0, i, i + 1)
    g.setIndex(indices)
    const fill = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color,
        opacity: 0.12,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    )
    fill.renderOrder = 1000
    planes.add(fill)
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
      }),
    )
    outline.renderOrder = 1002
    planes.add(outline)
    // Normal indicator, built from local geometries so teardown never disposes shared ArrowHelper geometry.
    const origin = vertices
      .reduce((v, p) => v.add(p), new THREE.Vector3())
      .multiplyScalar(1 / vertices.length)
    const tip = origin.clone().addScaledVector(wall.normal, 0.22)
    const back = tip.clone().addScaledVector(wall.normal, -0.055)
    const arrow = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        origin,
        tip,
        tip,
        back.clone().addScaledVector(wall.right, 0.03),
        tip,
        back.clone().addScaledVector(wall.right, -0.03),
      ]),
      new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
      }),
    )
    arrow.renderOrder = 1003
    planes.add(arrow)
  }
  function clearPlanes() {
    disposeObject(planes)
    planes = new THREE.Group()
    root.add(planes)
  }
  return {
    root,
    setEnabled(value) {
      enabled = !!value
      root.visible = enabled && tracked
    },
    setTracking(value) {
      tracked = !!value
      root.visible = enabled && tracked
    },
    updatePoints(rawPoints, cameraPosition) {
      const sample = sampleWallPoints(rawPoints, cameraPosition)
      sample.forEach((p, i) => p.toArray(positions, i * 3))
      geometry.setDrawRange(0, sample.length)
      geometry.attributes.position.needsUpdate = true
      return sample.length
    },
    updateWalls(walls, candidates, selectedId) {
      clearPlanes()
      for (const [i, candidate] of candidates.entries()) {
        // A confirmed plane replaces the matching provisional overlay.
        if (
          candidate.accepted &&
          walls.some(
            (w) =>
              w.normal.dot(candidate.normal) > 0.985 &&
              Math.abs(w.plane.distanceToPoint(candidate.origin)) < 0.1,
          )
        )
          continue
        plane(
          makeWall({ ...candidate, id: `candidate-${i}` }),
          candidate.accepted ? DEBUG_COLORS.pending : DEBUG_COLORS.rejected,
        )
      }
      walls.forEach((w) =>
        plane(
          w,
          w.id === selectedId ? DEBUG_COLORS.selected : DEBUG_COLORS.confirmed,
        ),
      )
    },
    clear() {
      geometry.setDrawRange(0, 0)
      clearPlanes()
    },
    dispose() {
      disposeObject(root)
    },
  }
}
