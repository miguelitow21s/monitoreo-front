"use client"

import { useCallback, useEffect, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/hooks/useI18n"
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
  updateRestaurant,
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

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function parseNullableNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
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

function buildAddressSearchQueries(rawQuery: string) {
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
  if (!includesUsContext) variants.add(`${normalized}, USA`)
  if (!includesCoContext) variants.add(`${normalized}, Colombia`)
  if (expanded !== normalized) {
    if (!includesUsContext) variants.add(`${expanded}, USA`)
    if (!includesCoContext) variants.add(`${expanded}, Colombia`)
  }

  const unitStripped = normalized
    .replace(/\b(apt|apartment|suite|ste|unit|#)\s*[a-z0-9-]+\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,/g, ", ")
    .trim()

  if (unitStripped.length >= 5 && unitStripped !== normalized) {
    variants.add(unitStripped)
    if (!includesUsContext) variants.add(`${unitStripped}, USA`)
    if (!includesCoContext) variants.add(`${unitStripped}, Colombia`)
  }

  const segments = normalized.split(",").map(item => item.trim()).filter(Boolean)
  if (segments.length >= 3) {
    const withoutNeighborhood = `${segments[0]}, ${segments[segments.length - 2]}, ${segments[segments.length - 1]}`
    variants.add(withoutNeighborhood)
    if (!includesUsContext) variants.add(`${withoutNeighborhood}, USA`)
    if (!includesCoContext) variants.add(`${withoutNeighborhood}, Colombia`)

    for (let index = 1; index < segments.length - 1; index += 1) {
      const reduced = `${segments[0]}, ${segments.slice(index).join(", ")}`
      variants.add(reduced)
      if (!includesUsContext) variants.add(`${reduced}, USA`)
      if (!includesCoContext) variants.add(`${reduced}, Colombia`)
    }
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

function scoreAddressMatch(tokens: string[], displayName: string) {
  if (tokens.length === 0) return 0
  const normalizedDisplay = displayName.toLowerCase()
  const matches = tokens.reduce((count, token) => count + (normalizedDisplay.includes(token) ? 1 : 0), 0)
  return matches / tokens.length
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

export default function RestaurantsPage() {
  const { loading: authLoading, isAuthenticated, session } = useAuth()
  const { t } = useI18n()
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
  const [addressResults, setAddressResults] = useState<GeocodingCandidate[]>([])
  const [selectedAddressLabel, setSelectedAddressLabel] = useState("")
  const [locationConfirmed, setLocationConfirmed] = useState(false)

  const [assignRestaurant, setAssignRestaurant] = useState("")
  const [assignUser, setAssignUser] = useState("")

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

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [restaurantRows, profileRows] = await Promise.all([listRestaurants(), listUserProfiles()])
      setRows(restaurantRows)
      setProfiles(profileRows)

      setAssignRestaurant(prev => prev || restaurantRows[0]?.id || "")
      setAssignUser(prev => prev || profileRows[0]?.id || "")

      const assignmentEntries = await Promise.all(
        restaurantRows.slice(0, 8).map(async item => [item.id, await listRestaurantEmployees(item.id)] as const)
      )
      setAssignments(Object.fromEntries(assignmentEntries))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudieron cargar los restaurantes.", "Could not load restaurants."))
    } finally {
      setLoading(false)
    }
  }, [showToast, t])

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated || !session?.access_token) return
    void loadData()
  }, [authLoading, isAuthenticated, session?.access_token, loadData])

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
          const candidatesById = new Map<string, GeocodingCandidate>()
          const countryCodes = inferCountryCodes(query)
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
            const matchScore = scoreAddressMatch(tokens, displayName) + importance * 0.35
            const id = String(row.place_id ?? `n_${candidateLat}_${candidateLng}`)

            mergeCandidate(candidatesById, {
              id,
              displayName,
              lat: candidateLat,
              lng: candidateLng,
              importance,
              matchScore,
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
              const matchScore = scoreAddressMatch(tokens, label) + 0.2
              const id = String(props?.osm_id ?? `p_${latValue}_${lngValue}`)

              mergeCandidate(candidatesById, {
                id,
                displayName: label,
                lat: latValue,
                lng: lngValue,
                importance: 0,
                matchScore,
              })
            }
          } catch {
            // Photon is best-effort; Nominatim remains the primary source.
          }

          if (cancelled) return
          const parsed = Array.from(candidatesById.values())
            .sort((a, b) => {
              if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
              return b.importance - a.importance
            })
            .slice(0, 8)
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
  }, [addressQuery, mergeCandidate, selectedAddressLabel])

  const handleSearchAddress = async () => {
    const query = addressQuery.trim()
    if (!query) {
      showToast("info", t("Ingresa una direccion para buscar.", "Enter an address to search."))
      return
    }

    setSearchingAddress(true)
    try {
      const normalizedQuery = normalizeAddressInput(query)
      const queryVariants = buildAddressSearchQueries(normalizedQuery)
      const queryTokens = tokenizeAddressQuery(normalizedQuery)
      const candidatesById = new Map<string, GeocodingCandidate>()
      const failures: string[] = []

      const countryCodes = inferCountryCodes(normalizedQuery)
      const collectCandidates = async (rows: NominatimSearchRow[]) => {
        for (const row of rows) {
          const candidateLat = Number(row.lat)
          const candidateLng = Number(row.lon)
          if (!Number.isFinite(candidateLat) || !Number.isFinite(candidateLng)) continue

          const displayName = row.display_name ?? `${candidateLat}, ${candidateLng}`
          const importance = typeof row.importance === "number" && Number.isFinite(row.importance) ? row.importance : 0
          const matchScore = scoreAddressMatch(queryTokens, displayName) + importance * 0.35
          const id = String(row.place_id ?? `${candidateLat}_${candidateLng}`)

          const nextCandidate: GeocodingCandidate = {
            id,
            displayName,
            lat: candidateLat,
            lng: candidateLng,
            importance,
            matchScore,
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

      // Fallback pass: global search if scoped pass is scarce.
      if (candidatesById.size < 6) {
        for (const variant of queryVariants) {
          try {
            const rows = await searchNominatim(variant, { limit: 6 })
            await collectCandidates(rows)
          } catch (error: unknown) {
            failures.push(error instanceof Error ? `${variant}: ${error.message}` : `${variant}: unknown error`)
          }
        }
      }

      const parsed = Array.from(candidatesById.values())
        .sort((a, b) => {
          if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
          return b.importance - a.importance
        })
        .slice(0, 10)

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
      position => {
        setLat(position.coords.latitude.toFixed(6))
        setLng(position.coords.longitude.toFixed(6))
        setSelectedAddressLabel(t("Ubicacion actual", "Current location"))
        setLocationConfirmed(false)
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
      const created = await createRestaurant({
        name: name.trim(),
        lat: parsedLat,
        lng: parsedLng,
        geofence_radius_m: parsedRadius,
        address_line: normalizedAddress || null,
        country: countryHints[0] === "co" ? "Colombia" : countryHints[0] === "us" ? "United States" : null,
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
      const created = await assignEmployeeToRestaurant(assignRestaurant, assignUser)
      setAssignments(prev => ({
        ...prev,
        [assignRestaurant]: [created, ...(prev[assignRestaurant] ?? [])],
      }))
      showToast("success", t("Empleado asignado al restaurante.", "Employee assigned to restaurant."))
    } catch (error: unknown) {
      showToast("error", error instanceof Error ? error.message : t("No se pudo asignar el empleado.", "Could not assign employee."))
    }
  }

  return (
    <ProtectedRoute>
      <RoleGuard allowedRoles={[ROLES.SUPER_ADMIN]}>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">{t("Restaurantes", "Restaurants")}</h1>

          {loading || authLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <>
              <Card title={t("Crear restaurante", "Create restaurant")} subtitle={t("Busca direccion completa (calle, ciudad, estado, ZIP) y confirma en mapa.", "Search full address (street, city, state, ZIP) and confirm on map.")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
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

                <p className="mt-2 text-xs text-slate-500">
                  {t(
                    "Escribe direccion, selecciona una sugerencia, valida el pin en el mapa y confirma.",
                    "Type address, choose a suggestion, validate the pin on the map, and confirm."
                  )}
                </p>

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

              <Card title={t("Asignar empleados", "Assign employees")} subtitle={t("Asocia usuarios operativos con restaurantes.", "Associate operational users with restaurants.")}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={assignRestaurant}
                    onChange={event => setAssignRestaurant(event.target.value)}
                  >
                    {rows.map(item => (
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
                      .filter(item => item.role === ROLES.EMPLEADO && item.is_active !== false)
                      .map(item => (
                      <option key={item.id} value={item.id}>
                        {item.full_name ?? item.email ?? item.id}
                      </option>
                      ))}
                  </select>
                  <Button variant="secondary" onClick={handleAssign}>
                    {t("Asignar", "Assign")}
                  </Button>
                </div>
              </Card>

              <Card title={t("Listado de restaurantes", "Restaurant list")} subtitle={t("Configuracion operativa actual.", "Current operational configuration.")}>
                {rows.length === 0 ? (
                  <EmptyState
                    title={t("Sin restaurantes", "No restaurants")}
                    description={t("Crea el primer restaurante para iniciar operacion.", "Create the first restaurant to start operations.")}
                    actionLabel={t("Recargar", "Reload")}
                    onAction={() => void loadData()}
                  />
                ) : (
                  <div className="space-y-3">
                    {rows.map(item => (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <p className="text-sm text-slate-600">
                              Lat: {item.lat ?? "-"} | Lng: {item.lng ?? "-"} | {t("Radio", "Radius")}:{" "}
                              {item.geofence_radius_m ?? "-"} m
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              defaultValue={String(item.geofence_radius_m ?? 100)}
                              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                              onBlur={event => void handleRadiusUpdate(item, event.target.value)}
                            />
                            <span className="text-xs text-slate-500">m</span>
                          </div>
                        </div>
                        {(assignments[item.id] ?? []).length > 0 && (
                          <p className="mt-2 text-xs text-slate-500">
                            {t("Empleados asignados", "Assigned employees")}: {(assignments[item.id] ?? []).length}
                          </p>
                        )}
                      </div>
                    ))}
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

