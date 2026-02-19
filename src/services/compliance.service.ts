import { supabase } from "@/services/supabaseClient"

export interface LegalTermsVersion {
  id: number
  code: string
  title: string
  content: string
  version: string
}

type ShiftHealthPhase = "start" | "end"

interface SaveShiftHealthFormPayload {
  shiftId: number
  phase: ShiftHealthPhase
  fitForWork: boolean
  declaration?: string | null
}

function isUniqueViolation(error: unknown) {
  if (typeof error !== "object" || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === "23505"
}

export async function getActiveLegalTermsVersion() {
  const { data, error } = await supabase
    .from("legal_terms_versions")
    .select("id,code,title,content,version")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as LegalTermsVersion | null
}

export async function recordCurrentUserLegalAcceptance(legalTermsId: number, userAgent?: string | null) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user?.id) throw new Error("Authenticated user not found.")

  const { error } = await supabase.from("user_legal_acceptances").upsert(
    {
      user_id: user.id,
      legal_terms_id: legalTermsId,
      accepted_at: new Date().toISOString(),
      user_agent: userAgent ?? null,
    },
    { onConflict: "user_id,legal_terms_id" }
  )

  if (error) throw error
}

export async function saveShiftHealthForm(payload: SaveShiftHealthFormPayload) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user?.id) throw new Error("Authenticated user not found.")

  const { error } = await supabase.from("shift_health_forms").insert({
    shift_id: payload.shiftId,
    phase: payload.phase,
    fit_for_work: payload.fitForWork,
    declaration: payload.declaration ?? null,
    recorded_by: user.id,
  })

  if (error && !isUniqueViolation(error)) throw error
}
