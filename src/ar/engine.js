import * as THREE from 'three'
import { createArtwork, disposeObject } from './artwork.js'
import { createRoom } from './room.js'
import {
  fitPlacement,
  localPoint,
  worldPoint,
  wallMatch,
  detectVerticalWalls,
  createWallTracker,
} from './walls.js'
import { artDimensions } from '../data/catalog.js'
import { createARDebugLayer, debugSummary } from './debug.js'
import { arBackend, prepareWebXR, WEBXR_UNAVAILABLE } from './platform.js'
import { createWebXRSession } from './webxr.js'
import { createWallFeedback, createDragOutline } from './wall-feedback.js'
import { createWallExpansion } from './wall-expansion.js'
import {
  createBoundaryTracker,
  detectHorizontalBoundaries,
} from './room-boundaries.js'

// Matches the engine distribution used by ../portfolio. No API key required.
export const ENGINE_URL =
  'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js'
let loading
export function prepareAR() {
  if (arBackend() === 'webxr') return prepareWebXR()
  if (window.XR8) return Promise.resolve(window.XR8)
  if (loading) return loading
  window.THREE = THREE
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('xrloaded', loaded)
    }
    const fail = () => {
      cleanup()
      script.remove()
      loading = null
      reject(
        new Error(
          'ARエンジンを読み込めません。通信状態を確認して再試行してください。',
        ),
      )
    }
    const loaded = () => {
      if (window.XR8) {
        cleanup()
        resolve(window.XR8)
      }
    }
    script.src = ENGINE_URL
    script.crossOrigin = 'anonymous'
    script.dataset.preloadChunks = 'slam'
    script.onerror = fail
    script.onload = loaded
    window.addEventListener('xrloaded', loaded)
    timer = setTimeout(fail, 45000)
    document.head.appendChild(script)
  })
  return loading
}
export function cameraUnsupportedReason() {
  if (!window.isSecureContext)
    return 'ARにはHTTPS接続が必要です。公開URLをスマートフォンで開いてください。'
  const handheld =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!handheld)
    return 'PCではルームプレビューをご利用ください。公開URLをiPhone / iPadまたはAndroidで開くと、ARを開始できます。'
  if (arBackend() === 'webxr')
    return navigator.xr?.requestSession ? null : WEBXR_UNAVAILABLE
  if (!navigator.mediaDevices?.getUserMedia)
    return 'カメラを利用できません。iPhoneはSafari、AndroidはChromeで開いてください。'
  return null
}

