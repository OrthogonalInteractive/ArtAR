<script setup>
import { ref, computed } from 'vue'
import { CANDIDATE_REASONS, debugSummary } from '../ar/debug.js'
const props = defineProps({ data: Object })
const data = computed(() => props.data || debugSummary())
const copied = ref(false),
  copyError = ref(false),
  copyText = ref('')
async function copy() {
  const text = JSON.stringify(
    { app: 'ArtAR', capturedAt: new Date().toISOString(), ...data.value },
    null,
    2,
  )
  copyText.value = text
  copied.value = false
  copyError.value = false
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
  } catch {
    copyError.value = true
  }
}
</script>
<template>
  <section class="ar-debug-panel" aria-label="ARの認識デバッグ">
    <div class="debug-heading">
      <strong>AR DEBUG</strong
      ><span :class="['debug-tracking', { normal: data.visible }]">{{
        data.trackingStatus
      }}</span
      ><button @click="copy">
        {{ copied ? 'コピー済み' : '診断をコピー' }}
      </button>
    </div>
    <p v-if="data.backend === 'webxr'" class="debug-message">
      WebXR · Depth：{{
        {
          active: '取得中',
          waiting: '取得待ち',
          unavailable: '非対応',
          error: '取得エラー',
        }[data.webxr?.depth] || '準備中'
      }}
      / 垂直面：{{ data.webxr?.nativePlaneCount || 0 }} / 点群：{{
        data.webxr?.pointSource === 'depth' ? '深度' : 'ヒットテスト'
      }}
    </p>
    <p v-else class="debug-message">8th Wall · 空間特徴点</p>
    <div class="debug-legend" aria-label="デバッグの凡例">
      <span class="debug-points">● 点群</span
      ><span class="debug-pending">■ 判定待ち</span>
      <span class="debug-confirmed">面の色：壁の向き</span
      ><span class="debug-selected">□ 白枠：配置中</span
      ><span class="debug-rejected">■ 条件未達</span>
    </div>
    <dl class="debug-metrics">
      <div>
        <dt>受信点</dt>
        <dd>{{ data.rawCount }}</dd>
      </div>
      <div>
        <dt>表示・処理点</dt>
        <dd>{{ data.sampledCount }}</dd>
      </div>
      <div>
        <dt>認識した壁</dt>
        <dd>{{ data.wallCount }}</dd>
      </div>
      <div>
        <dt>最大面内点</dt>
        <dd>{{ data.bestInliers }} / {{ data.requiredPoints }}</dd>
      </div>
    </dl>
    <p class="debug-message">{{ data.message }}</p>
    <details class="debug-details">
      <summary>壁候補・判定条件</summary>
      <p>
        追跡理由：{{ data.trackingReason || '—' }}<br />壁判定：{{
          data.detectionMs
        }}
        ms /
        {{
          data.detectionAgeMs === null
            ? '未実行'
            : `${data.detectionAgeMs} ms前`
        }}
      </p>
      <p v-if="!data.visible">
        以下の壁は保持中の情報です。現在の認識結果ではありません。
      </p>
      <ul v-if="data.candidates.length" class="debug-candidates">
        <li
          v-for="candidate in data.candidates"
          :key="candidate.number"
          :class="candidate.accepted ? 'debug-pending' : 'debug-rejected'"
        >
          <strong
            >候補{{ candidate.number }} · {{ candidate.pointCount }}点</strong
          >
          <span
            >{{ candidate.widthCm }} × {{ candidate.heightCm }} cm / ばらつき
            {{ candidate.residualMm }} mm</span
          >
          <span v-if="candidate.filledCells !== undefined"
            >面内の広がり：{{ candidate.filledCells }} / 9区画</span
          >
          <span>{{
            candidate.accepted
              ? '形状条件を通過'
              : candidate.reasons.map((r) => CANDIDATE_REASONS[r]).join('・')
          }}</span>
        </li>
      </ul>
      <p v-else>評価できる壁候補はまだありません。</p>
      <ul v-if="data.trackedWalls.length" class="debug-walls">
        <li v-for="wall in data.trackedWalls" :key="wall.id">
          {{ wall.id }}：{{
            wall.confirmed ? '認識済み' : `一致 ${wall.confirmations} / 3`
          }}{{ wall.needsViewpoint ? '・端末の移動待ち' : ''
          }}{{ wall.locked ? '・固定中' : '' }}
        </li>
      </ul>
      <p>
        同一面20点以上かつ対象点の12%以上 / 幅45cm・高さ40cm以上 /
        面内9区画のうち6区画以上に点が分布 / ばらつき28mm未満 /
        位置4cm・向き3度以内で3回連続一致。点群は7m未満・最大800点。寸法は補正前の推定値です。
      </p>
      <p v-if="data.backend === 'webxr'">
        ネイティブ面は幅45cm・高さ40cm以上、3回一致で採用。深度・ヒットテストの点群には上記の平面判定も行います。Depthがない場合は、壁の上下・左右を映して観測範囲を広げてください。
      </p>
      <p v-else>
        空間特徴点からの壁は、端末が6cm以上移動しても位置・向きが一致することを確認して採用します。
      </p>
      <p>
        色の面は観測された範囲です。物理的な壁の端や障害物を示すものではありません。線の矢印は壁の表向きです。
      </p>
    </details>
    <div v-if="copyError" class="debug-copy-fallback">
      <label
        >コピーできませんでした。下の診断を選択してコピーできます。<textarea
          :value="copyText"
          readonly
          @focus="$event.target.select()"
        />
      </label>
    </div>
  </section>
</template>
