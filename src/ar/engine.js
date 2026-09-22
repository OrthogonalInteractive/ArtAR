import * as THREE from 'three'
import { createArtwork, disposeObject } from './artwork.js'
import { createRoom } from './room.js'
import {
  makeWall,
  fitPlacement,
  localPoint,
  worldPoint,
  detectVerticalWalls,
  createWallTracker,
} from './walls.js'
import { artDimensions } from '../data/catalog.js'

// Matches the engine distribution used by ../portfolio. No API key required.
export const ENGINE_URL =
  'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js'
let loading
export function prepareAR() {
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
    selectedWall,
    placement = { x: 0, y: 1.65 }
  let mode = 'preview',
    disposed = false,
    generation = 0,
    unitsPerMeter = 1,
    guide,
    guideOn = true,
    running = false
  let tracking = false,
    lastDetection = 0,
    candidateWall,
    rayPoint,
    calibration = [],
    interaction = 'place',
    lastStatus = ''
  let raf,
    arCanvas,
    xr,
    resizeObserver,
    dragPointer = null,
    dragOffset = null
  const tracker = createWallTracker(),
    raycaster = new THREE.Raycaster()
  const notify = (extra = {}) =>
    onState({
      mode,
      placed: !!selectedWall,
      wallCount: walls.length,
      position: { ...placement },
      tracking: mode === 'preview' || tracking,
      calibrated: unitsPerMeter !== 1,
      wallSource: selectedWall?.source,
      interaction,
      canPlace: !!candidateWall,
      ...extra,
    })
  const dimensions = () => artDimensions(art, unitsPerMeter)
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
    if (!selectedWall || !guideOn) return
    const vertices = selectedWall.polygon.map((p) =>
      worldPoint(selectedWall, p, 0.006),
    )
    vertices.push(vertices[0])
    guide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineDashedMaterial({
        color: mode === 'ar' ? 0xd4f279 : 0x778177,
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
    model.position.copy(
      worldPoint(selectedWall, placement, 0.008 * unitsPerMeter),
    )
    model.quaternion.copy(selectedWall.rotation)
    model.scale.setScalar(unitsPerMeter)
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
      0.02 * unitsPerMeter,
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
    interaction = 'place'
    if (mode === 'ar') tracker.lock(wall.id)
    applyPosition()
    updateGuide()
    notify({
      message: fit.clamped ? '額縁が壁の範囲に収まる位置に調整しました。' : '',
    })
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
    unitsPerMeter = 1
    tracking = true
    selectedWall = null
    calibration = []
    interaction = 'place'
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
      scene.add(model)
      if (nextPosition) placement = { x: nextPosition.x, y: nextPosition.y }
      model.visible = !!selectedWall
      applyPosition()
      updateGuide()
      notify({
        message: nextPosition?.clamped
          ? '新しい額縁の外寸に合わせて位置を調整しました。'
          : '',
      })
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
    if (event.button !== 0 || (mode === 'ar' && !tracking) || !art) return
    const hit = pick(event)
    if (!hit) return
    if (interaction === 'calibrate') {
      if (selectedWall && hit.wall.id === selectedWall.id) {
        calibration.push(hit.world)
        if (calibration.length === 2) interaction = 'measure'
        notify({
          calibrationPoints: calibration.length,
          message:
            calibration.length === 1
              ? '同じ壁のもう一方の端をタップしてください。'
              : '2点間の実際の長さを入力してください。',
        })
      }
      return
    }
    if (interaction === 'measure') return
    if (interaction === 'bounds') {
      if (hit.wall.id !== selectedWall?.id) return
      calibration.push(hit.local)
      if (calibration.length === 2) {
        const [a, b] = calibration
        if (Math.abs(a.x - b.x) < 0.2 || Math.abs(a.y - b.y) < 0.2) {
          calibration = []
          notify({ message: '対角の2点を、20cm以上離して指定してください。' })
          return
        }
        const next = makeWall({
          ...selectedWall,
          polygon: [
            { x: a.x, y: a.y },
            { x: b.x, y: a.y },
            { x: b.x, y: b.y },
            { x: a.x, y: b.y },
          ],
          source: 'manual',
        })
        if (!constrain(next, placement)) {
          calibration = []
          notify({
            message:
              'その範囲には作品が収まりません。広い範囲を指定してください。',
          })
          return
        }
        walls = walls.map((w) => (w.id === next.id ? next : w))
        placeOn(next, placement)
        calibration = []
      } else
        notify({ message: '飾れる範囲の、反対側の角をタップしてください。' })
      return
    }
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
      ;(mode === 'ar' ? arCanvas : canvas).setPointerCapture(event.pointerId)
    }
  }
  function pointerMove(event) {
    if (
      dragPointer !== event.pointerId ||
      interaction !== 'place' ||
      (mode === 'ar' && !tracking)
    )
      return
    const hit = pick(event)
    if (!hit) return
    const offset = hit.wall.id === selectedWall?.id ? dragOffset : null
    placeOn(hit.wall, {
      x: hit.local.x + (offset?.x || 0),
      y: hit.local.y + (offset?.y || 0),
    })
  }
  const pointerUp = () => {
    dragPointer = null
    dragOffset = null
  }
  function bind(el) {
    el.addEventListener('pointerdown', pointerDown)
    el.addEventListener('pointermove', pointerMove)
    el.addEventListener('pointerup', pointerUp)
    el.addEventListener('pointercancel', pointerUp)
  }
  function unbind(el) {
    el.removeEventListener('pointerdown', pointerDown)
    el.removeEventListener('pointermove', pointerMove)
    el.removeEventListener('pointerup', pointerUp)
    el.removeEventListener('pointercancel', pointerUp)
  }
  function clearScene() {
    generation++
    if (scene) disposeObject(scene)
    model = null
    guide = null
    selectedWall = null
  }
  function stopAR() {
    if (mode !== 'ar') return
    running = false
    xr?.stop()
    xr?.clearCameraPipelineModules()
    tracker.reset()
    window.removeEventListener('resize', resizeAR)
    unbind(arCanvas)
    arCanvas.remove()
    arCanvas = null
    clearScene()
    renderer?.dispose()
    canvas.hidden = false
    preview()
    if (art) void setArt(art)
  }
  function resizeAR() {
    if (!arCanvas) return
    arCanvas.width = window.innerWidth
    arCanvas.height = window.innerHeight
  }
  function startAR(host) {
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
    tracking = false
    running = true
    walls = []
    unitsPerMeter = 1
    lastDetection = 0
    lastStatus = ''
    candidateWall = null
    rayPoint = null
    interaction = 'place'
    calibration = []
    arCanvas = document.createElement('canvas')
    arCanvas.className = 'ar-canvas'
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
          renderer.outputColorSpace = THREE.SRGBColorSpace
          lightScene()
          void setArt(sessionArt)
          notify({
            message:
              '壁の模様や角が映るように、端末をゆっくり左右に動かしてください。',
          })
        },
        onUpdate({ processCpuResult }) {
          const reality = processCpuResult?.reality
          if (!reality || !running || !camera) return
          tracking = reality.trackingStatus === 'NORMAL'
          if (reality.trackingStatus !== lastStatus) {
            lastStatus = reality.trackingStatus
            notify({
              message: tracking
                ? ''
                : '空間を再認識しています。端末をゆっくり動かしてください。',
            })
          }
          if (model) model.visible = tracking && !!selectedWall
          const now = performance.now()
          if (!tracking) return
          if (now - lastDetection > 650) {
            lastDetection = now
            const detected = detectVerticalWalls(
              reality.worldPoints || [],
              camera.position,
            )
            const found = tracker.update(detected, now)
            // Preserve explicit boundary edits and the selected wall's stable pose.
            walls = found.map(
              (w) =>
                walls.find(
                  (old) =>
                    old.id === w.id &&
                    (old.id === selectedWall?.id || old.source === 'manual'),
                ) || w,
            )
            if (selectedWall && !walls.some((w) => w.id === selectedWall.id))
              walls.push(selectedWall)
            const viewport = arCanvas.getBoundingClientRect()
            const hit = pick({
              clientX: viewport.left + viewport.width / 2,
              clientY: viewport.top + viewport.height / 2,
            })
            candidateWall = hit?.wall
            rayPoint = hit?.local
            notify({ pointCount: reality.worldPoints?.length || 0 })
          }
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
    clearPlacement() {
      selectedWall = null
      candidateWall = null
      rayPoint = null
      interaction = 'place'
      if (model) model.visible = false
      updateGuide()
      notify()
    },
    get mode() {
      return mode
    },
    place() {
      if (candidateWall && rayPoint && tracking)
        return placeOn(candidateWall, rayPoint)
      return false
    },
    nudge(dx, dy) {
      if (selectedWall && (mode === 'preview' || tracking))
        placeOn(selectedWall, {
          x: placement.x + dx * unitsPerMeter,
          y: placement.y + dy * unitsPerMeter,
        })
    },
    reset() {
      if (mode === 'ar') {
        tracker.reset()
        walls = []
        selectedWall = null
        candidateWall = null
        rayPoint = null
        if (model) model.visible = false
        updateGuide()
        notify({ message: '別の壁にカメラを向けてください。' })
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
    beginCalibration() {
      if (!selectedWall) return
      calibration = []
      interaction = 'calibrate'
      notify({
        calibrationPoints: 0,
        message: '同じ壁にある、長さがわかる線の両端をタップしてください。',
      })
    },
    calibrate(cm) {
      if (
        calibration.length !== 2 ||
        interaction !== 'measure' ||
        !Number.isFinite(cm) ||
        cm < 10 ||
        cm > 500
      )
        throw new Error('10〜500cmの実測値を入力してください。')
      const measured = calibration[0].distanceTo(calibration[1])
      if (measured < 0.05)
        throw new Error('2点が近すぎます。もう一度指定してください。')
      const next = measured / (cm / 100)
      if (next < 0.1 || next > 10)
        throw new Error('補正値が範囲外です。2点を指定し直してください。')
      const previous = unitsPerMeter
      unitsPerMeter = next
      const fit = constrain(selectedWall, placement)
      if (!fit) {
        unitsPerMeter = previous
        throw new Error(
          '補正後の作品が壁に収まりません。広い範囲を認識してから補正してください。',
        )
      }
      placement = { x: fit.x, y: fit.y }
      interaction = 'place'
      calibration = []
      applyPosition()
      notify({
        message: '実測した長さで表示サイズを補正しました。',
        calibrationPoints: 0,
      })
    },
    beginBounds() {
      if (!selectedWall) return
      calibration = []
      interaction = 'bounds'
      notify({
        message: '飾れる範囲の左下と右上を、壁の中でタップしてください。',
      })
    },
    cancelInteraction() {
      interaction = 'place'
      calibration = []
      notify({ calibrationPoints: 0, message: '' })
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
        xr?.stop()
        xr?.clearCameraPipelineModules()
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
