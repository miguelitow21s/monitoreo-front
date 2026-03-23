import { supabase } from "@/services/supabaseClient"

const configuredEvidenceBucket = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET?.trim()
const evidenceBucketCandidates = Array.from(
  new Set(
    [configuredEvidenceBucket, "evidence", "shift-evidence"].filter(
      (value): value is string => !!value && value.length > 0
    )
  )
)

export function getEvidenceBucketCandidates() {
  return [...evidenceBucketCandidates]
}

export async function uploadEvidenceObject(
  filePath: string,
  blob: Blob,
  options?: { contentType?: string; upsert?: boolean }
) {
  const failures: string[] = []

  for (const bucket of evidenceBucketCandidates) {
    const resolvedContentType = options?.contentType ?? (blob.type || "application/octet-stream")
    const { error } = await supabase.storage.from(bucket).upload(filePath, blob, {
      upsert: options?.upsert ?? false,
      contentType: resolvedContentType,
    })

    if (!error) {
      return { bucket, filePath }
    }

    failures.push(`${bucket}: ${error.message}`)
  }

  throw new Error(`Could not upload evidence to configured buckets. ${failures.join(" | ")}`)
}

export async function createEvidenceSignedUrl(path: string, expiresInSeconds = 3600) {
  if (/^https?:\/\//i.test(path)) return path
  const failures: string[] = []
  const trimmedPath = path.replace(/^\/+/, "")

  for (const bucket of evidenceBucketCandidates) {
    const candidates = new Set<string>([path, trimmedPath])
    const lowerBucket = bucket.toLowerCase()
    for (const candidate of Array.from(candidates)) {
      const cleaned = candidate.replace(/^\/+/, "")
      if (cleaned.toLowerCase().startsWith(`${lowerBucket}/`)) {
        candidates.add(cleaned.slice(lowerBucket.length + 1))
      }
    }

    for (const candidate of candidates) {
      if (!candidate) continue
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(candidate, expiresInSeconds)
      if (!error && data?.signedUrl) return data.signedUrl
      if (error) failures.push(`${bucket}: ${error.message}`)
    }
  }

  if (failures.length === 0) return null
  throw new Error(`Could not resolve evidence URL. ${failures.join(" | ")}`)
}
