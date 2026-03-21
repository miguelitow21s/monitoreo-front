"use client"

import { useCallback, useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
import { useRole } from "@/hooks/useRole"
import ProtectedRoute from "@/components/ProtectedRoute"
import RoleGuard from "@/components/RoleGuard"
import { useToast } from "@/components/toast/ToastProvider"
import Button from "@/components/ui/Button"
import Card from "@/components/ui/Card"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import {
  assignEmployeeToRestaurant,
  createRestaurant,
  listRestaurantEmployees,
  listRestaurants,
  Restaurant,
  RestaurantEmployee,
  unassignEmployeeFromRestaurant,
  updateRestaurant,
  updateRestaurantStatus,
} from "@/services/restaurants.service"
import { listUserProfiles, UserProfile } from "@/services/users.service"
import { ROLES } from "@/utils/permissions"

type GeocodingCandidate = {
  id: string
  displayName: string
  lat: number
  lng: number
  importance: number
  matchScore: number
  countryCode?: string
  tokenCoverage: number
  numericCoverage: number
}

type NominatimSearchRow = {
  place_id?: number
  display_name?: string
  lat?: string
  lon?: string
  importance?: number
}

type PhotonFeature = {
  geometry?: {
    coordinates?: [number, number]
  }
  properties?: {
    osm_id?: number
    name?: string
    city?: string
    state?: string
    country?: string
    street?: string
    housenumber?: string
    postcode?: string
    extent?: number[]
  }
}

type PhotonSearchResponse = {
  features?: PhotonFeature[]
}

type CountryPreference = "auto" | "co" | "us" | "global"
type AssignmentRoleFilter = "employee" | "supervisor"

type ReverseNominatimResponse = {
  address?: {
    country_code?: string
    country?: string
  }
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function parseNullableNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function buildRestaurantAddressLabel(restaurant: Pick<Restaurant, "address_line" | "city" | "state" | "postal_code" | "country">) {
  const parts = [
    restaurant.address_line,
    restaurant.city,
    restaurant.state,
    restaurant.postal_code,
    restaurant.country,
  ]
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)

  return parts.join(", ")
}

function buildMapPreviewUrl(lat: number, lng: number) {
  const delta = 0.005
  const left = lng - delta
  const right = lng + delta
  const top = lat + delta
  const bottom = lat - delta
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`
}

function normalizeAddressInput(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
}

function expandStreetAbbreviations(value: string) {
  return value
    .replace(/\bcl\.?\b/gi, "calle")
    .replace(/\bcra\.?\b/gi, "carrera")
    .replace(/\bcr\.?\b/gi, "carrera")
    .replace(/\bav\.?\b/gi, "avenida")
    .replace(/\bdiag\.?\b/gi, "diagonal")
    .replace(/\btransv\.?\b/gi, "transversal")
    .replace(/\btv\.?\b/gi, "transversal")
    .replace(/\s+/g, " ")
    .trim()
}

function inferCountryCodes(value: string) {
  const normalized = stripDiacritics(value).toLowerCase()
  if (/\b(colombia|antioquia|medellin|bogota|bello|cali|barranquilla|cartagena)\b/.test(normalized)) {
    return ["co"]
  }
  if (/\b(usa|u\.s\.a|united states|eeuu|u\.s\.)\b/.test(normalized)) {
    return ["us"]
  }
  return [] as string[]
}

function normalizeCountryCode(value?: string | null) {
  if (!value) return ""
  return value.trim().toLowerCase()
}

function inferCountryFromLabel(value: string) {
  const normalized = stripDiacritics(value).toLowerCase()
  if (/\b(colombia|col\.?|co)\b/.test(normalized)) return "co"
  if (/\b(united states|usa|u\.?s\.?a?|estados unidos|eeuu|us)\b/.test(normalized)) return "us"
  return ""
}

function getCountryNameFromCode(code: string) {
  if (code === "co") return "Colombia"
  if (code === "us") return "United States"
  return code.toUpperCase()
}

function buildAddressSearchQueries(rawQuery: string, preferredCountry?: string) {
  const normalized = normalizeAddressInput(rawQuery)
  const expanded = expandStreetAbbreviations(normalized)
  const hashAsSpace = expanded.replace(/\s*#\s*/g, " ")
  const hashAsNo = expanded.replace(/\s*#\s*/g, " no ")
  const countryHints = inferCountryCodes(normalized)
  const variants = new Set<string>()
  const includesUsContext = /\b(usa|us|united states)\b/i.test(normalized)
  const includesCoContext = /\b(colombia)\b/i.test(normalized)

  variants.add(normalized)
  variants.add(expanded)
  variants.add(hashAsSpace)
  variants.add(hashAsNo)
  const preferUS = preferredCountry === "us"
  const preferCO = preferredCountry === "co"
  const allowUS = !preferredCountry || preferredCountry === "us"
  const allowCO = !preferredCountry || preferredCountry === "co"

  if (allowUS && !includesUsContext) variants.add(`${normalized}, USA`)
  if (allowCO && !includesCoContext) variants.add(`${normalized}, Colombia`)
  if (expanded !== normalized) {
    if (allowUS && !includesUsContext) variants.add(`${expanded}, USA`)
    if (allowCO && !includesCoContext) variants.add(`${expanded}, Colombia`)
  }

  const unitStripped = normalized
    .replace(/\b(apt|apartment|suite|ste|unit|#)\s*[a-z0-9-]+\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,/g, ", ")
    .trim()

  if (unitStripped.length >= 5 && unitStripped !== normalized) {
    variants.add(unitStripped)
    if (allowUS && !includesUsContext) variants.add(`${unitStripped}, USA`)
    if (allowCO && !includesCoContext) variants.add(`${unitStripped}, Colombia`)
  }

  const segments = normalized.split(",").map(item => item.trim()).filter(Boolean)
  if (segments.length >= 3) {
    const withoutNeighborhood = `${segments[0]}, ${segments[segments.length - 2]}, ${segments[segments.length - 1]}`
    variants.add(withoutNeighborhood)
    if (allowUS && !includesUsContext) variants.add(`${withoutNeighborhood}, USA`)
    if (allowCO && !includesCoContext) variants.add(`${withoutNeighborhood}, Colombia`)

    for (let index = 1; index < segments.length - 1; index += 1) {
      const reduced = `${segments[0]}, ${segments.slice(index).join(", ")}`
      variants.add(reduced)
      if (allowUS && !includesUsContext) variants.add(`${reduced}, USA`)
      if (allowCO && !includesCoContext) variants.add(`${reduced}, Colombia`)
    }
  }

  if (preferUS) {
    variants.add(`${expanded}, USA`)
    variants.add(`${hashAsSpace}, USA`)
  }
  if (preferCO) {
    variants.add(`${expanded}, Colombia`)
    variants.add(`${hashAsSpace}, Colombia`)
  }

  for (const countryCode of countryHints) {
    if (countryCode === "co") {
      variants.add(`${expanded}, Colombia`)
      variants.add(`${hashAsSpace}, Colombia`)
    }
    if (countryCode === "us") {
      variants.add(`${expanded}, USA`)
    }
  }

  return Array.from(variants).filter(item => item.length >= 4)
}

function tokenizeAddressQuery(value: string) {
  return normalizeAddressInput(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length >= 2)
}

function getAddressCoverage(tokens: string[], numericTokens: string[], displayName: string) {
  if (tokens.length === 0) {
    return {
      tokenCoverage: 0,
      numericCoverage: 0,
    }
  }

  const normalizedDisplay = stripDiacritics(displayName).toLowerCase()
  const tokenMatches = tokens.reduce((count, token) => count + (normalizedDisplay.includes(token) ? 1 : 0), 0)
  const numericMatches = numericTokens.reduce((count, token) => count + (normalizedDisplay.includes(token) ? 1 : 0), 0)

  return {
    tokenCoverage: tokenMatches / tokens.length,
    numericCoverage: numericTokens.length > 0 ? numericMatches / numericTokens.length : 1,
  }
}

function scoreAddressMatch(tokens: string[], numericTokens: string[], displayName: string) {
  const { tokenCoverage, numericCoverage } = getAddressCoverage(tokens, numericTokens, displayName)
  if (tokens.length === 0) return 0
  return tokenCoverage * 0.62 + numericCoverage * 0.38
}

async function searchNominatim(query: string, options?: { countryCodes?: string; limit?: number }) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    dedupe: "1",
    limit: String(options?.limit ?? 8),
    q: query,
    "accept-language": "en",
  })

  if (options?.countryCodes) {
    params.set("countrycodes", options.countryCodes)
  }

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 9000)
  let response: Response
  try {
    response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return (await response.json()) as NominatimSearchRow[]
}

async function searchPhoton(query: string, options?: { limit?: number }) {
  const params = new URLSearchParams({
    q: query,
    limit: String(options?.limit ?? 8),
    lang: "en",
  })

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 9000)
  let response: Response
  try {
    response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return (await response.json()) as PhotonSearchResponse
}

async function reverseCountryFromCoordinates(lat: number, lng: number) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
  })

  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 9000)
  let response: Response
  try {
    response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return (await response.json()) as ReverseNominatimResponse
}

export default function RestaurantsPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { t } = useI18n()
  const { isSuperAdmin } = useRole()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Restaurant[]>([])
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [assignments, setAssignments] = useState<Record<string, RestaurantEmployee[]>>({})

  const [name, setName] = useState("")
  const [addressQuery, setAddressQuery] = useState("")
  const [lat, setLat] = useState("")
  const [lng, setLng] = useState("")
  const [radius, setRadius] = useState("100")
  const [searchingAddress, setSearchingAddress] = useState(false)
  const [searchingSuggestions, setSearchingSuggestions] = useState(false)
  const [usingCurrentLocation, setUsingCurrentLocation] = useState(false)
  const [resolvingCountryByLocation, setResolvingCountryByLocation] = useState(false)
  const [attemptedAutoCountryDetection, setAttemptedAutoCountryDetection] = useState(false)
  const [addressResults, setAddressResults] = useState<GeocodingCandidate[]>([])
  const [selectedAddressLabel, setSelectedAddressLabel] = useState("")
  const [locationConfirmed, setLocationConfirmed] = useState(false)
  const [countryPreference, setCountryPreference] = useState<CountryPreference>("auto")
  const [detectedCountryCode, setDetectedCountryCode] = useState("")

  const [assignRestaurant, setAssignRestaurant] = useState("")
  const [assignUser, setAssignUser] = useState("")
  const [assignRoleFilter, setAssignRoleFilter] = useState<AssignmentRoleFilter>("employee")

  const latNumber = parseNullableNumber(lat)
  const lngNumber = parseNullableNumber(lng)

  const mergeCandidate = useCallback(
    (candidatesById: Map<string, GeocodingCandidate>, candidate: GeocodingCandidate) => {
      const current = candidatesById.get(candidate.id)
      if (!current || candidate.matchScore > current.matchScore) {
        candidatesById.set(candidate.id, candidate)
      }
    },
    []
  )

  const resolveCountryCodesForQuery = useCallback(
    (query: string) => {
      if (countryPreference === "global") return [] as string[]
      if (countryPreference === "co" || countryPreference === "us") return [countryPreference]

      const inferred = inferCountryCodes(query)
      if (inferred.length > 0) return inferred
      if (detectedCountryCode) return [detectedCountryCode]
      return [] as string[]
    },
    [countryPreference, detectedCountryCode]
  )

  const detectCountryByBrowserLocation = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!navigator.geolocation) {
      if (!silent) {
        showToast("error", t("Tu navegador no soporta geolocalizacion.", "Your browser does not support geolocation."))
      }
      return
    }

    setResolvingCountryByLocation(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        })
      })

      const response = await reverseCountryFromCoordinates(position.coords.latitude, position.coords.longitude)
      const code = normalizeCountryCode(response.address?.country_code)
      if (!code) {
        if (!silent) {
          showToast("info", t("No se pudo detectar el pais desde tu ubicacion.", "Could not detect country from your location."))
        }
        return
      }

      setDetectedCountryCode(code)
      setCountryPreference("auto")
      if (!silent) {
        showToast(
          "success",
          t(
            `Pais detectado: ${getCountryNameFromCode(code)}. Se priorizaran resultados locales.`,
            `Detected country: ${getCountryNameFromCode(code)}. Local results will be prioritized.`
          )
        )
      }
    } catch {
      if (!silent) {
        showToast(
          "error",
          t(
            "No pudimos detectar el pais con tu ubicacion. Puedes elegirlo manualmente.",
            "We could not detect your country from location. You can choose it manually."
          )
        )
      }
    } finally {
      setResolvingCountryByLocation(false)
    }
  }, [showToast, t])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [restaurantRows, profileRows] = await Promise.all([
        listRestaurants({
          includeInactive: isSuperAdmin,
          ...(isSuperAdmin ? { useAdminApi: true } : {}),
        }),
        listUserProfiles(isSuperAdmin ? { useAdminApi: true } : undefined),
      ])
      setRows(restaurantRows)
      setProfiles(profileRows)

      const activeRestaurants = restaurantRows.filter(item => item.is_active !== false)
      const assignable = profileRows.filter(
        item =>
          item.is_active !== false &&
          (assignRoleFilter === "employee" ? item.role === ROLES.EMPLEADO : item.role === ROLES.SUPERVISORA)
      )

      setAssignRestaurant(prev => prev || activeRestaurants[0]?.id || restaurantRows[0]?.id || "")
      setAssignUser(prev => prev || assignable[0]?.id || "")

      const assignmentEntries = await Promise.all(
        restaurantRows.slice(0, 8).map(async item => [
          item.id,
          await listRestaurantEmployees(item.id, assignRoleFilter),
        ] as const)
      )

      const assignmentMap: Record<string, RestaurantEmployee[]> = assignmentEntries.reduce(
        (acc, [restaurantId, employees]) => {
          acc[restaurantId] = employees.filter((employee): employee is RestaurantEmployee => employee !== null)
          return acc
        },
        {} as Record<string, RestaurantEmployee[]>
      )

      setAssignments(assignmentMap)
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar los restaurantes.", "Could not load restaurants."))
    } finally {
      setLoading(false)
    }
  }, [assignRoleFilter, isSuperAdmin, showToast, t])

  useEffect(() => {
    const assignable = profiles.filter(
      item =>
        item.is_active !== false &&
        (assignRoleFilter === "employee" ? item.role === ROLES.EMPLEADO : item.role === ROLES.SUPERVISORA)
    )
    setAssignUser(assignable[0]?.id ?? "")
  }, [assignRoleFilter, profiles])

  useEffect(() => {
    if (!isSuperAdmin && assignRoleFilter !== "employee") {
      setAssignRoleFilter("employee")
    }
  }, [assignRoleFilter, isSuperAdmin])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [authLoading, isAuthenticated, session?.access_token, loadData])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    if (attemptedAutoCountryDetection) return

    setAttemptedAutoCountryDetection(true)
    void detectCountryByBrowserLocation({ silent: true })
  }, [
    attemptedAutoCountryDetection,
    authLoading,
    detectCountryByBrowserLocation,
    isAuthenticated,
    session?.access_token,
  ])

  useEffect(() => {
    const query = normalizeAddressInput(addressQuery)
    if (query.length < 4) {
      setSearchingSuggestions(false)
      if (!selectedAddressLabel) {
        setAddressResults([])
      }
      return
    }

    let cancelled = false
    const timeoutId = globalThis.setTimeout(() => {
      void (async () => {
        setSearchingSuggestions(true)
        try {
          const tokens = tokenizeAddressQuery(query)
          const numericTokens = tokens.filter(token => /^\d+$/.test(token))
          const candidatesById = new Map<string, GeocodingCandidate>()
          const countryCodes = resolveCountryCodesForQuery(query)
          const preferredCountry = countryCodes[0] ?? ""
          const nominatimRows = await searchNominatim(query, {
            countryCodes: countryCodes.length > 0 ? countryCodes.join(",") : undefined,
            limit: 8,
          })

          for (const row of nominatimRows) {
            const candidateLat = Number(row.lat)
            const candidateLng = Number(row.lon)
            if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLng)) continue

            const displayName = row.display_name ?? `${candidateLat}, ${candidateLng}`
            const importance = typeof row.importance === "number" && Number.isFinite(row.importance) ? row.importance : 0
            const rowCountry = inferCountryFromLabel(displayName)
            const countryBoost = preferredCountry && rowCountry === preferredCountry ? 0.35 : 0
            const coverage = getAddressCoverage(tokens, numericTokens, displayName)
            const matchScore = scoreAddressMatch(tokens, numericTokens, displayName) + importance * 0.35 + countryBoost
            const id = String(row.place_id ?? `n_${candidateLat}_${candidateLng}`)

            mergeCandidate(candidatesById, {
              id,
              displayName,
              lat: candidateLat,
              lng: candidateLng,
              importance,
              matchScore,
              countryCode: rowCountry || undefined,
              tokenCoverage: coverage.tokenCoverage,
              numericCoverage: coverage.numericCoverage,
            })
          }

          try {
            const photon = await searchPhoton(query, { limit: 8 })
            for (const feature of photon.features ?? []) {
              const coords = feature.geometry?.coordinates
              if (!coords || coords.length < 2) continue
              const lngValue = Number(coords[0])
              const latValue = Number(coords[1])
              if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) continue

              const props = feature.properties
              const displayName = [
                props?.name,
                [props?.street, props?.housenumber].filter(Boolean).join(" "),
                props?.city,
                props?.state,
                props?.country,
                props?.postcode,
              ]
                .map(item => item?.trim())
                .filter(Boolean)
                .join(", ")

              const fallbackLabel = `${latValue.toFixed(6)}, ${lngValue.toFixed(6)}`
              const label = displayName || fallbackLabel
              const photonCountry = normalizeCountryCode(props?.country ? inferCountryFromLabel(props.country) : "")
              if (preferredCountry && photonCountry && photonCountry !== preferredCountry) {
                continue
              }
              const countryBoost = preferredCountry && photonCountry === preferredCountry ? 0.35 : 0
              const coverage = getAddressCoverage(tokens, numericTokens, label)
              const matchScore = scoreAddressMatch(tokens, numericTokens, label) + 0.2 + countryBoost
              const id = String(props?.osm_id ?? `p_${latValue}_${lngValue}`)

              mergeCandidate(candidatesById, {
                id,
                displayName: label,
                lat: latValue,
                lng: lngValue,
                importance: 0,
                matchScore,
                countryCode: photonCountry || undefined,
                tokenCoverage: coverage.tokenCoverage,
                numericCoverage: coverage.numericCoverage,
              })
            }
          } catch {
            // Photon is best-effort; Nominatim remains the primary source.
          }

          if (cancelled) return
          const ranked = Array.from(candidatesById.values())
            .sort((a, b) => {
              if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
              return b.importance - a.importance
            })
          const needsStrictNumeric = numericTokens.length >= 2
          const strictNumeric = needsStrictNumeric
            ? ranked.filter(item => item.numericCoverage >= 0.67 && item.tokenCoverage >= 0.45)
            : ranked
          const parsed = (strictNumeric.length > 0 ? strictNumeric : ranked).slice(0, 8)
          setAddressResults(parsed)
        } catch {
          if (!cancelled) {
            setAddressResults([])
          }
        } finally {
          if (!cancelled) {
            setSearchingSuggestions(false)
          }
        }
      })()
    }, 420)

    return () => {
      cancelled = true
      globalThis.clearTimeout(timeoutId)
    }
  }, [addressQuery, mergeCandidate, resolveCountryCodesForQuery, selectedAddressLabel])

  const handleSearchAddress = async () => {
    const query = addressQuery.trim()
    if (!query) {
      showToast("info", t("Ingresa una direccion para buscar.", "Enter an address to search."))
      return
    }

    setSearchingAddress(true)
    try {
      const normalizedQuery = normalizeAddressInput(query)
      const countryCodes = resolveCountryCodesForQuery(normalizedQuery)
      const queryVariants = buildAddressSearchQueries(normalizedQuery, countryCodes[0])
      const queryTokens = tokenizeAddressQuery(normalizedQuery)
      const numericTokens = queryTokens.filter(token => /^\d+$/.test(token))
      const candidatesById = new Map<string, GeocodingCandidate>()
      const failures: string[] = []
      const preferredCountry = countryCodes[0] ?? ""
      const collectCandidates = async (rows: NominatimSearchRow[]) => {
        for (const row of rows) {
          const candidateLat = Number(row.lat)
          const candidateLng = Number(row.lon)
          if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLng)) continue

          const displayName = row.display_name ?? `${candidateLat}, ${candidateLng}`
          const importance = typeof row.importance === "number" && Number.isFinite(row.importance) ? row.importance : 0
          const rowCountry = inferCountryFromLabel(displayName)
          const countryBoost = preferredCountry && rowCountry === preferredCountry ? 0.35 : 0
          const coverage = getAddressCoverage(queryTokens, numericTokens, displayName)
          const matchScore = scoreAddressMatch(queryTokens, numericTokens, displayName) + importance * 0.35 + countryBoost
          const id = String(row.place_id ?? `${candidateLat}_${candidateLng}`)

          const nextCandidate: GeocodingCandidate = {
            id,
            displayName,
            lat: candidateLat,
            lng: candidateLng,
            importance,
            matchScore,
            countryCode: rowCountry || undefined,
            tokenCoverage: coverage.tokenCoverage,
            numericCoverage: coverage.numericCoverage,
          }

          const current = candidatesById.get(id)
          if (!current || nextCandidate.matchScore > current.matchScore) {
            candidatesById.set(id, nextCandidate)
          }
        }
      }

      // Primary pass: prioritize inferred country when detected.
      if (countryCodes.length > 0) {
        for (const variant of queryVariants) {
          try {
            const rows = await searchNominatim(variant, { countryCodes: countryCodes.join(","), limit: 10 })
            await collectCandidates(rows)
          } catch (error: unknown) {
            failures.push(error instanceof Error ? `${variant}: ${error.message}` : `${variant}: unknown error`)
          }
        }
      }

      // Fallback pass: global search only when country filter is global/auto without detected country.
      if (candidatesById.size < 6 && countryCodes.length === 0) {
        for (const variant of queryVariants) {
          try {
            const rows = await searchNominatim(variant, { limit: 6 })
            await collectCandidates(rows)
          } catch (error: unknown) {
            failures.push(error instanceof Error ? `${variant}: ${error.message}` : `${variant}: unknown error`)
          }
        }
      }

      const ranked = Array.from(candidatesById.values())
        .sort((a, b) => {
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
          return b.importance - a.importance
        })
      const needsStrictNumeric = numericTokens.length >= 2
      const strictNumeric = needsStrictNumeric
        ? ranked.filter(item => item.numericCoverage >= 0.67 && item.tokenCoverage >= 0.45)
        : ranked
      const parsed = (strictNumeric.length > 0 ? strictNumeric : ranked).slice(0, 10)

      setAddressResults(parsed)
      if (parsed.length === 0) {
        showToast("info", t("No se encontraron resultados para esa direccion.", "No results found for that address."))
      } else {
        showToast(
          "success",
          t(
            "Direccion encontrada. Selecciona la opcion mas precisa del listado.",
            "Address found. Select the most precise option from the list."
          )
        )
      }

      if (parsed.length > 0 && failures.length > 0) {
        console.warn("geocoding_partial_failures", failures)
      }
    } catch (error: unknown) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("No se pudo buscar la direccion.", "Could not search address.")
      )
    } finally {
      setSearchingAddress(false)
    }
  }

  const handlePickAddress = (candidate: GeocodingCandidate) => {
    setLat(candidate.lat.toFixed(6))
    setLng(candidate.lng.toFixed(6))
    setSelectedAddressLabel(candidate.displayName)
    setLocationConfirmed(false)
    if (countryPreference === "auto" && candidate.countryCode) {
      setDetectedCountryCode(candidate.countryCode)
    }
    if (!name.trim()) {
      const inferredName = candidate.displayName.split(",")[0]?.trim() ?? ""
      setName(inferredName)
    }
    showToast(
      "success",
      t("Ubicacion seleccionada. Revisa el mapa y confirma que sea correcta.", "Location selected. Review the map and confirm it is correct.")
    )
  }

  const handleConfirmLocation = () => {
    const parsedLat = parseNullableNumber(lat)
    const parsedLng = parseNullableNumber(lng)
    if (parsedLat === null || parsedLng === null) {
      showToast("info", t("Primero selecciona una direccion del listado.", "Select an address from the list first."))
      return
    }
    setLocationConfirmed(true)
    showToast("success", t("Ubicacion confirmada para guardar.", "Location confirmed for saving."))
  }

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      showToast("error", t("Tu navegador no soporta geolocalizacion.", "Your browser does not support geolocation."))
      return
    }

    setUsingCurrentLocation(true)
    navigator.geolocation.getCurrentPosition(
      async position => {
        setLat(position.coords.latitude.toFixed(6))
        setLng(position.coords.longitude.toFixed(6))
        setSelectedAddressLabel(t("Ubicacion actual", "Current location"))
        setLocationConfirmed(false)

        try {
          const countryResponse = await reverseCountryFromCoordinates(position.coords.latitude, position.coords.longitude)
          const countryCode = normalizeCountryCode(countryResponse.address?.country_code)
          if (countryCode) {
            setDetectedCountryCode(countryCode)
          }
        } catch {
          // Best effort: location pin still works even if reverse country lookup fails.
        }

        setUsingCurrentLocation(false)
        showToast("success", t("Ubicacion actual cargada. Revisa el mapa y confirma.", "Current location loaded. Review the map and confirm."))
      },
      () => {
        setUsingCurrentLocation(false)
        showToast("error", t("No se pudo obtener tu ubicacion actual.", "Could not get your current location."))
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }

  const handleCreate = async () => {
    if (!isSuperAdmin) {
      showToast("info", t("Solo super admin puede crear restaurantes.", "Only super admin can create restaurants."))
      return
    }
    const parsedLat = parseNullableNumber(lat)
    const parsedLng = parseNullableNumber(lng)
    const parsedRadius = parseNullableNumber(radius)

    if (!name.trim() || parsedRadius === null) {
      showToast("info", t("Completa nombre y radio.", "Complete name and radius."))
      return
    }
    if (parsedLat === null || parsedLng === null) {
      showToast(
        "info",
        t(
          "Busca y selecciona una direccion en el mapa antes de guardar.",
          "Search and select an address on the map before saving."
        )
      )
      return
    }

    if (!locationConfirmed) {
      showToast(
        "info",
        t(
          "Confirma en el mapa que la direccion sea correcta antes de guardar.",
          "Confirm on the map that the address is correct before saving."
        )
      )
      return
    }

    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      showToast("info", t("Latitud/longitud fuera de rango valido.", "Latitude/longitude out of valid range."))
      return
    }

    if (parsedRadius <= 0) {
      showToast("info", t("El radio debe ser mayor a 0.", "Radius must be greater than 0."))
      return
    }

    try {
      const normalizedAddress = normalizeAddressInput(selectedAddressLabel || addressQuery)
      const countryHints = inferCountryCodes(normalizedAddress)
      const resolvedCountryCode =
        countryPreference === "co" || countryPreference === "us"
          ? countryPreference
          : countryHints[0] || detectedCountryCode || ""
      const created = await createRestaurant({
        name: name.trim(),
        lat: parsedLat,
        lng: parsedLng,
        geofence_radius_m: parsedRadius,
        address_line: normalizedAddress || null,
        country: resolvedCountryCode === "co" ? "Colombia" : resolvedCountryCode === "us" ? "United States" : null,
      })
      setRows(prev => [created, ...prev])
      setName("")
      setAddressQuery("")
      setAddressResults([])
      setSelectedAddressLabel("")
      setLocationConfirmed(false)
      setLat("")
      setLng("")
      showToast("success", t("Restaurante creado.", "Restaurant created."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo crear el restaurante.", "Could not create restaurant."))
    }
  }

  const handleRadiusUpdate = async (restaurant: Restaurant, newRadius: string) => {
    if (!isSuperAdmin) {
      showToast("info", t("Solo super admin puede editar restaurantes.", "Only super admin can edit restaurants."))
      return
    }
    const parsed = parseNullableNumber(newRadius)
    try {
      const updated = await updateRestaurant(restaurant.id, { geofence_radius_m: parsed })
      setRows(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      showToast("success", t("Geocerca actualizada.", "Geofence updated."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo actualizar la geocerca.", "Could not update geofence."))
    }
  }

  const handleAssign = async () => {
    if (!assignRestaurant || !assignUser) {
      showToast("info", t("Selecciona restaurante y empleado.", "Select restaurant and employee."))
      return
    }

    try {
      const created = await assignEmployeeToRestaurant(assignRestaurant, assignUser, assignRoleFilter)
      setAssignments(prev => ({
        ...prev,
        [assignRestaurant]: [created, ...(prev[assignRestaurant] ?? [])],
      }))
      showToast(
        "success",
        assignRoleFilter === "supervisor"
          ? t("Supervisora asignada al restaurante.", "Supervisor assigned to restaurant.")
          : t("Empleado asignado al restaurante.", "Employee assigned to restaurant.")
      )
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo asignar el empleado.", "Could not assign employee."))
    }
  }

  const handleUnassign = async (restaurantId: string, userId: string) => {
    try {
      await unassignEmployeeFromRestaurant(restaurantId, userId, assignRoleFilter)
      setAssignments(prev => ({
        ...prev,
        [restaurantId]: (prev[restaurantId] ?? []).filter(item => item.user_id !== userId),
      }))
      showToast(
        "success",
        assignRoleFilter === "supervisor"
          ? t("Supervisora desasignada.", "Supervisor unassigned.")
          : t("Empleado desasignado.", "Employee unassigned.")
      )
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo desasignar.", "Could not unassign."))
    }
  }

  const handleToggleRestaurantActive = async (restaurant: Restaurant) => {
    if (!isSuperAdmin) {
      showToast("info", t("Solo super admin puede activar o desactivar restaurantes.", "Only super admin can activate/deactivate restaurants."))
      return
    }
    const current = restaurant.is_active !== false
    try {
      const updated = await updateRestaurantStatus(restaurant.id, !current)
      setRows(prev => prev.map(item => (item.id === updated.id ? updated : item)))
      showToast(
        "success",
        current
          ? t("Restaurante desactivado.", "Restaurant deactivated.")
          : t("Restaurante activado.", "Restaurant activated.")
      )
    } catch (error: unknown) {
      showToast(
        "error",
        error instanceof Error
          ? error.message
          : t("No se pudo actualizar el estado del restaurante.", "Could not update restaurant status.")
      )
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN, ROLES.SUPERVISORA]}>
        <div className="space-y-5">
          <div className="page-title">{t("Gestión de Restaurantes", "Restaurant management")}</div>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              {isSuperAdmin && (
                <Card title={t("Crear restaurante", "Create restaurant")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  <input
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Nombre", "Name")}
                    value={name}
                    onChange={event => setName(event.target.value)}
                  />
                  <input
                    className="sm:col-span-2 xl:col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Direccion del restaurante", "Restaurant address")}
                    value={addressQuery}
                    onChange={event => {
                      setAddressQuery(event.target.value)
                      setLat("")
                      setLng("")
                      setSelectedAddressLabel("")
                      setLocationConfirmed(false)
                      setAddressResults([])
                    }}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void handleSearchAddress()}
                    disabled={searchingAddress}
                  >
                    {searchingAddress ? t("Buscando...", "Searching...") : t("Buscar direccion", "Search address")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void handleUseCurrentLocation()}
                    disabled={usingCurrentLocation}
                  >
                    {usingCurrentLocation ? t("Obteniendo...", "Getting...") : t("Usar mi ubicacion", "Use my location")}
                  </Button>
                  <input
                    className="sm:col-span-2 xl:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={t("Radio (m)", "Radius (m)")}
                    value={radius}
                    onChange={event => setRadius(event.target.value)}
                  />
                  <Button onClick={handleCreate} className="sm:col-span-2 xl:col-span-1">
                    {t("Guardar", "Save")}
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={countryPreference}
                    onChange={event => setCountryPreference(event.target.value as CountryPreference)}
                  >
                    <option value="auto">{t("Pais: Auto", "Country: Auto")}</option>
                    <option value="co">{t("Pais: Colombia", "Country: Colombia")}</option>
                    <option value="us">{t("Pais: USA", "Country: USA")}</option>
                    <option value="global">{t("Pais: Global", "Country: Global")}</option>
                  </select>

                  {countryPreference === "auto" && resolvingCountryByLocation && (
                    <span className="text-xs text-slate-600">{t("Detectando pais automaticamente...", "Detecting country automatically...")}</span>
                  )}

                  {countryPreference === "auto" && detectedCountryCode && (
                    <span className="text-xs text-slate-600">
                      {t("Auto activo", "Auto active")}: {getCountryNameFromCode(detectedCountryCode)}
                    </span>
                  )}
                </div>

                {searchingSuggestions && !searchingAddress && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {t("Buscando sugerencias de direccion...", "Searching address suggestions...")}
                  </div>
                )}

                {addressResults.length > 0 && (
                  <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {t("Sugerencias de direccion", "Address suggestions")}
                    </p>
                    <div className="max-h-48 space-y-2 overflow-auto">
                      {addressResults.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-slate-400"
                          onClick={() => handlePickAddress(item)}
                        >
                          <p className="font-medium">{item.displayName}</p>
                          <p className="text-xs text-slate-500">
                            Lat: {item.lat.toFixed(6)} | Lng: {item.lng.toFixed(6)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {latNumber !== null && lngNumber !== null && (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p>
                        {t("Ubicacion seleccionada", "Selected location")}:{" "}
                        <span className="font-medium text-slate-800">{selectedAddressLabel || t("Pin de mapa", "Map pin")}</span>
                      </p>
                      <p>Lat: {latNumber.toFixed(6)} | Lng: {lngNumber.toFixed(6)}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant={locationConfirmed ? "secondary" : "primary"} onClick={handleConfirmLocation}>
                        {locationConfirmed
                          ? t("Ubicacion confirmada", "Location confirmed")
                          : t("Confirmar que es aqui", "Confirm this is the place")}
                      </Button>
                      {!locationConfirmed && (
                        <span className="text-xs text-amber-700">
                          {t("Debes confirmar antes de guardar.", "You must confirm before saving.")}
                        </span>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <iframe
                        title={t("Vista de mapa", "Map preview")}
                        src={buildMapPreviewUrl(latNumber, lngNumber)}
                        className="h-64 w-full"
                        loading="lazy"
                      />
                    </div>
                  </div>
                )}

                {latNumber === null || lngNumber === null ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {t(
                      "Todavia no hay ubicacion seleccionada. Busca una direccion y elige un resultado.",
                      "No location selected yet. Search an address and choose a result."
                    )}
                  </div>
                ) : null}
              </Card>
              )}

              <Card title={t("Asignaciones", "Assignments")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={assignRoleFilter}
                    onChange={event => setAssignRoleFilter(event.target.value as AssignmentRoleFilter)}
                    disabled={!isSuperAdmin}
                  >
                    <option value="employee">{t("Empleado", "Employee")}</option>
                    {isSuperAdmin && <option value="supervisor">{t("Supervisora", "Supervisor")}</option>}
                  </select>
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={assignRestaurant}
                    onChange={event => setAssignRestaurant(event.target.value)}
                  >
                    {rows.filter(item => item.is_active !== false).map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={assignUser}
                    onChange={event => setAssignUser(event.target.value)}
                  >
                    {profiles
                      .filter(item => {
                        if (item.is_active === false) return false
                        return assignRoleFilter === "employee"
                          ? item.role === ROLES.EMPLEADO
                          : item.role === ROLES.SUPERVISORA
                      })
                      .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.full_name ?? item.email ?? item.id}
                      </option>
                      ))}
                  </select>
                  <Button variant="secondary" onClick={handleAssign} className="sm:col-span-2 lg:col-span-1">
                    {t("Asignar", "Assign")}
                  </Button>
                </div>

                {(assignments[assignRestaurant] ?? []).length > 0 && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-700">
                      {assignRoleFilter === "supervisor"
                        ? t("Supervisoras asignadas", "Assigned supervisors")
                        : t("Empleados asignados", "Assigned employees")}
                    </p>
                    <div className="mt-2 space-y-2">
                      {(assignments[assignRestaurant] ?? []).map(item => {
                        const profile = profiles.find(profileItem => profileItem.id === item.user_id)
                        return (
                          <div key={`${item.restaurant_id}-${item.user_id}`} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                            <span>{profile?.full_name ?? profile?.email ?? item.user_id}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleUnassign(assignRestaurant, item.user_id)}
                            >
                              {t("Desasignar", "Unassign")}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </Card>

              <Card title={t("Restaurantes", "Restaurants")}>
                {rows.length === 0 ? (
                  <EmptyState
                    title={t("Sin restaurantes", "No restaurants")}
                    description={t("Crea el primer restaurante para iniciar operacion.", "Create the first restaurant to start operations.")}
                    actionLabel={t("Recargar", "Reload")}
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    {rows.map(item => {
                      const addressLabel = buildRestaurantAddressLabel(item)
                      const lat = typeof item.lat === "number" ? item.lat : null
                      const lng = typeof item.lng === "number" ? item.lng : null
                      const hasMap = typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)
                      const assignedCount = (assignments[item.id] ?? []).length
                      return (
                        <div key={item.id} className="restaurant-card rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-slate-900">{item.name}</p>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                    item.is_active === false
                                      ? "border-amber-200 bg-amber-50 text-amber-700"
                                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  }`}
                                >
                                  {item.is_active === false ? t("Inactivo", "Inactive") : t("Activo", "Active")}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-slate-600">
                                {addressLabel || t("Direccion pendiente por definir.", "Address pending definition.")}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                <span>
                                  {t("Radio", "Radius")}: {item.geofence_radius_m ?? "-"} m
                                </span>
                                <span>
                                  {t("Asignados", "Assigned")}: {assignedCount}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                                <span className="text-xs text-slate-500">{t("Radio", "Radius")}</span>
                                <input
                                  defaultValue={String(item.geofence_radius_m ?? 100)}
                                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                                  onBlur={isSuperAdmin ? event => void handleRadiusUpdate(item, event.target.value) : undefined}
                                  disabled={!isSuperAdmin}
                                />
                                <span className="text-xs text-slate-500">m</span>
                              </div>
                              <Button
                                size="sm"
                                variant={item.is_active === false ? "secondary" : "ghost"}
                                onClick={() => void handleToggleRestaurantActive(item)}
                                disabled={!isSuperAdmin}
                              >
                                {item.is_active === false ? t("Activar", "Enable") : t("Desactivar", "Disable")}
                              </Button>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                {t("Resumen", "Summary")}
                              </p>
                              <div className="mt-2 grid gap-2 text-sm">
                                <div>
                                  <span className="text-xs text-slate-500">{t("Direccion", "Address")}: </span>
                                  <span className="font-medium text-slate-700">
                                    {addressLabel || t("Pendiente", "Pending")}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-slate-500">{t("Radio", "Radius")}: </span>
                                  <span className="font-medium text-slate-700">
                                    {item.geofence_radius_m ?? "-"} m
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-slate-500">{t("Asignados", "Assigned")}: </span>
                                  <span className="font-medium text-slate-700">{assignedCount}</span>
                                </div>
                              </div>
                            </div>

                            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                              {hasMap ? (
                                <iframe
                                  title={t("Mapa del restaurante", "Restaurant map")}
                                  src={buildMapPreviewUrl(lat as number, lng as number)}
                                  className="h-40 w-full"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-40 items-center justify-center text-xs text-slate-500">
                                  {t("Mapa pendiente", "Map pending")}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                </Card>
            </>
          )}
        </div>
      </RoleGuard>
    </ProtectedRoute>
  )
}

