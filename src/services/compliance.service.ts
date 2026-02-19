import { invokeEdge } from "@/services/edgeClient"

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

export async function getLegalConsentStatus() {
  const data = await invokeEdge<LegalConsentStatus>("legal_consent", {
    body: { action: "status" },
  })
  return (data ?? { accepted: false, accepted_at: null, active_term: null }) as LegalConsentStatus
}

export async function acceptLegalConsent(legalTermsId?: number) {
  const data = await invokeEdge<{ accepted?: boolean; accepted_at?: string | null } | null>("legal_consent", {
    idempotencyKey: crypto.randomUUID(),
    body: {
      action: "accept",
      legal_terms_id: legalTermsId,
    },
  })
  return (data ?? null) as { accepted?: boolean; accepted_at?: string | null } | null
}
