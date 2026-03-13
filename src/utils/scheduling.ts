export interface GeneratedScheduleBlock {
  startLocal: string
  endLocal: string
}

export type ScheduleQuickPreset = "day" | "week" | "month"

export interface SchedulePresetRange {
  startDate: string
  endDate: string
  weekdays: number[]
}

interface GenerateScheduleBlocksFromRangePayload {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  weekdays: number[]
  maxEntries?: number
}

function parseLocalDate(value: string) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (!Number.isFinite(date.getTime())) return null
  return date
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function normalizeToLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function getSchedulePresetRange(preset: ScheduleQuickPreset, referenceDate = new Date()): SchedulePresetRange {
  const start = normalizeToLocalDay(referenceDate)
  const end = new Date(start.getTime())

  if (preset === "week") {
    end.setDate(end.getDate() + 6)
    return {
      startDate: toDateInputValue(start),
      endDate: toDateInputValue(end),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    }
  }

  if (preset === "month") {
    const endOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    return {
      startDate: toDateInputValue(start),
      endDate: toDateInputValue(endOfMonth),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    }
  }

  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(start),
    weekdays: [start.getDay()],
  }
}

export function generateScheduleBlocksFromRange(payload: GenerateScheduleBlocksFromRangePayload) {
  const startDate = parseLocalDate(payload.startDate)
  const endDate = parseLocalDate(payload.endDate)

  if (!startDate || !endDate) return [] as GeneratedScheduleBlock[]
  if (!payload.startTime || !payload.endTime) return [] as GeneratedScheduleBlock[]
  if (startDate.getTime() > endDate.getTime()) return [] as GeneratedScheduleBlock[]

  const selectedWeekdays = new Set(
    payload.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
  )
  if (selectedWeekdays.size === 0) return [] as GeneratedScheduleBlock[]

  const maxEntries = Math.max(1, Math.min(payload.maxEntries ?? 200, 1000))
  const crossesMidnight = payload.endTime <= payload.startTime

  const blocks: GeneratedScheduleBlock[] = []
  const cursor = new Date(startDate.getTime())

  while (cursor.getTime() <= endDate.getTime() && blocks.length < maxEntries) {
    if (selectedWeekdays.has(cursor.getDay())) {
      const startLocal = `${toDateInputValue(cursor)}T${payload.startTime}`
      const endDateValue = new Date(cursor.getTime())
      if (crossesMidnight) {
        endDateValue.setDate(endDateValue.getDate() + 1)
      }
      const endLocal = `${toDateInputValue(endDateValue)}T${payload.endTime}`
      blocks.push({ startLocal, endLocal })
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  return blocks
}
