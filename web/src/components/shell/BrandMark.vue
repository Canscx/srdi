<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), {
  size: 44
})

const markSrc = '/brand-mark.svg'
</script>

<template>
  <img
    class="brand-mark"
    :src="markSrc"
    alt=""
    aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.brand-mark {
  display: block;
  flex: 0 0 auto;
  object-fit: contain;
}
</style>
