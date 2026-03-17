export type ShiftAreaSubarea = {
  key: string
  es: string
  en: string
}

export type ShiftAreaDefinition = {
  key: string
  es: string
  en: string
  subareas: ShiftAreaSubarea[]
}

export const SHIFT_AREA_DEFINITIONS: ShiftAreaDefinition[] = [
  {
    key: "cocina",
    es: "Cocina",
    en: "Kitchen",
    subareas: [
      { key: "campana", es: "Campana", en: "Hood" },
      { key: "pisos", es: "Pisos", en: "Floors" },
      { key: "esquinas", es: "Esquinas", en: "Corners" },
      { key: "detras_freidoras", es: "Detras de freidoras", en: "Behind fryers" },
      { key: "debajo_mesas", es: "Debajo de mesas", en: "Under tables" },
      { key: "frente_neveras", es: "Frente de neveras", en: "In front of fridges" },
    ],
  },
  {
    key: "comedor",
    es: "Comedor",
    en: "Dining area",
    subareas: [
      { key: "general", es: "General", en: "General" },
      { key: "pisos", es: "Pisos", en: "Floors" },
      { key: "esquinas", es: "Esquinas", en: "Corners" },
      { key: "debajo_mesas_asientos", es: "Debajo de mesas y asientos", en: "Under tables and seats" },
      { key: "marcos_ventanas", es: "Marcos de ventanas", en: "Window frames" },
    ],
  },
  {
    key: "dispensadores",
    es: "Dispensadores de gaseosas",
    en: "Soda dispensers",
    subareas: [
      { key: "frente", es: "Frente", en: "Front" },
      { key: "atras", es: "Atras", en: "Back" },
      { key: "gabinetes", es: "Gabinetes", en: "Cabinets" },
    ],
  },
  {
    key: "desagues",
    es: "Desagues",
    en: "Drains",
    subareas: [{ key: "general", es: "General", en: "General" }],
  },
  {
    key: "fachadas",
    es: "Fachadas - patios",
    en: "Facade / patios",
    subareas: [
      { key: "pisos", es: "Pisos", en: "Floors" },
      { key: "esquinas", es: "Esquinas", en: "Corners" },
      { key: "debajo_mesas_asientos", es: "Debajo de mesas y asientos", en: "Under tables and seats" },
      { key: "marcos_ventanas", es: "Marcos de las ventanas", en: "Window frames" },
    ],
  },
  {
    key: "banos",
    es: "Banos",
    en: "Restrooms",
    subareas: [
      { key: "pisos", es: "Pisos", en: "Floors" },
      { key: "sanitarios_adelante", es: "Sanitarios adelante", en: "Toilets front" },
      { key: "sanitarios_atras", es: "Sanitarios atras", en: "Toilets back" },
      { key: "lavamanos", es: "Lavamanos", en: "Sinks" },
      { key: "cambiador_ninos", es: "Cambiador de ninos", en: "Baby changing station" },
      { key: "puertas_marcos", es: "Puertas y marcos", en: "Doors and frames" },
    ],
  },
  {
    key: "otro",
    es: "Otro",
    en: "Other",
    subareas: [],
  },
]

export const buildShiftAreaCatalog = (t: (es: string, en: string) => string) =>
  SHIFT_AREA_DEFINITIONS.map(area => ({
    value: area.key,
    label: t(area.es, area.en),
    subareas: area.subareas.map(sub => ({ value: sub.key, label: t(sub.es, sub.en) })),
  }))
