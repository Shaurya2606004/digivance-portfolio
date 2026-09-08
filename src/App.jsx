import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  EnvelopeSimple,
} from '@phosphor-icons/react'
import gsap from 'gsap'
import ScrollSmoother from 'gsap/ScrollSmoother'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { connectors, contactEmail, scenes } from './content'
import {
  TIERS,
  createBandwidthMeter,
  detectTier,
  tierSource,
} from './media'
import {
  CLIP_FPS,
  CONNECTOR_LEAD,
  CONNECTOR_TAIL,
  OUTRO_VH,
  chapterRunwayVh,
  connectorProgress,
  connectorRunwayVh,
  diveProgress,
  mobileChapterRunwayVh,
  mobileConnectorRunwayVh,
  mobileTailRunwayVh,
  tailRunwayVh,
} from './pacing'
import './styles.css'

gsap.registerPlugin(ScrollTrigger, ScrollSmoother)

const HALF_FRAME = 1 / CLIP_FPS / 2

/*
 * Seek scheduler.
 *
 * One seek is allowed in flight across a stage at a time, the newest target
 * always wins, hidden layers are never seeked, and the next seek waits until
 * the previous frame has actually been presented. The mobile encodes add a
 * four-frame GOP, so this coalescing keeps even a fast touch flick responsive.
 */
const SEEK_TIMEOUT_MS = 220
// A download that goes this long without delivering a byte is stalled, not slow.
const CLIP_STALL_MS = 4000
const MAX_CONCURRENT_LOADS = 2

/*
 * The breakpoint the portrait cinematic runs at. The gsap contexts below match
 * on the same width, so whichever stage owns the media elements is the stage
 * that is actually being driven.
 */
/*
 * How many clips may stay attached to a media element at once. Every attached
 * clip holds a decoder and its decoded frames, which is the expensive resource
 * on a phone — far more so than the bytes. Keeping a small window around the
 * visitor and detaching the rest is what stops the portrait stage from running
 * the tab out of memory partway down the page. The downloaded bytes stay in the
 * blob cache, so re-attaching a released clip costs no network.
 */
const MAX_RESIDENT_CLIPS = { desktop: 6, mobile: 3 }

const MOBILE_STAGE_QUERY = '(max-width: 860px)'
const isPortraitViewport = () =>
  typeof window !== 'undefined' && window.matchMedia(MOBILE_STAGE_QUERY).matches

// The first visit warms the complete chain for this viewport. Keeping the
// object URLs here lets the scrub controller reuse the already-downloaded blobs
// instead of fetching every clip a second time after the reveal.
const preloadedMedia = new Map()

/*
 * One tier decision per visit, shared by the loading screen and both scrub
 * controllers. When the meter downgrades mid-journey the new tier reaches every
 * clip that has not been requested yet, so the rest of the scroll gets lighter
 * rather than stalling.
 */
let mediaTier = detectTier()
const tierListeners = new Set()
const bandwidthMeter = createBandwidthMeter(mediaTier, (next) => {
  mediaTier = next
  tierListeners.forEach((listener) => listener(next))
})

// The loader owns the full visual chain, so the first reveal is also the point
// where every video is already available to the scrub controller.
function preloadSourcesForViewport(isMobile, tier) {
  const sceneImages = scenes.flatMap((scene) => [
    isMobile ? scene.mobileImage : scene.image,
    isMobile ? scene.mobileVideoPoster : scene.videoPoster,
  ])
  const connectorImages = connectors.flatMap((connector, index) => [
    isMobile
      ? connector.mobilePoster || scenes[index + 1]?.mobileVideoPoster
      : connector.poster,
  ])
  const clip = (source) => tierSource(source, tier, isMobile)
  const videoSources = [
    ...scenes.map((scene) => clip(isMobile ? scene.mobileVideo : scene.video)),
    ...connectors.map((connector) =>
      clip(isMobile ? connector.mobileVideo : connector.video),
    ),
  ].filter(Boolean)

  return {
    images: [...new Set([...sceneImages, ...connectorImages].filter(Boolean))],
    videos: [...new Set(videoSources)],
  }
}

