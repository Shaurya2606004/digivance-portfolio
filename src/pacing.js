import { connectors, scenes } from './content'

/*
 * Scroll-to-footage pacing.
 *
 * One rule governs the whole journey: the camera advances the same number of
 * footage frames per pixel scrolled, everywhere. Two things used to break that.
 *
 * 1. Every chapter got a fixed 320dvh runway even though the dives run 8s, 8s,
 *    8s, 8s, 4s and 6s, so the four-second Radha Madhav dive played at half the
 *    speed of the others and the six-second finale at three quarters.
 * 2. Progress inside a clip was warped by `p + (linger / 2pi) * sin(2pi * p)`,
 *    which swings the speed by +/-58% within a single clip: fast out of the
 *    gate, slow-motion through the middle, fast again at the end. On top of
 *    that a 10% hold at each end froze the frame, then resumed at full speed
 *    with no ramp.
 *
 * Here, runway is derived from a clip's frame count, and progress follows a
 * trapezoidal velocity profile: ramp up, hold one constant speed, ramp down.
 */

export const CLIP_FPS = 24

/* Footage frames advanced per 1% of viewport height, at cruising speed. */
export const FRAMES_PER_VH = 0.9

/*
 * A touch flick covers more distance than a wheel step. The portrait chain gets
 * a longer runway so its hero frames remain readable instead of skipping past.
 */
export const MOBILE_FRAMES_PER_VH = 0.78

export const DIVE_RAMP = 0.16
export const CONNECTOR_RAMP = 0.1

/*
 * A connector holds its first frame while the outgoing dive cross-fades away
 * and its last frame while the incoming dive cross-fades in, so each seam
 * blends two still images instead of blending a moving image with a frozen one.
 */
export const CONNECTOR_LEAD = 0.08
export const CONNECTOR_TAIL = 0.1
export const CONNECTOR_SPAN = 1 - CONNECTOR_LEAD - CONNECTOR_TAIL

/* Held final frame after the last dive, so the contact copy has room to read. */
export const OUTRO_VH = 100
export const MOBILE_OUTRO_VH = 120

/* Peak speed of a trapezoid, as a multiple of its average speed. */
export const peakOf = (ramp) => 1 / (1 - ramp)

/*
 * Trapezoidal velocity profile. Position is quadratic across the first and last
 * `ramp` of the span and strictly linear between them, so velocity is
 * continuous, starts and ends at zero, never reverses, and never exceeds
 * 1 / (1 - ramp) of the average.
 */
export function rampedProgress(progress, ramp) {
  const t = progress <= 0 ? 0 : progress >= 1 ? 1 : progress
  const w = Math.min(0.49, Math.max(0.001, ramp))
  const peak = peakOf(w)

  if (t < w) return (peak * t * t) / (2 * w)
  if (t > 1 - w) return 1 - (peak * (1 - t) * (1 - t)) / (2 * w)
  return peak * (t - w / 2)
}

export const diveProgress = (progress) => rampedProgress(progress, DIVE_RAMP)

export const connectorProgress = (progress) =>
  rampedProgress((progress - CONNECTOR_LEAD) / CONNECTOR_SPAN, CONNECTOR_RAMP)

export const diveRunwayVh = (frames) =>
  Math.round((frames * peakOf(DIVE_RAMP)) / FRAMES_PER_VH)

export const connectorRunwayVh = (frames) =>
  Math.round((frames * peakOf(CONNECTOR_RAMP)) / (FRAMES_PER_VH * CONNECTOR_SPAN))

export const mobileDiveRunwayVh = (frames) =>
  Math.round((frames * peakOf(DIVE_RAMP)) / MOBILE_FRAMES_PER_VH)

export const mobileConnectorRunwayVh = (frames) =>
  Math.round(
    (frames * peakOf(CONNECTOR_RAMP)) /
      (MOBILE_FRAMES_PER_VH * CONNECTOR_SPAN),
  )

/* Scroll after a chapter's dive: its connector, or the outro on the last one. */
export const tailRunwayVh = (index) =>
  index < scenes.length - 1 && connectors[index]?.video
    ? connectorRunwayVh(connectors[index].frames)
    : OUTRO_VH

export const chapterRunwayVh = (index) =>
  diveRunwayVh(scenes[index].frames) + tailRunwayVh(index)

export const mobileTailRunwayVh = (index) =>
  index < scenes.length - 1 && connectors[index]?.mobileVideo
    ? mobileConnectorRunwayVh(
        connectors[index].mobileFrames || connectors[index].frames,
      )
    : MOBILE_OUTRO_VH

export const mobileChapterRunwayVh = (index) =>
  mobileDiveRunwayVh(scenes[index].mobileFrames || scenes[index].frames) +
  mobileTailRunwayVh(index)
