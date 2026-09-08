/*
 * Media tiers.
 *
 * The journey is eleven scrub clips. Downloading the full-quality chain is a
 * lot of bytes, so the visitor's connection decides which of three modes runs:
 *
 *   hd     - the full-resolution clips
 *   lite   - roughly a tenth of the bytes, same cut, lower resolution
 *   poster - no video at all; the stage cross-fades the still posters
 *
 * Poster mode is not a failure state. Every layer already renders its poster
 * underneath the video, so a poster-only visit gets the same composition, the
 * same copy and the same scroll choreography for about 1 MB of images. That is
 * the floor the site degrades to instead of a blank stage on a slow link.
 */

export const TIERS = { HD: 'hd', LITE: 'lite', POSTER: 'poster' }

const TIER_ORDER = [TIERS.POSTER, TIERS.LITE, TIERS.HD]

// Throughput thresholds in bytes/ms (1 B/ms == 8 kbps).
const UPGRADE_BYTES_PER_MS = 900 // ~7 Mbps sustained
const DOWNGRADE_BYTES_PER_MS = 180 // ~1.4 Mbps sustained

const DIRECTORIES = {
  desktop: { [TIERS.HD]: 'video', [TIERS.LITE]: 'video-lite' },
  mobile: { [TIERS.HD]: 'video-mobile', [TIERS.LITE]: 'video-mobile-lite' },
}

/*
 * Resolves a clip path declared in content.js against a tier. Content always
 * names the hd path; the lite chain is the same filename in a sibling
 * directory, so nothing has to be listed twice.
 */
export function tierSource(source, tier, isMobile) {
  if (!source || tier === TIERS.POSTER) return null
  const dirs = DIRECTORIES[isMobile ? 'mobile' : 'desktop']
  const hd = dirs[TIERS.HD]
  const wanted = dirs[tier] || hd
  return source.replace(`/assets/${hd}/`, `/assets/${wanted}/`)
}

function overrideTier() {
  try {
    const requested = new URLSearchParams(window.location.search).get('quality')
    if (requested && TIER_ORDER.includes(requested)) return requested
  } catch {
    // A malformed query string is not worth failing the visit over.
  }
  return null
}

/*
 * The opening guess, made before a single byte of video is requested. It is
 * deliberately pessimistic: starting lite and upgrading is a better first
 * impression than starting hd and stalling.
 */
export function detectTier(isMobile = false) {
  const forced = overrideTier()
  if (forced) return forced

  if (typeof window === 'undefined') return TIERS.LITE

  const connection =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection
  const memory = navigator.deviceMemory || 8

  // A 2 GB handset benefits more from zero decoder pressure than from a
  // compressed film. The poster composition is the intentional floor.
  if (isMobile && memory <= 2) return TIERS.POSTER

  if (!connection) {
    // No Network Information API (Safari, Firefox). Device memory is the only
    // other signal available, and the runtime meter corrects from there.
    if (isMobile) return TIERS.LITE
    return memory >= 8 ? TIERS.HD : TIERS.LITE
  }

  if (connection.saveData) return TIERS.POSTER

  const effectiveType = connection.effectiveType || '4g'
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return TIERS.POSTER
  if (effectiveType === '3g') return TIERS.LITE

  // Portrait video is already a separate, native chain. Keep phones on the
  // lighter encode by default—even on a fast 4G/Wi-Fi signal—so a full-chain
  // preloader does not ask a handset to hold 35 MB of video before reveal.
  // `?quality=hd` remains available for a deliberate high-quality override.
  if (isMobile) return TIERS.LITE

  const downlink = connection.downlink || 0
  if (downlink && downlink < 3) return TIERS.LITE
  if (memory < 4) return TIERS.LITE

  return TIERS.HD
}

export function stepTier(tier, direction) {
  const index = TIER_ORDER.indexOf(tier)
  if (index === -1) return tier
  const next = Math.min(TIER_ORDER.length - 1, Math.max(0, index + direction))
  return TIER_ORDER[next]
}

/*
 * Watches what the network actually delivers and corrects the opening guess.
 * Client hints describe the radio, not the CDN, so the measured rate of the
 * clips themselves is the signal that matters.
 */
export function createBandwidthMeter(initialTier, onTierChange) {
  let tier = initialTier
  let bytes = 0
  let elapsed = 0
  const locked = overrideTier() !== null

  const setTier = (next) => {
    if (next === tier || locked) return
    tier = next
    onTierChange?.(tier)
  }

  return {
    get tier() {
      return tier
    },
    /* A clip finished. Fold it into the running average and re-decide. */
    record(byteLength, durationMs) {
      if (!byteLength || durationMs <= 0) return
      bytes += byteLength
      elapsed += durationMs

      const rate = bytes / elapsed
      if (rate < DOWNGRADE_BYTES_PER_MS) setTier(stepTier(tier, -1))
      else if (rate > UPGRADE_BYTES_PER_MS) setTier(stepTier(tier, 1))
    },
    /* A clip blew the budget or failed outright. Drop a tier immediately. */
    penalise() {
      setTier(stepTier(tier, -1))
    },
    forceTier: setTier,
  }
}
