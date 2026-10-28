<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([RadarChart, LegendComponent, TooltipComponent, CanvasRenderer])

interface RadarPoint {
  name: string
  max: number
  official: number
  conservative: number
  optimistic: number
}

const props = defineProps<{ points: RadarPoint[] }>()

const host = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null

const round = (value: number) => Math.round(value * 100) / 100

const option = () => ({
  animationDuration: 420,
  tooltip: {
    trigger: 'item',
    confine: true,
    textStyle: { fontSize: 11 },
    valueFormatter: (value: unknown) => `${round(Number(value))}`
  },
  legend: {
    data: ['保守', '乐观', '参考'],
    bottom: 0,
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 14,
    textStyle: { fontSize: 11, color: '#6b7280' }
  },
  radar: {
    center: ['50%', '45%'],
    radius: '62%',
    splitNumber: 4,
    axisName: { color: '#4b5563', fontSize: 11 },
    axisLine: { lineStyle: { color: '#e6ebf2' } },
    splitLine: { lineStyle: { color: '#edf1f7' } },
    splitArea: { areaStyle: { color: ['#fbfcfe', '#f5f8fd'] } },
    indicator: props.points.map((point) => ({
      name: `${point.name} (${point.max})`,
      max: point.max
    }))
  },
  series: [
    {
      type: 'radar',
      symbolSize: 3,
      emphasis: { lineStyle: { width: 2 } },
      data: [
        {
          name: '保守',
          value: props.points.map((point) => round(point.conservative)),
          lineStyle: { color: '#94a3b8', width: 1, type: 'dashed' },
          itemStyle: { color: '#94a3b8' },
          areaStyle: { color: 'rgba(148, 163, 184, 0.06)' }
        },
        {
          name: '乐观',
          value: props.points.map((point) => round(point.optimistic)),
          lineStyle: { color: '#0ea5e9', width: 1, type: 'dotted' },
          itemStyle: { color: '#0ea5e9' },
          areaStyle: { color: 'rgba(14, 165, 233, 0.05)' }
        },
        {
          name: '参考',
          value: props.points.map((point) => round(point.official)),
          lineStyle: { color: '#2563eb', width: 2 },
          itemStyle: { color: '#2563eb' },
          areaStyle: { color: 'rgba(37, 99, 235, 0.14)' }
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

watch(() => props.points, render, { deep: true })

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
  height: 268px;
}
</style>
