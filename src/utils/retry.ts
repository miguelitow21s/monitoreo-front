export async function withRetry<T>(
  action: () => Promise<T>,
  retries = 2,
  delayMs = 400
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }

  throw lastError
}