function createVideoController(
  stage,
  { mobile = false, maxConcurrentLoads = MAX_CONCURRENT_LOADS } = {},
) {
  const states = new Map()
  const objectUrls = new Set()
  const abortControllers = new Set()
  const loadQueue = []

  let rafId = 0
  let seekLock = null
  let seekLockedAt = 0
  let activeLoads = 0
  let destroyed = false
  let userReady = false

  // Attach order, oldest first. Trimmed by evictResident.
  const resident = []
  const residentCap = mobile
    ? MAX_RESIDENT_CLIPS.mobile
    : MAX_RESIDENT_CLIPS.desktop

  const schedule = () => {
    if (rafId || destroyed) return
    rafId = window.requestAnimationFrame(step)
  }

  const releaseLock = (state) => {
    if (destroyed) return
    if (seekLock === state.key) seekLock = null
    state.layer.classList.add('is-video-ready')
    schedule()
  }

  /*
   * Hands a clip's media element back. The layer falls back to its poster and
   * the state resets to un-requested, so scrolling into it again re-attaches
   * from the blob cache without touching the network.
   */
  const releaseState = (state) => {
    if (!state.ready) return
    state.ready = false
    state.requested = false
    state.primed = false
    state.applied = -1
    state.layer.classList.remove('is-video-ready')
    state.video.removeAttribute('src')
    state.video.load()
  }

  const evictResident = () => {
    while (resident.length > residentCap) {
      // Never release what is on screen; look further back instead.
      const index = resident.findIndex((key) => {
        const candidate = states.get(key)
        return candidate && !isVisible(candidate.layer)
      })
      if (index === -1) break
      const [key] = resident.splice(index, 1)
      releaseState(states.get(key))
    }
  }

  const isVisible = (layer) => {
    if (layer.style.visibility === 'hidden') return false
    const opacity = layer.style.opacity
    return opacity === '' || Number(opacity) > 0.02
  }

  function step() {
    rafId = 0
    if (destroyed) return

    if (seekLock && performance.now() - seekLockedAt > SEEK_TIMEOUT_MS) {
      seekLock = null
    }

    let more = false

    states.forEach((state) => {
      if (!state.ready) return

      const { duration } = state.video
      if (!Number.isFinite(duration) || duration <= 0) return

      const lastFrameTime = Math.max(0, duration - HALF_FRAME)
      const target = Math.min(
        lastFrameTime,
        Math.max(0, state.target * lastFrameTime),
      )
      if (Math.abs(target - state.applied) < HALF_FRAME) return

      // A hidden layer keeps its target; the next seek call re-schedules it.
      if (!isVisible(state.layer)) return

      if (seekLock || state.video.seeking) {
        more = true
        return
      }

      try {
        state.video.currentTime = target
        state.applied = target
        seekLock = state.key
        seekLockedAt = performance.now()
        if (state.usesFrameCallback) {
          state.video.requestVideoFrameCallback(() => releaseLock(state))
        }
      } catch {
        // The seekable range can lag decoded metadata by a frame or two.
      }

      more = true
    })

    if (more) schedule()
  }

  stage.querySelectorAll('[data-media-key]').forEach((layer) => {
    const video = layer.querySelector('video[data-src]')
    if (!video) return

    const state = {
      key: layer.dataset.mediaKey,
      layer,
      video,
      // content.js always names the hd path; the tier picks the directory.
      hdSource: video.dataset.src,
      ready: false,
      requested: false,
      target: 0,
      applied: -1,
      primed: false,
      priming: false,
      usesFrameCallback:
        typeof video.requestVideoFrameCallback === 'function',
    }

    layer.classList.remove('is-video-ready', 'has-media-error')

    const onSeeked = () => {
      if (!state.usesFrameCallback) releaseLock(state)
    }
    video.addEventListener('seeked', onSeeked)
    state.detach = () => video.removeEventListener('seeked', onSeeked)

    states.set(state.key, state)
  })

  const primeState = (state) => {
    if (
      !mobile ||
      destroyed ||
      !state.ready ||
      state.primed ||
      state.priming
    ) {
      return
    }

    state.priming = true
    try {
      const playRequest = state.video.play()
      if (playRequest?.then) {
        playRequest
          .then(() => {
            state.video.pause()
            state.primed = true
          })
          .catch(() => {})
          .finally(() => {
            state.priming = false
          })
      } else {
        state.video.pause()
        state.primed = true
        state.priming = false
      }
    } catch {
      state.priming = false
    }
  }

  const prime = () => {
    userReady = true
    states.forEach(primeState)
  }

  const pumpLoads = () => {
    // A slow connection is better served finishing the clip it needs next than
    // splitting its bandwidth across two.
    const limit = mediaTier === TIERS.HD ? maxConcurrentLoads : 1
    while (activeLoads < limit && loadQueue.length) {
      const job = loadQueue.shift()
      activeLoads += 1
      job().finally(() => {
        activeLoads -= 1
        pumpLoads()
      })
    }
  }

  const attachObjectUrl = (state, objectUrl) =>
    new Promise((resolve) => {
      if (destroyed) {
        resolve()
        return
      }

      const onLoadedData = () => {
        state.video.removeEventListener('error', onError)
        state.ready = true
        state.applied = -1
        resident.push(state.key)
        evictResident()
        if (userReady) primeState(state)
        schedule()
        resolve()
      }
      const onError = () => {
        state.video.removeEventListener('loadeddata', onLoadedData)
        state.layer.classList.add('has-media-error')
        resolve()
      }

      state.video.addEventListener('loadeddata', onLoadedData, { once: true })
      state.video.addEventListener('error', onError, { once: true })
      state.video.src = objectUrl
      state.video.load()
    })

  /*
   * Streams the clip rather than awaiting a whole blob, so a stalled download
   * is caught while it is stalling instead of after the full body never
   * arrives. Bytes and elapsed time feed the meter, which is the only honest
   * measure of the connection: client hints describe the radio, not the CDN.
   */
  const fetchClip = (state) => {
    const source = tierSource(state.hdSource, mediaTier, mobile)
    if (!source) return Promise.resolve()

    const cached = preloadedMedia.get(source)
    if (cached?.objectUrl) return attachObjectUrl(state, cached.objectUrl)

    const controller = new AbortController()
    abortControllers.add(controller)

    const startedAt = performance.now()
    let stallTimer = 0
    const armStall = () => {
      window.clearTimeout(stallTimer)
      stallTimer = window.setTimeout(() => controller.abort(), CLIP_STALL_MS)
    }
    armStall()

    return fetch(source, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Video request failed: ${response.status}`)
        if (!response.body) return response.blob()

        const reader = response.body.getReader()
        const chunks = []
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          armStall()
        }
        return new Blob(chunks, { type: 'video/mp4' })
      })
      .then((blob) => {
        window.clearTimeout(stallTimer)
        if (destroyed) return undefined
        bandwidthMeter.record(blob.size, performance.now() - startedAt)
        /*
         * Cached rather than owned by this controller. The resident window
         * detaches clips the visitor has scrolled away from, and scrolling back
         * has to re-attach from these bytes instead of asking the network
         * again. That means the url must outlive the controller, so it is
         * deliberately not added to objectUrls, which destroy() revokes.
         */
        const objectUrl = URL.createObjectURL(blob)
        preloadedMedia.set(source, { objectUrl, size: blob.size })
        return attachObjectUrl(state, objectUrl)
      })
      .catch((error) => {
        window.clearTimeout(stallTimer)
        if (destroyed) return
        if (error.name === 'AbortError') {
          // Either the stage is tearing down or the clip stalled. A stalled
          // clip means this tier is too heavy for the connection, so the layer
          // holds its poster and the next one is fetched lighter.
          state.requested = false
          bandwidthMeter.penalise()
          return
        }
        state.layer.classList.add('has-media-error')
        console.warn(error)
      })
      .finally(() => abortControllers.delete(controller))
  }

  const load = (key, urgent = false) => {
    const state = states.get(key)
    if (!state || destroyed || state.requested) return
    // Poster mode is a complete visit on its own: the layer's still is already
    // on screen, so there is nothing to download.
    if (mediaTier === TIERS.POSTER) return

    state.requested = true
    const job = () => (destroyed ? Promise.resolve() : fetchClip(state))
    if (urgent) loadQueue.unshift(job)
    else loadQueue.push(job)
    pumpLoads()
  }

  const seek = (key, progress) => {
    const state = states.get(key)
    if (!state || destroyed) return

    state.target = progress <= 0 ? 0 : progress >= 1 ? 1 : progress
    if (!state.ready) {
      load(key, true)
      return
    }
    schedule()
  }

  /*
   * The meter can change tier mid-journey. Clips already queued resolve their
   * URL at fetch time and so pick up the new tier on their own; this only has
   * to wake up the layers that were skipped while the tier was lower.
   */
  const onTierChange = () => {
    if (destroyed || mediaTier === TIERS.POSTER) return
    states.forEach((state) => {
      if (!state.ready && !state.requested && isVisible(state.layer)) {
        load(state.key, true)
      }
    })
  }
  tierListeners.add(onTierChange)

  const destroy = () => {
    destroyed = true
    tierListeners.delete(onTierChange)
    loadQueue.length = 0
    if (rafId) window.cancelAnimationFrame(rafId)
    abortControllers.forEach((controller) => controller.abort())
    states.forEach((state) => {
      state.detach?.()
      state.layer.classList.remove('is-video-ready', 'has-media-error')
      state.video.removeAttribute('src')
      state.video.load()
    })
    objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
    states.clear()
  }

  return { load, seek, prime, destroy }
}

/*
 * A backstop for a connection that has effectively gone away. The reveal waits
 * for the complete chain, but never traps a visitor indefinitely.
 */
const PRELOAD_TIMEOUT_MS = 45000

function preloadImage(source, signal) {
  return fetch(source, { cache: 'force-cache', signal })
    .then((response) => {
      if (!response.ok) throw new Error(`Image request failed: ${response.status}`)
      return response.blob()
    })
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob)
          const image = new Image()
          const cleanUp = () => URL.revokeObjectURL(objectUrl)
          image.onload = () => {
            cleanUp()
            resolve()
          }
          image.onerror = () => {
            cleanUp()
            reject(new Error(`Image decode failed: ${source}`))
          }
          image.src = objectUrl
        }),
    )
}

function preloadVideo(source, signal, onProgress) {
  const cached = preloadedMedia.get(source)
  if (cached?.objectUrl) {
    onProgress(1)
    return Promise.resolve()
  }

  return fetch(source, { cache: 'force-cache', signal })
    .then((response) => {
      if (!response.ok) throw new Error(`Video request failed: ${response.status}`)

      const total = Number(response.headers.get('content-length'))
      if (!response.body || !Number.isFinite(total) || total <= 0) {
        onProgress(0.35)
        return response.blob()
      }

      const reader = response.body.getReader()
      const chunks = []
      let received = 0

      const readChunk = () =>
        reader.read().then(({ done, value }) => {
          if (done) return new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' })
          chunks.push(value)
          received += value.byteLength
          onProgress(Math.min(0.92, received / total))
          return readChunk()
        })

      return readChunk()
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob)
      preloadedMedia.set(source, { objectUrl, size: blob.size })
      onProgress(1)
    })
}

function LoadingScreen({ onReady }) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Loading scene art')

  useEffect(() => {
    let cancelled = false
    let timeoutId = 0
    const abortController = new AbortController()
    /*
     * The same breakpoint the stage uses. These used to disagree — the
     * preloader also treated any coarse pointer as mobile — so a touch laptop
     * downloaded the portrait chain and then ran the desktop cinematic, paying
     * for the whole journey twice and warming none of what it went on to play.
     */
    const isMobile = window.matchMedia(MOBILE_STAGE_QUERY).matches
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const manifest = preloadSourcesForViewport(
      isMobile,
      prefersReducedMotion ? TIERS.POSTER : mediaTier,
    )
    const tasks = [
      ...manifest.images.map((source) => ({
        id: `image:${source}`,
        type: 'image',
        source,
        weight: 1,
      })),
      ...manifest.videos.map((source) => ({
        id: `video:${source}`,
        type: 'video',
        source,
        weight: 6,
      })),
      { id: 'fonts', type: 'font', weight: 1 },
    ]
    const values = new Map(tasks.map((task) => [task.id, 0]))
    const totalWeight = tasks.reduce((total, task) => total + task.weight, 0)
    let failed = 0
    let cursor = 0
    let completed = 0
    let finished = false

    const updateProgress = () => {
      if (cancelled) return
      const loadedWeight = [...values].reduce(
        (total, [id, value]) =>
          total + (tasks.find((task) => task.id === id)?.weight || 0) * value,
        0,
      )
      setProgress(Math.min(99, Math.round((loadedWeight / totalWeight) * 100)))
    }

    const finish = async (timedOut = false) => {
      if (finished || cancelled) return
      finished = true
      window.clearTimeout(timeoutId)
      if (timedOut) {
        abortController.abort()
        setStatus('Opening with poster fallback')
        setProgress((value) => Math.max(value, 94))
        await new Promise((resolve) => window.setTimeout(resolve, 520))
      } else {
        setStatus(failed ? 'Ready with poster fallbacks' : 'Ready')
        setProgress(100)
        await new Promise((resolve) =>
          window.setTimeout(resolve, prefersReducedMotion ? 80 : 420),
        )
      }
      if (cancelled) return
      onReady()
    }

    const runTask = async (task) => {
      try {
        if (task.type === 'image') {
          if (!finished) setStatus('Loading scene art')
          await preloadImage(task.source, abortController.signal)
        } else if (task.type === 'video') {
          if (!finished) setStatus('Loading video journey')
          await preloadVideo(task.source, abortController.signal, (value) => {
            values.set(task.id, value)
            updateProgress()
          })
        } else {
          if (!finished) setStatus('Loading type and interface')
          await document.fonts?.ready
        }
      } catch (error) {
        if (error.name !== 'AbortError') failed += 1
      } finally {
        values.set(task.id, 1)
        completed += 1
        updateProgress()
      }
    }

    const runQueue = async () => {
      const worker = async () => {
        while (!cancelled && cursor < tasks.length) {
          const task = tasks[cursor]
          cursor += 1
          await runTask(task)
        }
      }
      await Promise.all([worker(), worker()])
      if (completed === tasks.length) await finish()
    }

    document.documentElement.classList.add('is-loading')
    document.body.classList.add('is-loading')
    timeoutId = window.setTimeout(() => finish(true), PRELOAD_TIMEOUT_MS)
    runQueue()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      abortController.abort()
      document.documentElement.classList.remove('is-loading')
      document.body.classList.remove('is-loading')
    }
  }, [onReady])

  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-header">
        <span className="wordmark" aria-label="digiVance">
          digi<span>V</span>ance
        </span>
        <span className="loading-label">Portfolio experience</span>
      </div>
      <div className="loading-core">
        <p className="loading-kicker">Loading the visual journey</p>
        <p className="loading-value" aria-hidden="true">
          {String(progress).padStart(2, '0')}
          <span>%</span>
        </p>
        <div
          className="loading-meter"
          role="progressbar"
          aria-label="Loading digiVance portfolio"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={progress}
        >
          <span style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
        <p className="loading-status">{status}</p>
      </div>
      <div className="loading-footer">
        <span>Websites and digital products for business</span>
        <span>Preparing your view</span>
      </div>
    </div>
  )
}

function Wordmark() {
  return (
    <span className="wordmark" aria-label="digiVance">
      digi<span>V</span>ance
    </span>
  )
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand-link" href="#top" aria-label="digiVance home">
        <Wordmark />
      </a>
      <nav className="primary-nav" aria-label="Primary navigation">
        <a className="work-link" href="#studio-agriya">
          Work
        </a>
        <a className="nav-cta" href="#contact">
          Start a project
          <ArrowUpRight aria-hidden="true" weight="bold" />
        </a>
      </nav>
    </header>
  )
}

function ProjectLink({ href, children, className = '' }) {
  return (
    <a className={`text-link ${className}`.trim()} href={href}>
      <span>{children}</span>
      <ArrowDownRight aria-hidden="true" weight="bold" />
    </a>
  )
}

function LiveProjectLink({ scene }) {
  return (
    <a
      className="live-project-link"
      href={scene.projectUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${scene.client} live project. Opens in a new tab.`}
    >
      <span>
        <strong>View live project</strong>
        <small>{scene.projectDomain}</small>
      </span>
      <ArrowUpRight aria-hidden="true" weight="bold" />
    </a>
  )
}

