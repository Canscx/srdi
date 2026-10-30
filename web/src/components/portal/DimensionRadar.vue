<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { PortalDimension } from '@srdi/shared'

echarts.use([RadarChart, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ dimensions: PortalDimension[] }>()

const host = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null

const round = (value: number) => Math.round(value * 100) / 100

const option = () => ({
  animationDuration: 460,
  tooltip: {
    trigger: 'item',
    confine: true,
    textStyle: { fontSize: 11 },
    valueFormatter: (value: unknown) => `${round(Number(value))} 分`
  },
  legend: {
    data: ['补齐后', '当前'],
    bottom: 0,
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 18,
    textStyle: { fontSize: 11, color: '#6b7280' }
  },
  radar: {
    center: ['50%', '46%'],
    radius: '62%',
    splitNumber: 4,
    axisName: { color: '#4b5563', fontSize: 11.5 },
    axisLine: { lineStyle: { color: '#e6ebf2' } },
    splitLine: { lineStyle: { color: '#edf1f7' } },
    splitArea: { areaStyle: { color: ['#fbfcfe', '#f5f8fd'] } },
    indicator: props.dimensions.map((item) => ({ name: item.name, max: item.max }))
  },
  series: [
    {
      type: 'radar',
      symbolSize: 3,
      emphasis: { lineStyle: { width: 2 } },
      data: [
        {
          name: '补齐后',
          value: props.dimensions.map((item) => round(item.optimistic)),
          lineStyle: { color: '#7dd3fc', width: 1.2, type: 'dashed' },
          itemStyle: { color: '#7dd3fc' },
          areaStyle: { color: 'rgba(125, 211, 252, 0.18)' }
        },
        {
          name: '当前',
          value: props.dimensions.map((item) => round(item.score)),
          lineStyle: { color: '#1d4ed8', width: 2 },
          itemStyle: { color: '#1d4ed8' },
          areaStyle: { color: 'rgba(29, 78, 216, 0.22)' }
        }
      ]
    }
  ]
})

const render = () => {
  if (!chart) return
  chart.setOption(option(), true)
}

const resize = () => chart?.resize()

onMounted(() => {
  if (!host.value) return
  chart = echarts.init(host.value)
  render()
  window.addEventListener('resize', resize)
})

watch(() => props.dimensions, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="host" class="radar" />
</template>

<style scoped>
.radar {
  width: 100%;
  height: 300px;
}
</style>
