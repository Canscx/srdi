export interface RadarSeries {
  label: string
  values: number[]
  color: string
  dashed?: boolean
  fill?: boolean
}

export interface RadarOptions {
  x: number
  y: number
  radius: number
  labels: string[]
  series: RadarSeries[]
  rings?: number
  ringColor?: string
  axisColor?: string
  labelColor?: string
}

const angleOf = (index: number, total: number) => -Math.PI / 2 + (index * 2 * Math.PI) / total

const pointAt = (cx: number, cy: number, radius: number, angle: number) => ({
  x: cx + Math.cos(angle) * radius,
  y: cy + Math.sin(angle) * radius
})

const polygon = (
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  radius: number,
  values: number[]
) => {
  const total = values.length
  values.forEach((value, index) => {
    const point = pointAt(cx, cy, radius * Math.max(0, Math.min(1, value)), angleOf(index, total))
    if (index === 0) doc.moveTo(point.x, point.y)
    else doc.lineTo(point.x, point.y)
  })
  doc.closePath()
}

export const drawRadar = (doc: PDFKit.PDFDocument, options: RadarOptions) => {
  const { x, y, radius, labels, series } = options
  const total = labels.length
  const rings = options.rings ?? 4
  const ringColor = options.ringColor ?? '#e2e8f0'
  const axisColor = options.axisColor ?? '#cbd5e1'
  const labelColor = options.labelColor ?? '#475569'

  doc.save()
  doc.lineWidth(0.8).strokeColor(ringColor)
  for (let ring = 1; ring <= rings; ring += 1) {
    polygon(doc, x, y, (radius * ring) / rings, new Array(total).fill(1))
    doc.stroke()
  }

  doc.lineWidth(0.8).strokeColor(axisColor)
  for (let index = 0; index < total; index += 1) {
    const point = pointAt(x, y, radius, angleOf(index, total))
    doc.moveTo(x, y).lineTo(point.x, point.y).stroke()
  }

  doc.fontSize(8.5).fillColor(labelColor)
  for (let index = 0; index < total; index += 1) {
    const angle = angleOf(index, total)
    const point = pointAt(x, y, radius + 16, angle)
    const cos = Math.cos(angle)
    const width = 96
    const left = cos > 0.2 ? point.x : cos < -0.2 ? point.x - width : point.x - width / 2
    const align = cos > 0.2 ? 'left' : cos < -0.2 ? 'right' : 'center'
    doc.text(labels[index], left, point.y - 5, { width, align })
  }

  for (const item of series) {
    doc.lineWidth(item.dashed ? 1.2 : 1.8).strokeColor(item.color)
    if (item.dashed) doc.dash(4, { space: 3 })
    polygon(doc, x, y, radius, item.values)
    if (item.fill) {
      doc.fillOpacity(0.12).fillColor(item.color).fill()
      doc.fillOpacity(1)
    }
    doc.stroke()
    if (item.dashed) doc.undash()

    for (let index = 0; index < total; index += 1) {
      const value = Math.max(0, Math.min(1, item.values[index] ?? 0))
      const point = pointAt(x, y, radius * value, angleOf(index, total))
      doc.circle(point.x, point.y, 2.6).fillColor(item.color).fill()
    }
  }

  doc.restore()
}

export const drawLegend = (
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  series: { label: string; color: string; dashed?: boolean }[]
) => {
  let cursor = x
  doc.fontSize(9)
  for (const item of series) {
    doc.lineWidth(2).strokeColor(item.color)
    if (item.dashed) doc.dash(4, { space: 3 })
    doc.moveTo(cursor, y + 5).lineTo(cursor + 18, y + 5).stroke()
    if (item.dashed) doc.undash()
    doc.fillColor('#475569').text(item.label, cursor + 22, y, { lineBreak: false })
    cursor += 28 + doc.widthOfString(item.label)
  }
}