function ChapterCopy({ scene, headingId }) {
  const Heading = scene.kind === 'intro' ? 'h1' : 'h2'

  return (
    <div className="chapter-copy">
      {scene.eyebrow && <p className="eyebrow">{scene.eyebrow}</p>}
      {scene.client && (
        <div className="project-context">
          <p>{scene.type}</p>
          <span>Live project</span>
        </div>
      )}
      <Heading id={headingId} className="chapter-title">
        {scene.title}
      </Heading>
      {scene.outcome && <p className="project-outcome">{scene.outcome}</p>}
      <p className="chapter-body">{scene.body}</p>

      {scene.kind === 'intro' && (
        <ProjectLink href="#studio-agriya" className="chapter-action">
          Explore live projects
        </ProjectLink>
      )}

      {scene.projectUrl && <LiveProjectLink scene={scene} />}

      {scene.kind === 'contact' && (
        <a className="contact-link" href={`mailto:${contactEmail}`}>
          <EnvelopeSimple aria-hidden="true" weight="bold" />
          <span>
            Start a project
            <small>{contactEmail}</small>
          </span>
          <ArrowUpRight aria-hidden="true" weight="bold" />
        </a>
      )}
    </div>
  )
}

function Chapter({ scene, index }) {
  const headingId = `${scene.id}-mobile-title`

  return (
    <article
      className={`chapter chapter-${scene.kind || 'project'} align-${scene.align}`}
      id={scene.id}
      data-scene={index}
      style={{
        '--chapter-runway': `${chapterRunwayVh(index)}dvh`,
        '--chapter-runway-mobile': `${mobileChapterRunwayVh(index)}svh`,
      }}
      aria-labelledby={headingId}
    >
      <div className="mobile-poster-wrap">
        <img
          className="mobile-poster"
          src={scene.mobileImage || scene.image}
          alt={scene.imageAlt}
          loading={index === 0 ? 'eager' : 'lazy'}
          fetchPriority={index === 0 ? 'high' : 'auto'}
          decoding="async"
        />
      </div>

      <div className="chapter-inner">
        <ChapterCopy scene={scene} headingId={headingId} />
      </div>
    </article>
  )
}

