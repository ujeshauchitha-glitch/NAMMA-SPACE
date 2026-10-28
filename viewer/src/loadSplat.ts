// Downloads a splat with byte progress and turns every failure into a message a person can act on,
// instead of letting Spark try to parse a 404 page or an SPA fallback.

export interface LoadProgress {
  loaded: number
  /** Total bytes, or null when the host sends no Content-Length (e.g. compressed transfer). */
  total: number | null
}

export class SplatLoadError extends Error {}

// First bytes of the formats Spark reads: PLY text header, gzip (SPZ), raw SPZ, ZIP (SOG).
function looksLikeSplat(bytes: Uint8Array): boolean {
  const b = bytes
  if (b.length < 4) return false
  if (b[0] === 0x70 && b[1] === 0x6c && b[2] === 0x79) return true // "ply"
  if (b[0] === 0x1f && b[1] === 0x8b) return true // gzip
  if (b[0] === 0x4e && b[1] === 0x47 && b[2] === 0x53 && b[3] === 0x50) return true // "NGSP"
  if (b[0] === 0x50 && b[1] === 0x4b) return true // "PK"
  return false
}

export async function fetchSplat(
  url: string,
  onProgress: (p: LoadProgress) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (err) {
    if (signal.aborted) throw err
    throw new SplatLoadError(
      `Could not reach ${url}. The host is down, or it does not allow cross-origin requests (CORS).`,
    )
  }
  if (res.status === 404) throw new SplatLoadError(`Splat file not found (HTTP 404): ${url}`)
  // Hugging Face answers 401 for a repo that does not exist or is private.
  if (res.status === 401 || res.status === 403) {
    throw new SplatLoadError(`Splat file missing or not public (HTTP ${res.status}): ${url}`)
  }
  if (!res.ok) throw new SplatLoadError(`The splat host answered HTTP ${res.status} for ${url}`)
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new SplatLoadError(`Splat file missing: ${url} returned a web page, not a splat.`)
  }

  const header = res.headers.get('content-length')
  const total = header && !res.headers.get('content-encoding') ? Number(header) : null
  const chunks: Uint8Array[] = []
  let loaded = 0
  onProgress({ loaded, total })
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      onProgress({ loaded, total })
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer())
    chunks.push(buf)
    loaded = buf.length
    onProgress({ loaded, total })
  }

  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.length
  }
  if (!looksLikeSplat(bytes)) {
    throw new SplatLoadError(`${url} is not a splat file Spark can read (.ply, .spz or .sog).`)
  }
  return bytes
}
