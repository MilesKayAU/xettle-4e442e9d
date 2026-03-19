type ShopifyHmacCandidate = {
  label: string
  message: string
}

type VerifyShopifyHmacInput = {
  rawInput?: string | null
  params?: Record<string, string | undefined | null>
  providedHmac: string
  secret: string
  excludedKeys?: string[]
}

const DEFAULT_EXCLUDED_KEYS = ['hmac', 'signature']

function getRawQueryString(input: string): string {
  if (!input) return ''
  const questionMarkIndex = input.indexOf('?')
  return questionMarkIndex >= 0 ? input.slice(questionMarkIndex + 1) : input.replace(/^\?/, '')
}

function splitRawPair(pair: string): [string, string] {
  const separatorIndex = pair.indexOf('=')
  return separatorIndex >= 0
    ? [pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1)]
    : [pair, '']
}

function decodeFormComponent(value: string): string {
  const normalized = value.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(normalized)
  } catch {
    return normalized
  }
}

function buildSortedMessageFromEntries(entries: Array<[string, string]>, excludedKeys: Set<string>): string {
  return entries
    .filter(([key]) => !excludedKeys.has(key))
    .map(([key, value]) => `${key}=${value}`)
    .sort((a, b) => a.localeCompare(b))
    .join('&')
}

function getShopifyHmacCandidates({
  rawInput,
  params,
  excludedKeys = DEFAULT_EXCLUDED_KEYS,
}: Omit<VerifyShopifyHmacInput, 'providedHmac' | 'secret'>): ShopifyHmacCandidate[] {
  const excluded = new Set(excludedKeys)
  const candidates: ShopifyHmacCandidate[] = []
  const seen = new Set<string>()

  const pushCandidate = (label: string, message: string) => {
    if (!message || seen.has(message)) return
    seen.add(message)
    candidates.push({ label, message })
  }

  if (rawInput?.trim()) {
    const rawQuery = getRawQueryString(rawInput)

    if (rawQuery) {
      const rawPairs = rawQuery.split('&').filter(Boolean)

      pushCandidate(
        'decoded_urlsearchparams',
        buildSortedMessageFromEntries(Array.from(new URLSearchParams(rawQuery).entries()), excluded),
      )

      pushCandidate(
        'decoded_manual',
        buildSortedMessageFromEntries(
          rawPairs.map((pair) => {
            const [rawKey, rawValue] = splitRawPair(pair)
            return [decodeFormComponent(rawKey), decodeFormComponent(rawValue)]
          }),
          excluded,
        ),
      )

      pushCandidate(
        'raw_query',
        rawPairs
          .filter((pair) => !excluded.has(splitRawPair(pair)[0]))
          .sort((a, b) => a.localeCompare(b))
          .join('&'),
      )
    }
  }

  if (params) {
    const recordEntries: Array<[string, string]> = []

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        recordEntries.push([key, value])
      }
    }

    pushCandidate('record_params', buildSortedMessageFromEntries(recordEntries, excluded))
  }

  return candidates
}

async function computeShopifyHmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  if (aBytes.byteLength !== bBytes.byteLength) return false

  const keyData = crypto.getRandomValues(new Uint8Array(32))
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', cryptoKey, aBytes),
    crypto.subtle.sign('HMAC', cryptoKey, bBytes),
  ])

  const viewA = new Uint8Array(sigA)
  const viewB = new Uint8Array(sigB)
  let result = 0

  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i]
  }

  return result === 0
}

export async function verifyShopifyHmac({
  rawInput,
  params,
  providedHmac,
  secret,
  excludedKeys,
}: VerifyShopifyHmacInput): Promise<{ valid: boolean; matchedStrategy: string | null }> {
  const candidates = getShopifyHmacCandidates({ rawInput, params, excludedKeys })

  for (const candidate of candidates) {
    const computedHmac = await computeShopifyHmacHex(secret, candidate.message)
    const isValid = await timingSafeEqual(computedHmac.toLowerCase(), providedHmac.toLowerCase())

    if (isValid) {
      return { valid: true, matchedStrategy: candidate.label }
    }
  }

  return { valid: false, matchedStrategy: null }
}