function DesktopCopyStage({ copyStageRef, activeScene }) {
  return (
    <div className="desktop-copy-stage" ref={copyStageRef}>
      {scenes.map((scene, index) => {
        const headingId = `${scene.id}-desktop-title`

        return (
          <section
            className={`desktop-copy-frame chapter-${scene.kind || 'project'} align-${scene.align} ${activeScene === index ? 'is-active' : ''}`}
            data-copy={index}
            aria-labelledby={headingId}
            key={scene.id}
          >
            <ChapterCopy scene={scene} headingId={headingId} />
          </section>
        )
      })}
    </div>
  )
}

function RouteRail({ activeScene }) {
  return (
    <nav className="route-rail" aria-label="Project chapters">
      {scenes.map((scene, index) => (
        <a
          key={scene.id}
          className={activeScene === index ? 'is-active' : ''}
          href={`#${scene.id}`}
          aria-current={activeScene === index ? 'step' : undefined}
        >
          <span className="route-line" aria-hidden="true" />
          <span className="route-label">{scene.shortLabel}</span>
        </a>
      ))}
    </nav>
  )
}

/*
 * Desktop and mobile keep isolated media trees/controllers. The portrait stage
 * receives stable props, so desktop scrim changes never reconcile its videos.
 */
const VisualStage = memo(function VisualStage({
  stageRef,
  sideClass,
  variant = 'desktop',
  active = true,
}) {
  const isMobile = variant === 'mobile'

  return (
    <div
      className={`visual-stage visual-stage-${variant} ${sideClass}`.trim()}
      ref={stageRef}
      aria-hidden="true"
    >
      <div className="visual-stack">
        {scenes.map((scene, index) => {
          const video = isMobile ? scene.mobileVideo : scene.video
          const poster = isMobile
            ? scene.mobileVideoPoster || scene.mobileImage
            : scene.videoPoster || scene.image

          return (
            <figure
              className="visual-layer scene-visual"
              data-scene-visual={index}
              data-media-key={`scene-${index}`}
              key={`${variant}-${scene.id}`}
            >
              <img
                className="media-poster"
                src={poster}
                alt=""
                loading={index === 0 ? 'eager' : 'lazy'}
                fetchPriority={index === 0 ? 'high' : 'auto'}
                decoding="async"
              />
              {active && video && (
                <video
                  className="scrub-video"
                  data-src={video}
                  muted
                  playsInline
                  preload="none"
                  disablePictureInPicture
                  tabIndex="-1"
                />
              )}
            </figure>
          )
        })}
        {connectors.map((connector, index) => {
          const video = isMobile ? connector.mobileVideo : connector.video
          const poster = isMobile
            ? connector.mobilePoster || scenes[index + 1]?.mobileVideoPoster
            : connector.poster

          return video ? (
            <figure
              className="visual-layer connector-visual"
              data-connector-visual={index}
              data-media-key={`connector-${index}`}
              key={`${variant}-${connector.id}`}
            >
              <img
                className="media-poster"
                src={poster}
                alt=""
                loading="lazy"
                decoding="async"
              />
              {active && (
                <video
                  className="scrub-video"
                  data-src={video}
                  muted
                  playsInline
                  preload="none"
                  disablePictureInPicture
                  tabIndex="-1"
                />
              )}
            </figure>
          ) : null
        })}
      </div>
      <div className="stage-scrim" />
      <div className="stage-grain" />
    </div>
  )
})

