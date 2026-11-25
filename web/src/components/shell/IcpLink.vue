<script setup lang="ts">
const ICP_NUMBER = '浙ICP备2025216279号'
const ICP_URL = 'https://beian.miit.gov.cn/'
</script>

<template>
  <a class="icp" :href="ICP_URL" target="_blank" rel="noopener noreferrer">{{ ICP_NUMBER }}</a>
</template>

<style scoped>
.icp {
  color: inherit;
  font-size: inherit;
  letter-spacing: inherit;
  text-decoration: none;
  transition: color 0.16s ease;
}

.icp:hover {
  color: #2563eb;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.icp:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.35);
  outline-offset: 2px;
  border-radius: 3px;
}
</style>
