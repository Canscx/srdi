export const cleanBusinessScope = (raw: string): string => {
  let text = (raw ?? '').replace(/\s+/g, ' ').trim()
  text = text.replace(/^经营范围\s*[:：]\s*/, '')
  const cut = text.search(/注册资本|法定代表人|成立日期|营业期限|登记机关/)
  if (cut > 20) text = text.slice(0, cut)
  return text.trim()
}