function App() {
  const experienceRef = useRef(null)
  const stageRef = useRef(null)
  const mobileStageRef = useRef(null)
  const copyStageRef = useRef(null)
  const smoothWrapperRef = useRef(null)
  const smoothContentRef = useRef(null)
  const [activeScene, setActiveScene] = useState(0)
  const [isReady, setIsReady] = useState(false)
  /*
   * Both stages stay mounted so the scroll choreography and poster art never
   * have to be rebuilt, but only one of them creates <video> elements. iOS
   * Safari caps how many media elements a page may hold at once, and mounting
   * the desktop and portrait chains together put the page at twenty-two before
   * a single clip had loaded — comfortably over the cap, which is what made the
   * stage fail on phones.
   */
  const [portraitStage, setPortraitStage] = useState(isPortraitViewport)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_STAGE_QUERY)
    const sync = () => setPortraitStage(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useLayoutEffect(() => {
    const experience = experienceRef.current
    const stage = stageRef.current
    const mobileStage = mobileStageRef.current
    const copyStage = copyStageRef.current
    const smoothWrapper = smoothWrapperRef.current
    const smoothContent = smoothContentRef.current
    if (
      !experience ||
      !stage ||
      !mobileStage ||
      !copyStage ||
      !smoothWrapper ||
      !smoothContent
    ) {
      return undefined
    }

    const mm = gsap.matchMedia()

    mm.add(
      '(min-width: 861px) and (prefers-reduced-motion: no-preference)',
      () => {
        let cancelled = false
        const videoController = createVideoController(stage)
        const chapters = gsap.utils.toArray('.chapter', experience)
        chapters.forEach((chapter) => chapter.setAttribute('aria-hidden', 'true'))

        /*
         * Lazy posters finish loading while the visitor is mid-scroll, and
         * dvh-based heights change when browser chrome hides. Letting either
         * fire an automatic refresh is what made the journey jump position.
         * Layout here does not depend on media size, so refreshes are taken
         * manually, on a real width change only.
         */
        ScrollTrigger.config({
          ignoreMobileResize: true,
          autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load',
        })

        ScrollSmoother.get()?.kill()
        const smoother = ScrollSmoother.create({
          wrapper: smoothWrapper,
          content: smoothContent,
          smooth: 0.8,
          speed: 1,
          effects: false,
          smoothTouch: 0,
          // normalizeScroll takes over the scroll position itself, which
          // desynced the smoother from native scroll (scrollbar drags, keyboard
          // paging, reload restore). This block is desktop-only, so the touch
          // jitter it exists to fix does not apply here.
          normalizeScroll: false,
          ignoreMobileResize: true,
        })

        const internalLinks = Array.from(
          document.querySelectorAll('a[href^="#"]'),
        )
        const scrollToHash = (hash, smooth = true) => {
          const target = hash === '#main' ? 0 : document.getElementById(hash.slice(1))
          if (target === null) return false
          smoother.scrollTo(target, smooth, 'top top')
          return true
        }
        const onInternalLinkClick = (event) => {
          const link = event.currentTarget
          const hash = link.getAttribute('href')
          if (!hash || !scrollToHash(hash)) return

          event.preventDefault()
          window.history.pushState(null, '', hash)

          if (link.classList.contains('skip-link')) {
            document.getElementById('main')?.focus({ preventScroll: true })
          }
        }
        const onPopState = () => {
          if (window.location.hash) scrollToHash(window.location.hash)
          else smoother.scrollTo(0, true)
        }

        internalLinks.forEach((link) =>
          link.addEventListener('click', onInternalLinkClick),
        )
        window.addEventListener('popstate', onPopState)
        const initialHashFrame = window.requestAnimationFrame(() => {
          if (window.location.hash) scrollToHash(window.location.hash, false)
        })

        let lastWidth = window.innerWidth
        let resizeTimer = 0
        const onResize = () => {
          if (window.innerWidth === lastWidth) return
          lastWidth = window.innerWidth
          window.clearTimeout(resizeTimer)
          resizeTimer = window.setTimeout(() => {
            if (!cancelled) ScrollTrigger.refresh()
          }, 200)
        }
        window.addEventListener('resize', onResize)

        const sceneVisuals = gsap.utils.toArray('.scene-visual', stage)
        const connectorVisuals = new Map(
          gsap
            .utils
            .toArray('.connector-visual', stage)
            .map((visual) => [Number(visual.dataset.connectorVisual), visual]),
        )
        const copies = gsap.utils.toArray('.chapter-copy', copyStage)

        const loadAround = (index) => {
          videoController.load(`scene-${index}`, true)
          if (connectors[index]?.video) videoController.load(`connector-${index}`)
          if (index + 1 < scenes.length) videoController.load(`scene-${index + 1}`)
          if (index > 0 && connectors[index - 1]?.video) {
            videoController.load(`connector-${index - 1}`)
          }
        }

        /*
         * No scale tween on the layers. The camera move lives entirely in the
         * footage, and an extra zoom would break the frame match that makes the
         * seam cross-fades invisible.
         */
        gsap.set(sceneVisuals, { autoAlpha: 0, scale: 1 })
        gsap.set(Array.from(connectorVisuals.values()), { autoAlpha: 0, scale: 1 })
        gsap.set(sceneVisuals[0], { autoAlpha: 1 })
        gsap.set(copies.slice(1), {
          autoAlpha: 0,
          clipPath: 'inset(0 100% 0 0)',
          xPercent: -3,
        })

        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
        intro.fromTo(
          copies[0],
          { clipPath: 'inset(0 100% 0 0)', xPercent: -3 },
          { clipPath: 'inset(0 -8% 0 0)', xPercent: 0, duration: 1.05 },
          0.18,
        )

        loadAround(0)

        ScrollTrigger.create({
          trigger: experience,
          start: 'top top',
          end: 'bottom bottom',
          pin: stage,
          pinSpacing: false,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        })

        chapters.forEach((chapter, index) => {
          const tailVh = tailRunwayVh(index)

          ScrollTrigger.create({
            trigger: chapter,
            start: 'top 65%',
            end: 'bottom 65%',
            onEnter: () => setActiveScene(index),
            onEnterBack: () => setActiveScene(index),
          })

          ScrollTrigger.create({
            trigger: chapter,
            start: 'top 260%',
            once: true,
            onEnter: () => loadAround(index),
          })

          ScrollTrigger.create({
            trigger: chapter,
            start: 'top top',
            end: `bottom ${tailVh}%`,
            invalidateOnRefresh: true,
            onEnter: () => loadAround(index),
            onEnterBack: () => loadAround(index),
            onUpdate: (self) => {
              videoController.seek(`scene-${index}`, diveProgress(self.progress))
            },
          })

          if (index === 0) return

          const connectorIndex = index - 1
          const connector = connectors[connectorIndex]
          const connectorVisual = connectorVisuals.get(connectorIndex)
          const hasConnectorClip = Boolean(connector?.video && connectorVisual)
          const leadVh = hasConnectorClip
            ? connectorRunwayVh(connector.frames)
            : OUTRO_VH

          const transition = gsap.timeline({
            scrollTrigger: {
              trigger: chapter,
              start: `top ${leadVh}%`,
              end: 'top top',
              scrub: true,
              invalidateOnRefresh: true,
              onEnter: () => loadAround(index),
              onEnterBack: () => loadAround(index - 1),
              onUpdate: (self) => {
                if (hasConnectorClip) {
                  videoController.seek(
                    `connector-${connectorIndex}`,
                    connectorProgress(self.progress),
                  )
                }
              },
            },
          })

          transition.to(
            copies[index - 1],
            { autoAlpha: 0, xPercent: -3, duration: 0.12, ease: 'none' },
            0,
          )

          if (hasConnectorClip) {
            transition
              .to(
                sceneVisuals[index - 1],
                { autoAlpha: 0, duration: CONNECTOR_LEAD, ease: 'none' },
                0,
              )
              .fromTo(
                connectorVisual,
                { autoAlpha: 0, immediateRender: false },
                { autoAlpha: 1, duration: CONNECTOR_LEAD, ease: 'none' },
                0,
              )
              .fromTo(
                sceneVisuals[index],
                { autoAlpha: 0, immediateRender: false },
                { autoAlpha: 1, duration: CONNECTOR_TAIL, ease: 'none' },
                1 - CONNECTOR_TAIL,
              )
              .to(
                connectorVisual,
                { autoAlpha: 0, duration: CONNECTOR_TAIL, ease: 'none' },
                1 - CONNECTOR_TAIL,
              )
          } else {
            transition
              .to(
                sceneVisuals[index - 1],
                { autoAlpha: 0, duration: 1, ease: 'none' },
                0,
              )
              .fromTo(
                sceneVisuals[index],
                { autoAlpha: 0, immediateRender: false },
                { autoAlpha: 1, duration: 1, ease: 'none' },
                0,
              )
          }

          transition.to(
            copies[index],
            {
              autoAlpha: 1,
              clipPath: 'inset(0 -8% 0 0)',
              xPercent: 0,
              duration: 0.28,
              ease: 'power2.out',
            },
            0.68,
          )
        })

        document.fonts?.ready.then(() => {
          if (!cancelled) ScrollTrigger.refresh()
        })

        return () => {
          cancelled = true
          intro.kill()
          window.clearTimeout(resizeTimer)
          window.removeEventListener('resize', onResize)
          internalLinks.forEach((link) =>
            link.removeEventListener('click', onInternalLinkClick),
          )
          window.removeEventListener('popstate', onPopState)
          window.cancelAnimationFrame(initialHashFrame)
          smoother.kill()
          videoController.destroy()
          chapters.forEach((chapter) => chapter.removeAttribute('aria-hidden'))
        }
      },
    )

    mm.add(
      '(max-width: 860px) and (prefers-reduced-motion: no-preference)',
      () => {
        let cancelled = false
        const root = document.documentElement
        const videoController = createVideoController(mobileStage, {
          mobile: true,
          maxConcurrentLoads: 1,
        })
        const chapters = gsap.utils.toArray('.chapter', experience)
        const sceneVisuals = gsap.utils.toArray('.scene-visual', mobileStage)
        const connectorVisuals = new Map(
          gsap
            .utils
            .toArray('.connector-visual', mobileStage)
            .map((visual) => [Number(visual.dataset.connectorVisual), visual]),
        )
        const copies = gsap.utils.toArray('.chapter-copy', copyStage)

        ScrollSmoother.get()?.kill()
        ScrollTrigger.config({
          ignoreMobileResize: true,
          autoRefreshEvents: 'visibilitychange,DOMContentLoaded,load',
        })

        root.classList.add('is-mobile-cinematic')
        copyStage.classList.add('is-mobile-copy')
        chapters.forEach((chapter) => chapter.setAttribute('aria-hidden', 'true'))

        const loadScene = (index) => {
          if (index < 0 || index >= scenes.length) return
          videoController.load(`scene-${index}`, true)
          if (index > 0 && connectors[index - 1]?.mobileVideo) {
            videoController.load(`connector-${index - 1}`)
          }
        }

        const loadAhead = (index) => {
          if (connectors[index]?.mobileVideo) {
            videoController.load(`connector-${index}`)
          }
          if (index + 1 < scenes.length) {
            videoController.load(`scene-${index + 1}`)
          }
        }

        /*
         * Portrait clips own all camera motion. Copy and header are the static
         * anchors; the only supporting motion is the vertical mask handoff.
         */
        gsap.set(sceneVisuals, { autoAlpha: 0, scale: 1 })
        gsap.set(Array.from(connectorVisuals.values()), {
          autoAlpha: 0,
          scale: 1,
        })
        gsap.set(sceneVisuals[0], { autoAlpha: 1 })
        gsap.set(copies, {
          autoAlpha: 0,
          clipPath: 'inset(100% 0 0 0)',
          xPercent: 0,
          yPercent: 4,
        })

        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
        intro.fromTo(
          copies[0],
          {
            autoAlpha: 0,
            clipPath: 'inset(100% 0 0 0)',
            yPercent: 4,
          },
          {
            autoAlpha: 1,
            clipPath: 'inset(-8% 0 0 0)',
            yPercent: 0,
            duration: 0.9,
          },
          0.12,
        )

        loadScene(0)

        const onFirstGesture = () => {
          videoController.prime()
          window.removeEventListener('pointerdown', onFirstGesture)
          window.removeEventListener('touchstart', onFirstGesture)
        }
        window.addEventListener('pointerdown', onFirstGesture, {
          passive: true,
          once: true,
        })
        window.addEventListener('touchstart', onFirstGesture, {
          passive: true,
          once: true,
        })

        ScrollTrigger.create({
          trigger: experience,
          start: 'top top',
          end: 'bottom bottom',
          pin: mobileStage,
          pinSpacing: false,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        })

        chapters.forEach((chapter, index) => {
          const tailVh = mobileTailRunwayVh(index)
          const diveState = { progress: 0 }

          ScrollTrigger.create({
            trigger: chapter,
            start: 'top 62%',
            end: 'bottom 62%',
            onEnter: () => setActiveScene(index),
            onEnterBack: () => setActiveScene(index),
          })

          gsap.to(diveState, {
            progress: 1,
            ease: 'none',
            onUpdate: () => {
              videoController.seek(
                `scene-${index}`,
                diveProgress(diveState.progress),
              )
              if (diveState.progress > 0.22) loadAhead(index)
            },
            scrollTrigger: {
              trigger: chapter,
              start: 'top top',
              end: `bottom ${tailVh}%`,
              scrub: 0.48,
              invalidateOnRefresh: true,
              onEnter: () => loadScene(index),
              onEnterBack: () => loadScene(index),
            },
          })

          if (index === 0) return

          const connectorIndex = index - 1
          const connector = connectors[connectorIndex]
          const connectorVisual = connectorVisuals.get(connectorIndex)
          const hasConnectorClip = Boolean(
            connector?.mobileVideo && connectorVisual,
          )
          const leadVh = hasConnectorClip
            ? mobileConnectorRunwayVh(
                connector.mobileFrames || connector.frames,
              )
            : mobileTailRunwayVh(connectorIndex)
          const connectorState = { progress: 0 }

          const transition = gsap.timeline({
            scrollTrigger: {
              trigger: chapter,
              start: `top ${leadVh}%`,
              end: 'top top',
              scrub: 0.55,
              invalidateOnRefresh: true,
              onEnter: () => {
                loadAhead(index - 1)
                loadScene(index)
              },
              onEnterBack: () => {
                loadScene(index - 1)
                loadAhead(index - 1)
              },
            },
          })

          if (hasConnectorClip) {
            transition.to(
              connectorState,
              {
                progress: 1,
                duration: 1,
                ease: 'none',
                onUpdate: () => {
                  videoController.seek(
                    `connector-${connectorIndex}`,
                    connectorProgress(connectorState.progress),
                  )
                },
              },
              0,
            )
          }

          transition.to(
            copies[index - 1],
            {
              autoAlpha: 0,
              yPercent: -3,
              duration: 0.14,
              ease: 'none',
            },
            0,
          )

          if (hasConnectorClip) {
            transition
              .to(
                sceneVisuals[index - 1],
                { autoAlpha: 0, duration: CONNECTOR_LEAD, ease: 'none' },
                0,
              )
              .fromTo(
                connectorVisual,
                { autoAlpha: 0, immediateRender: false },
                { autoAlpha: 1, duration: CONNECTOR_LEAD, ease: 'none' },
                0,
              )
              .fromTo(
                sceneVisuals[index],
                { autoAlpha: 0, immediateRender: false },
                { autoAlpha: 1, duration: CONNECTOR_TAIL, ease: 'none' },
                1 - CONNECTOR_TAIL,
              )
              .to(
                connectorVisual,
                { autoAlpha: 0, duration: CONNECTOR_TAIL, ease: 'none' },
                1 - CONNECTOR_TAIL,
              )
          } else {
            transition
              .to(
                sceneVisuals[index - 1],
                { autoAlpha: 0, duration: 1, ease: 'none' },
                0,
              )
              .fromTo(
                sceneVisuals[index],
                { autoAlpha: 0, immediateRender: false },
                { autoAlpha: 1, duration: 1, ease: 'none' },
                0,
              )
          }

          transition.to(
            copies[index],
            {
              autoAlpha: 1,
              clipPath: 'inset(-8% 0 0 0)',
              yPercent: 0,
              duration: 0.26,
              ease: 'power2.out',
            },
            0.66,
          )
        })

        let lastWidth = window.innerWidth
        let resizeTimer = 0
        const refreshSoon = () => {
          window.clearTimeout(resizeTimer)
          resizeTimer = window.setTimeout(() => {
            if (!cancelled) ScrollTrigger.refresh()
          }, 240)
        }
        const onResize = () => {
          if (window.innerWidth === lastWidth) return
          lastWidth = window.innerWidth
          refreshSoon()
        }
        const onOrientationChange = () => refreshSoon()
        window.addEventListener('resize', onResize)
        window.addEventListener('orientationchange', onOrientationChange)

        const initialRefreshFrame = window.requestAnimationFrame(() => {
          if (!cancelled) ScrollTrigger.refresh()
        })
        document.fonts?.ready.then(() => {
          if (!cancelled) ScrollTrigger.refresh()
        })

        return () => {
          cancelled = true
          intro.kill()
          window.clearTimeout(resizeTimer)
          window.cancelAnimationFrame(initialRefreshFrame)
          window.removeEventListener('resize', onResize)
          window.removeEventListener('orientationchange', onOrientationChange)
          window.removeEventListener('pointerdown', onFirstGesture)
          window.removeEventListener('touchstart', onFirstGesture)
          videoController.destroy()
          root.classList.remove('is-mobile-cinematic')
          copyStage.classList.remove('is-mobile-copy')
          chapters.forEach((chapter) => chapter.removeAttribute('aria-hidden'))
        }
      },
    )

    return () => {
      mm.revert()
    }
    // portraitStage decides which stage holds the media elements, so the
    // controllers have to be rebuilt against the tree that actually has them.
  }, [isReady, portraitStage])

  if (!isReady) {
    return <LoadingScreen onReady={() => setIsReady(true)} />
  }

  const activeAlign = scenes[activeScene]?.align || 'left'
  const sideClass = activeAlign.startsWith('right') ? 'is-right' : 'is-left'

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex="-1">
        <DesktopCopyStage copyStageRef={copyStageRef} activeScene={activeScene} />
        <RouteRail activeScene={activeScene} />
        <div id="smooth-wrapper" ref={smoothWrapperRef}>
          <div id="smooth-content" ref={smoothContentRef}>
            <section
              className="experience"
              ref={experienceRef}
              aria-label="digiVance selected work"
            >
              <VisualStage
                stageRef={stageRef}
                sideClass={sideClass}
                variant="desktop"
                active={!portraitStage}
              />
              <VisualStage
                stageRef={mobileStageRef}
                sideClass="is-mobile"
                variant="mobile"
                active={portraitStage}
              />
              <div className="chapters">
                {scenes.map((scene, index) => (
                  <Chapter scene={scene} index={index} key={scene.id} />
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  )
}

export default App
