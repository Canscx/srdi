const CHARSET = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]

export const normalizeCreditCode = (value: string): string =>
  (value ?? '').replace(/[\s\u3000]/g, '').toUpperCase()

export const creditCodeCheckChar = (first17: string): string | null => {
  if (first17.length !== 17) return null
  let sum = 0
  for (let index = 0; index < 17; index += 1) {
    const point = CHARSET.indexOf(first17[index])
    if (point < 0) return null
    sum += point * WEIGHTS[index]
  }
  const rest = 31 - (sum % 31)
  return CHARSET[rest === 31 ? 0 : rest]
}

export const isValidCreditCode = (value: string): boolean => {
  const code = normalizeCreditCode(value)
  if (code.length !== 18) return false
  const check = creditCodeCheckChar(code.slice(0, 17))
  return check !== null && check === code[17]
}
