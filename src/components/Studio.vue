<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { createExperience } from '../ar/engine.js'
const emit = defineEmits(['state', 'error', 'ready'])
const canvas = ref(),
  host = ref()
let engine
onMounted(() => {
  try {
    engine = createExperience({
      canvas: canvas.value,
      onState: (s) => emit('state', s),
      onError: (m) => emit('error', m),
    })
    emit('ready')
  } catch (e) {
    emit(
      'error',
      '3D表示を開始できませんでした。WebGLを利用できるブラウザでお試しください。',
    )
  }
})
onBeforeUnmount(() => engine?.dispose())
defineExpose({
  setArt: (a) => engine?.setArt(a),
  startAR: () => engine?.startAR(host.value),
  stopAR: () => engine?.stopAR(),
  place: () => engine?.place(),
  clearPlacement: () => engine?.clearPlacement(),
  nudge: (x, y) => engine?.nudge(x, y),
  reset: () => engine?.reset(),
  guides: (v) => engine?.guides(v),
  tone: (c) => engine?.tone(c),
  view: (v) => engine?.view(v),
  beginCalibration: () => engine?.beginCalibration(),
  calibrate: (n) => engine?.calibrate(n),
  beginBounds: () => engine?.beginBounds(),
  cancelInteraction: () => engine?.cancelInteraction(),
  snapshot: () => engine?.snapshot(),
})
</script>
<template>
  <div ref="host" class="scene-host">
    <canvas
      ref="canvas"
      class="room-canvas"
      aria-label="部屋の3Dプレビュー。壁をタップして配置、作品をドラッグして移動できます。"
    />
  </div>
</template>
