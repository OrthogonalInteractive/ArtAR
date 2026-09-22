<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
defineProps({ title: String, wide: Boolean })
const emit = defineEmits(['close'])
const element = ref()
let previousFocus
onMounted(() => {
  previousFocus = document.activeElement
  element.value.showModal()
})
onBeforeUnmount(() => {
  element.value?.close()
  previousFocus?.focus()
})
</script>
<template>
  <dialog
    ref="element"
    :class="['dialog', { 'dialog-wide': wide }]"
    @cancel.prevent="emit('close')"
    @click="
      (e) => {
        if (e.target === element) emit('close')
      }
    "
  >
    <div class="dialog-heading">
      <h2>{{ title }}</h2>
      <button class="icon-button" aria-label="閉じる" @click="emit('close')">
        <Icon name="close" />
      </button>
    </div>
    <slot />
  </dialog>
</template>
