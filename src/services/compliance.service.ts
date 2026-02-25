import { invokeEdge } from "@/services/edgeClient"
import { supabase } from "@/services/supabaseClient"

export interface LegalConsentStatus {
  accepted: boolean
  accepted_at: string | null
  active_term: {
    id?: number
    code?: string
    title?: string
    version?: string
  } | null
}

function shouldFallbackToDirectTableAccess(error: unknown) {
  if (typeof error !== "object" || error === null) return false

  const status = (error as { status?: unknown }).status
  if (typeof status === "number" && status >= 400) return false

  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : ""

  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("cors") ||
    message.includes("fetch")
  )
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) throw error
  if (!user?.id) throw new Error("Authenticated user not found.")
  return user.id
}

async function getActiveLegalTermFromTable() {
  const { data, error } = await supabase
    .from("legal_terms_versions")
    .select("id,code,title,version")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}

async function getLegalConsentStatusFallback() {
  const userId = await getCurrentUserId()
  const activeTerm = await getActiveLegalTermFromTable()

  if (!activeTerm) {
    return {
      accepted: false,
      accepted_at: null,
      active_term: null,
    } satisfies LegalConsentStatus
  }

  const { data, error } = await supabase
    .from("user_legal_acceptances")
    .select("accepted_at")
    .eq("user_id", userId)
    .eq("legal_terms_id", activeTerm.id)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return {
    accepted: !!data?.accepted_at,
    accepted_at: data?.accepted_at ?? null,
    active_term: {
      id: activeTerm.id,
      code: activeTerm.code,
      title: activeTerm.title,
      version: activeTerm.version,
    },
  } satisfies LegalConsentStatus
}

async function acceptLegalConsentFallback(legalTermsId?: number) {
  const userId = await getCurrentUserId()
  const resolvedTermsId = legalTermsId ?? (await getActiveLegalTermFromTable())?.id

  if (!resolvedTermsId) {
    throw new Error("No active legal terms version found.")
  }

  const acceptedAt = new Date().toISOString()
  const userAgent = typeof window !== "undefined" ? window.navigator.userAgent : null

  const { error } = await supabase.from("user_legal_acceptances").upsert(
    {
      user_id: userId,
      legal_terms_id: resolvedTermsId,
      accepted_at: acceptedAt,
      user_agent: userAgent,
    },
    {
      onConflict: "user_id,legal_terms_id",
    }
  )

  if (error) throw error
  return { accepted: true, accepted_at: acceptedAt }
}

export async function getLegalConsentStatus(accessToken?: string) {
  try {
    const data = await invokeEdge<LegalConsentStatus>("legal_consent", {
      body: { action: "status" },
      accessToken,
    })
    return (data ?? { accepted: false, accepted_at: null, active_term: null }) as LegalConsentStatus
  } catch (error: unknown) {
    if (!shouldFallbackToDirectTableAccess(error)) throw error
    return getLegalConsentStatusFallback()
  }
}

export async function acceptLegalConsent(legalTermsId?: number, accessToken?: string) {
  try {
    const data = await invokeEdge<{ accepted?: boolean; accepted_at?: string | null } | null>("legal_consent", {
      idempotencyKey: crypto.randomUUID(),
      accessToken,
      body: {
        action: "accept",
        legal_terms_id: legalTermsId,
      },
    })
    return (data ?? null) as { accepted?: boolean; accepted_at?: string | null } | null
  } catch (error: unknown) {
    if (!shouldFallbackToDirectTableAccess(error)) throw error
    return acceptLegalConsentFallback(legalTermsId)
  }
}