export function createExperience({ canvas, onState, onError }) {
  let scene,
    camera,
    renderer,
    room,
    model,
    art,
    walls = [],
    boundaries = [],
    selectedWall,
    placement = { x: 0, y: 1.65 }
  let mode = 'preview',
    disposed = false,
    generation = 0,
    guide,
    guideOn = true,
    running = false
  let tracking = false,
    lastDetection = 0,
    candidateWall,
    rayPoint,
    lastStatus = ''
  let raf,
    arCanvas,
    xr,
    webxr = null,
    backend = null,
    xrCapabilities = null,
    resizeObserver,
    dragPointer = null,
    dragOffset = null
  let debugEnabled = false,
    arSceneReady = false,
    debugLayer = null,
    wallFeedback = null,
    lastHintUpdate = 0,
    diagnostics = null,
    lastDebugUpdate = 0,
    detectionMs = 0,
    detectionAt = null,
    latestDebug = debugSummary()
  const tracker = createWallTracker(),
    boundaryTracker = createBoundaryTracker(),
    expansion = createWallExpansion(),
    raycaster = new THREE.Raycaster()
  function resetWallMap() {
    tracker.reset()
    boundaryTracker.reset()
    expansion.reset()
    boundaries = []
  }
  const notify = (extra = {}) =>
    onState({
      mode,
      backend,
      xrCapabilities,
      placed: !!selectedWall,
      wallCount: walls.length,
      position: { ...placement },
      tracking: mode === 'preview' || tracking,
      wallSource: selectedWall?.source,
      dragging: dragPointer !== null,
      artHint: artworkHint(),
      focusedWallId: tracking ? candidateWall?.id || null : null,
      placedWallId: selectedWall?.id || null,
      canPlace: !!(
        tracking &&
        candidateWall &&
        rayPoint &&
        art &&
        constrain(candidateWall, rayPoint)
      ),
      debugEnabled,
      debug: debugEnabled ? latestDebug : null,
      ...extra,
    })
  const dimensions = () => artDimensions(art)
  function artworkHint() {
    if (mode !== 'ar' || !tracking || !selectedWall || !art) return null
    const size = dimensions()
    const p = worldPoint(
      selectedWall,
      {
        x: placement.x,
        y: placement.y - size.height / 2,
      },
      size.depth + 0.015,
    ).project(camera)
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 0.85 || p.y < -0.55 || p.y > 0.9)
      return null
    const y = (1 - p.y) * 50
    // Leave the bottom controls clear, including on short portrait screens.
    const reserved = window.innerWidth > window.innerHeight ? 76 : 160
    if ((y / 100) * window.innerHeight + 58 > window.innerHeight - reserved)
      return null
    return { x: (p.x + 1) * 50, y }
  }
  function lightScene() {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d897f, 2.5))
    const light = new THREE.DirectionalLight(0xfff9ef, 3.2)
    light.position.set(2.5, 5, 4)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = -4
    light.shadow.camera.right = 4
    light.shadow.camera.top = 5
    light.shadow.camera.bottom = -2
    light.shadow.normalBias = 0.015
    scene.add(light)
  }
  function updateGuide() {
    if (guide) {
      disposeObject(guide)
      guide = null
    }
    if (mode === 'ar') {
      if (!arSceneReady) return
      wallFeedback ||= createWallFeedback(scene)
      wallFeedback.setTracking(tracking)
      wallFeedback.update(walls, {
        selectedId: selectedWall?.id,
        candidateId: candidateWall?.id,
        dragging: dragPointer !== null,
      })
      return
    }
    if (!selectedWall || !guideOn) return
    const vertices = selectedWall.polygon.map((p) =>
      worldPoint(selectedWall, p, 0.006),
    )
    vertices.push(vertices[0])
    guide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineDashedMaterial({
        color: 0x778177,
        dashSize: 0.06,
        gapSize: 0.035,
        transparent: true,
        opacity: 0.65,
      }),
    )
    guide.computeLineDistances()
    scene.add(guide)
  }
  function applyPosition() {
    if (!model || !selectedWall) return
    model.position.copy(worldPoint(selectedWall, placement, 0.008))
    model.quaternion.copy(selectedWall.rotation)
    model.visible = mode === 'preview' || tracking
  }
  function constrain(wall, point) {
    const size = dimensions()
    return fitPlacement(
      wall,
      point,
      size.width,
      size.height,
      walls,
      size.depth,
      0.02,
    )
  }
  function placeOn(wall, point) {
    const fit = constrain(wall, point)
    if (!fit) {
      notify({
        message:
          'この範囲には作品が収まりません。広い壁を選ぶか、認識範囲を広げてください。',
      })
      return false
    }
    selectedWall = wall
    placement = { x: fit.x, y: fit.y }
    if (mode === 'ar') tracker.lock(wall.id)
    if (debugEnabled)
      debugLayer?.updateWalls(
        walls,
        diagnostics?.candidates || [],
        selectedWall.id,
      )
    applyPosition()
    updateGuide()
    notify()
    return true
  }
  function resize() {
    if (mode !== 'preview' || disposed) return
    const rect = canvas.getBoundingClientRect()
    camera.aspect = rect.width / Math.max(1, rect.height)
    camera.updateProjectionMatrix()
    renderer.setSize(rect.width, rect.height, false)
  }
  function preview() {
    mode = 'preview'
    backend = null
    xrCapabilities = null
    tracking = true
    selectedWall = null
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50)
    camera.position.set(2.1, 2.2, 5.3)
    camera.lookAt(-0.3, 1.4, 0.1)
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    lightScene()
    room = createRoom(scene)
    walls = room.walls
    selectedWall = walls[0]
    placement = { x: 0, y: 1.65 }
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    resize()
    const animate = () => {
      if (mode !== 'preview' || disposed) return
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    animate()
    notify()
  }
  async function setArt(next) {
    const version = ++generation
    try {
      const nextModel = await createArtwork(next)
      if (disposed || version !== generation) {
        disposeObject(nextModel)
        return false
      }
      const old = art
      art = next
      let nextPosition
      if (selectedWall) nextPosition = constrain(selectedWall, placement)
      if (selectedWall && !nextPosition) {
        art = old
        disposeObject(nextModel)
        notify({
          message:
            'この作品は現在の壁の範囲に収まりません。先に広い壁を選んでください。',
        })
        return false
      }
      if (model) disposeObject(model)
      model = nextModel
      if (mode === 'ar') createDragOutline(model, dimensions())
      scene.add(model)
      if (nextPosition) placement = { x: nextPosition.x, y: nextPosition.y }
      model.visible = !!selectedWall
      applyPosition()
      updateGuide()
      notify()
      return true
    } catch (e) {
      onError(e.message)
      return false
    }
  }
  function pick(event) {
    const rect = (mode === 'ar' ? arCanvas : canvas).getBoundingClientRect()
    raycaster.setFromCamera(
      {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      },
      camera,
    )
    let best
    for (const wall of walls) {
      if (raycaster.ray.direction.dot(wall.normal) > -0.08) continue
      const point = raycaster.ray.intersectPlane(
        wall.plane,
        new THREE.Vector3(),
      )
      if (!point) continue
      const local = localPoint(wall, point)
      // A tiny rectangle acts as a robust point-in-convex-polygon test.
      const fit = fitPlacement(wall, local, 0.001, 0.001, [], 0)
      if (!fit || Math.hypot(fit.x - local.x, fit.y - local.y) > 0.025) continue
      const distance = point.distanceTo(camera.position)
      if (distance < 0.25 || distance > 8) continue
      if (!best || distance < best.distance)
        best = { wall, local, world: point, distance }
    }
    return best
  }
  function pointerDown(event) {
    if (
      event.button !== 0 ||
      dragPointer !== null ||
      (mode === 'ar' && !tracking) ||
      !art
    )
      return
    const hit = pick(event)
    if (!hit) return
    dragOffset = null
    if (model && selectedWall && hit.wall.id === selectedWall.id) {
      const hits = raycaster.intersectObject(model, true)
      if (hits.length)
        dragOffset = {
          x: placement.x - hit.local.x,
          y: placement.y - hit.local.y,
        }
    }
    if (placeOn(hit.wall, dragOffset ? placement : hit.local)) {
      dragPointer = event.pointerId
      const target = mode === 'ar' ? arCanvas : canvas
      target.setPointerCapture(event.pointerId)
      target.classList.add('is-dragging')
      updateGuide()
      notify()
    }
  }
  function pointerMove(event) {
    if (dragPointer !== event.pointerId || (mode === 'ar' && !tracking)) return
    const hit = pick(event)
    if (!hit) return
    const offset = hit.wall.id === selectedWall?.id ? dragOffset : null
    placeOn(hit.wall, {
      x: hit.local.x + (offset?.x || 0),
      y: hit.local.y + (offset?.y || 0),
    })
  }
  function pointerUp(event) {
    if (event && event.pointerId !== dragPointer) return
    const wasDragging = dragPointer !== null
    const target = mode === 'ar' ? arCanvas : canvas
    const pointerId = dragPointer
    dragPointer = null
    dragOffset = null
    target?.classList.remove('is-dragging')
    if (target?.hasPointerCapture?.(pointerId))
      target.releasePointerCapture(pointerId)
    if (wasDragging) {
      updateGuide()
      notify()
    }
  }
  function bind(el) {
    el.addEventListener('pointerdown', pointerDown)
    el.addEventListener('pointermove', pointerMove)
    el.addEventListener('pointerup', pointerUp)
    el.addEventListener('pointercancel', pointerUp)
    el.addEventListener('lostpointercapture', pointerUp)
  }
  function unbind(el) {
    el.removeEventListener('pointerdown', pointerDown)
    el.removeEventListener('pointermove', pointerMove)
    el.removeEventListener('pointerup', pointerUp)
    el.removeEventListener('pointercancel', pointerUp)
    el.removeEventListener('lostpointercapture', pointerUp)
  }
  function clearScene() {
    pointerUp()
    generation++
    arSceneReady = false
    wallFeedback?.dispose()
    wallFeedback = null
    debugLayer?.dispose()
    debugLayer = null
    if (scene) disposeObject(scene)
    model = null
    guide = null
    selectedWall = null
  }
  function stopAR() {
    if (mode !== 'ar') return
    running = false
    const oldRenderer = renderer
    if (webxr) {
      const session = webxr
      webxr = null
      void session.stop().finally(() => oldRenderer?.dispose())
    } else {
      xr?.stop()
      xr?.clearCameraPipelineModules()
      oldRenderer?.dispose()
    }
    resetWallMap()
    window.removeEventListener('resize', resizeAR)
    unbind(arCanvas)
    arCanvas.remove()
    arCanvas = null
    clearScene()
    canvas.hidden = false
    preview()
    if (art) void setArt(art)
  }
  function resizeAR() {
    if (!arCanvas) return
    arCanvas.width = window.innerWidth
    arCanvas.height = window.innerHeight
  }
  function updateFocus() {
    if (mode !== 'ar' || !tracking || !arCanvas) return
    const viewport = arCanvas.getBoundingClientRect()
    const hit = pick({
      clientX: viewport.left + viewport.width / 2,
      clientY: viewport.top + viewport.height / 2,
    })
    const changed = candidateWall?.id !== hit?.wall.id
    candidateWall = hit?.wall
    rayPoint = hit?.local
    if (changed) updateGuide()
  }
  function updateTracking(reality) {
    if (!reality || !running || !camera) return
    xrCapabilities = reality.webxr || null
    tracking = reality.trackingStatus === 'NORMAL'
    if (!tracking) pointerUp()
    wallFeedback?.setTracking(tracking)
    debugLayer?.setTracking(tracking)
    if (model) model.visible = tracking && !!selectedWall
    const now = performance.now()
    if (!tracking) {
      // Do not leave an old center hit or diagnostic pretending tracking is live.
      tracker.update([], now)
      boundaryTracker.update([], now)
      candidateWall = null
      rayPoint = null
      diagnostics = null
      detectionAt = null
      lastDetection = 0
    }
    if (reality.trackingStatus !== lastStatus) {
      lastStatus = reality.trackingStatus
      notify()
    }
    if (tracking && now - lastDetection > 650) {
      lastDetection = now
      const report = debugEnabled ? {} : null
      const startedAt = performance.now()
      const detected = detectVerticalWalls(
        reality.worldPoints || [],
        camera.position,
        { diagnostics: report },
      )
      const horizontal = detectHorizontalBoundaries(
        reality.worldPoints || [],
        camera.position,
      )
      if (backend === 'webxr') {
        for (const wall of detected)
          wall.source = `webxr-${reality.webxr.pointSource}`
        for (const boundary of horizontal)
          boundary.source = `webxr-${reality.webxr.pointSource}`
        horizontal.push(...(reality.nativeBoundaries || []))
        // Prefer native polygons to a second estimate of the same plane.
        for (const native of reality.nativeWalls || []) {
          // An excluded native plane must not suppress a corrected depth estimate.
          if (tracker.isRejected(native)) continue
          for (let i = detected.length - 1; i >= 0; i--) {
            const estimate = detected[i]
            if (wallMatch(native, estimate)) detected.splice(i, 1)
          }
          detected.push(native)
        }
        if (report && detected.length) report.status = 'detected'
      }
      detectionMs = performance.now() - startedAt
      detectionAt = now
      diagnostics = report
      filterRejectedCandidates()
      const found = tracker.update(detected, now, {
        cameraPosition: camera.position,
        associationSurfaces: walls,
      })
      boundaries = boundaryTracker.update(horizontal, now, {
        cameraPosition: camera.position,
      })
      walls = expansion.update(found, boundaries)
      // Pose stays anchored, while later ceiling/corner observations refine the
      // usable extent. Refit the entire frame against newly discovered limits.
      if (selectedWall) {
        selectedWall = walls.find((w) => w.id === selectedWall.id)
        const fit = selectedWall && constrain(selectedWall, placement)
        if (fit) {
          placement = { x: fit.x, y: fit.y }
          applyPosition()
        } else {
          pointerUp()
          selectedWall = null
          if (model) model.visible = false
        }
      }
      updateGuide()
      if (debugEnabled)
        debugLayer?.updateWalls(
          walls,
          diagnostics?.candidates || [],
          selectedWall?.id,
        )
    }
    // Aiming is independent of the slower wall-detection cycle. Retained walls
    // are valid targets even when no new depth/plane observation arrives.
    updateFocus()
    if (now - lastHintUpdate >= 80) {
      lastHintUpdate = now
      notify({ pointCount: reality.worldPoints?.length || 0 })
    }
    // HUD/point uploads run at 4 Hz; the camera renders their world positions every frame.
    if (debugEnabled && now - lastDebugUpdate >= 250) {
      lastDebugUpdate = now
      const sampledCount =
        debugLayer?.updatePoints(reality.worldPoints || [], camera.position) ||
        0
      latestDebug = debugSummary({
        backend,
        webxr: xrCapabilities,
        trackingStatus: reality.trackingStatus,
        trackingReason: reality.trackingReason || '',
        rawCount: reality.worldPoints?.length || 0,
        sampledCount,
        diagnostics,
        walls,
        boundaries,
        tracker: tracker.snapshot(),
        hit: candidateWall,
        fits:
          tracking && candidateWall && art
            ? !!constrain(candidateWall, rayPoint)
            : null,
        detectionMs,
        detectionAgeMs: detectionAt === null ? null : now - detectionAt,
        tracking,
      })
      notify()
    }
  }
  function filterRejectedCandidates() {
    if (diagnostics)
      diagnostics.candidates = diagnostics.candidates.filter(
        (candidate) => !tracker.isRejected(candidate),
      )
  }
  function removeWall(id) {
    // Use the highlighted ID supplied by the UI; never silently delete a
    // different plane if the camera focus changed before the click arrived.
    if (
      mode !== 'ar' ||
      !tracking ||
      dragPointer !== null ||
      !id ||
      candidateWall?.id !== id
    )
      return false
    const removed = walls.find((w) => w.id === id)
    if (!removed) return false
    const previous = selectedWall && worldPoint(selectedWall, placement)
    const moving = selectedWall?.id === id
    const remaining = tracker.remove(id, removed)
    if (!remaining) return false
    walls = expansion.update(remaining, boundaries)
    if (moving) {
      let nearest
      for (const wall of walls) {
        const fit = art && constrain(wall, localPoint(wall, previous))
        if (!fit) continue
        const distance = worldPoint(wall, fit).distanceToSquared(previous)
        if (!nearest || distance < nearest.distance)
          nearest = { wall, fit, distance }
      }
      selectedWall = nearest?.wall || null
      if (nearest) {
        placement = { x: nearest.fit.x, y: nearest.fit.y }
        tracker.lock(selectedWall.id)
      }
    } else if (selectedWall) {
      selectedWall = walls.find((w) => w.id === selectedWall.id)
      const fit = selectedWall && constrain(selectedWall, placement)
      if (fit) placement = { x: fit.x, y: fit.y }
      else selectedWall = null
    }
    if (selectedWall) applyPosition()
    else if (model) model.visible = false
    candidateWall = null
    rayPoint = null
    updateFocus()
    updateGuide()
    filterRejectedCandidates()
    if (debugEnabled) {
      debugLayer?.updateWalls(
        walls,
        diagnostics?.candidates || [],
        selectedWall?.id,
      )
      latestDebug = debugSummary({
        ...latestDebug,
        diagnostics,
        walls,
        boundaries,
        tracker: tracker.snapshot(),
        hit: candidateWall,
        fits:
          candidateWall && art ? !!constrain(candidateWall, rayPoint) : null,
        tracking,
      })
    }
    notify()
    return true
  }
  function startAR(host) {
    if (mode === 'ar' || disposed) return
    return arBackend() === 'webxr' ? startWebXR(host) : startLegacyAR(host)
  }
  async function startWebXR(host) {
    const unsupported = cameraUnsupportedReason()
    if (unsupported) throw new Error(unsupported)
    cancelAnimationFrame(raf)
    resizeObserver?.disconnect()
    clearScene()
    renderer.dispose()
    canvas.hidden = true
    mode = 'ar'
    backend = 'webxr'
    tracking = false
    running = true
    walls = []
    resetWallMap()
    lastDetection = 0
    lastStatus = ''
    diagnostics = null
    lastDebugUpdate = 0
    detectionAt = null
    latestDebug = debugSummary()
    candidateWall = null
    rayPoint = null
    dragPointer = null
    arCanvas = document.createElement('canvas')
    arCanvas.className = 'ar-canvas'
    arCanvas.setAttribute(
      'aria-label',
      '色のついた壁をタップして配置。作品をドラッグして移動できます。',
    )
    host.appendChild(arCanvas)
    bind(arCanvas)
    let session
    try {
      scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera(60, 1, 0.05, 30)
      const sessionRenderer = new THREE.WebGLRenderer({
        canvas: arCanvas,
        antialias: true,
        alpha: true,
      })
      renderer = sessionRenderer
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
      renderer.setSize(window.innerWidth, window.innerHeight, false)
      renderer.setClearColor(0x000000, 0)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      lightScene()
      arSceneReady = true
      if (debugEnabled) {
        debugLayer = createARDebugLayer(scene)
        debugLayer.setEnabled(true)
      }
      if (art) void setArt(art)
      session = createWebXRSession({
        renderer,
        scene,
        camera,
        overlay: host.closest('.app-shell') || host,
        onFrame: updateTracking,
        onEnd() {
          if (webxr === session && !disposed) stopAR()
        },
        onError,
        onReset() {
          // A reference-space reset invalidates old room coordinates.
          pointerUp()
          resetWallMap()
          diagnostics = null
          detectionAt = null
          lastDetection = 0
          tracking = false
          debugLayer?.setTracking(false)
          walls = []
          selectedWall = null
          candidateWall = null
          rayPoint = null
          if (model) model.visible = false
          debugLayer?.clear()
          updateGuide()
          notify({
            message:
              '空間の座標が更新されました。壁を再認識して配置してください。',
          })
        },
      })
      webxr = session
      notify({ message: 'カメラを起動しています…' })
      const started = await session.start()
      if (!started || disposed || webxr !== session) return false
      notify()
      return true
    } catch (error) {
      if (!disposed && (!session || webxr === session)) {
        stopAR()
        throw error
      }
      return false
    }
  }
  function startLegacyAR(host) {
    const unsupported = cameraUnsupportedReason()
    if (unsupported) throw new Error(unsupported)
    xr = window.XR8
    if (!xr) throw new Error('ARの準備がまだ完了していません。')
    cancelAnimationFrame(raf)
    resizeObserver?.disconnect()
    clearScene()
    renderer.dispose()
    canvas.hidden = true
    mode = 'ar'
    backend = '8thwall'
    tracking = false
    running = true
    walls = []
    resetWallMap()
    lastDetection = 0
    lastStatus = ''
    diagnostics = null
    lastDebugUpdate = 0
    detectionMs = 0
    detectionAt = null
    latestDebug = debugSummary()
    candidateWall = null
    rayPoint = null
    arCanvas = document.createElement('canvas')
    arCanvas.className = 'ar-canvas'
    arCanvas.setAttribute(
      'aria-label',
      '色のついた壁をタップして配置。作品をドラッグして移動できます。',
    )
    host.appendChild(arCanvas)
    bind(arCanvas)
    resizeAR()
    window.addEventListener('resize', resizeAR)
    const sessionArt = art
    xr.XrController.configure({
      disableWorldTracking: false,
      enableWorldPoints: true,
      scale: 'absolute',
    })
    xr.addCameraPipelineModules([
      xr.GlTextureRenderer.pipelineModule(),
      xr.Threejs.pipelineModule(),
      xr.XrController.pipelineModule(),
      {
        name: 'artar-wall-gallery',
        onStart() {
          if (!running) return
          ;({ scene, camera, renderer } = xr.Threejs.xrScene())
          arSceneReady = true
          renderer.outputColorSpace = THREE.SRGBColorSpace
          lightScene()
          if (debugEnabled) {
            debugLayer = createARDebugLayer(scene)
            debugLayer.setEnabled(true)
          }
          void setArt(sessionArt)
          notify()
        },
        onUpdate({ processCpuResult }) {
          updateTracking(processCpuResult?.reality)
        },
        onCameraStatusChange({ status }) {
          if (status === 'failed') {
            onError(
              'カメラを開始できませんでした。Safari / Chromeのカメラ権限を確認してください。',
            )
            stopAR()
          }
        },
        onException(error) {
          onError(
            `ARを停止しました。${error?.message || 'カメラを再起動してください。'}`,
          )
          stopAR()
        },
      },
    ])
    try {
      const started = xr.run({
        canvas: arCanvas,
        allowedDevices: xr.XrConfig.device().MOBILE,
        glContextConfig: { alpha: false },
      })
      if (started?.catch)
        started.catch((e) => {
          if (running) {
            onError(e?.message || 'ARを開始できませんでした。')
            stopAR()
          }
        })
    } catch (e) {
      stopAR()
      throw e
    }
    notify({ message: 'カメラを起動しています…' })
  }
  preview()
  bind(canvas)
  const onHide = () => {
    if (mode === 'ar') stopAR()
  }
  const visibilityChange = () => {
    if (document.hidden) onHide()
  }
  document.addEventListener('visibilitychange', visibilityChange)
  window.addEventListener('pagehide', onHide)
  return {
    setArt,
    startAR,
    stopAR,
    removeWall,
    setDebug(enabled) {
      debugEnabled = !!enabled
      lastDebugUpdate = 0
      if (debugEnabled && mode === 'ar' && arSceneReady && running) {
        debugLayer ||= createARDebugLayer(scene)
        debugLayer.setTracking(tracking)
        lastDetection = 0
      }
      debugLayer?.setEnabled(debugEnabled)
      if (!debugEnabled) {
        debugLayer?.clear()
        diagnostics = null
        latestDebug = debugSummary()
      }
      notify()
    },
    clearPlacement() {
      pointerUp()
      selectedWall = null
      candidateWall = null
      rayPoint = null
      if (model) model.visible = false
      updateGuide()
      notify()
    },
    get mode() {
      return mode
    },
    place() {
      updateFocus()
      if (candidateWall && rayPoint && tracking)
        return placeOn(candidateWall, rayPoint)
      return false
    },
    nudge(dx, dy) {
      if (selectedWall && (mode === 'preview' || tracking))
        placeOn(selectedWall, {
          x: placement.x + dx,
          y: placement.y + dy,
        })
    },
    reset() {
      pointerUp()
      if (mode === 'ar') {
        webxr?.reset()
        resetWallMap()
        walls = []
        selectedWall = null
        candidateWall = null
        rayPoint = null
        diagnostics = null
        detectionAt = null
        lastDetection = 0
        debugLayer?.clear()
        latestDebug = debugSummary({
          trackingStatus: tracking ? 'NORMAL' : 'LIMITED',
          tracking,
        })
        if (model) model.visible = false
        updateGuide()
        notify()
      } else {
        placeOn(walls[0], { x: 0, y: 1.65 })
      }
    },
    guides(value) {
      guideOn = value
      updateGuide()
    },
    tone(color) {
      room?.setTone(color)
    },
    view(front) {
      if (mode !== 'preview') return
      camera.position.set(
        front ? 0 : 2.1,
        front ? 1.65 : 2.2,
        front ? 5.5 : 5.3,
      )
      camera.lookAt(front ? 0 : -0.3, 1.4, 0.1)
    },
    snapshot() {
      renderer.render(scene, camera)
      return (mode === 'ar' ? arCanvas : canvas).toDataURL('image/png')
    },
    dispose() {
      disposed = true
      running = false
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      if (mode === 'ar') {
        if (webxr) {
          const session = webxr,
            oldRenderer = renderer
          webxr = null
          void session.stop().finally(() => oldRenderer?.dispose())
          renderer = null
        } else {
          xr?.stop()
          xr?.clearCameraPipelineModules()
        }
        unbind(arCanvas)
        arCanvas.remove()
      }
      unbind(canvas)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('resize', resizeAR)
      document.removeEventListener('visibilitychange', visibilityChange)
      clearScene()
      renderer?.dispose()
    },
  }
}
