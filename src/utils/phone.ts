export function normalizePhoneForOtp(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const compact = trimmed.replace(/[\s\-().]/g, "")
  if (!compact) return null

  const withPlus = compact.startsWith("00") ? `+${compact.slice(2)}` : compact
  const hasPlus = withPlus.startsWith("+")
  const digitsOnly = hasPlus ? withPlus.slice(1) : withPlus

  if (!/^\d+$/.test(digitsOnly)) return null

  let normalizedDigits = digitsOnly

  // Convenience for US local input without country code.
  if (!hasPlus) {
    if (digitsOnly.length === 10) {
      normalizedDigits = `1${digitsOnly}`
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
      normalizedDigits = digitsOnly
    } else {
      return null
    }
  }

  if (!/^\d{8,15}$/.test(normalizedDigits)) return null

  return `+${normalizedDigits}`
}
