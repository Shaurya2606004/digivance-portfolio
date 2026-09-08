# digiVance portfolio

Single-page portfolio site for digiVance, a founder-led studio designing and building useful digital products for growing businesses.

## Run locally

```powershell
npm install
npm run dev
```

The production check is:

```powershell
npm run lint
npm run build
```

## Experience

- Desktop: a pinned, GSAP-powered, video-scrubbed journey through six project chapters and five connectors. GSAP ScrollSmoother eases native scroll input at `smooth: 0.8` and `speed: 1`. Clips are fetched as blobs on demand for reliable seeking.
- Pacing: `src/pacing.js` is the single source of truth. Desktop and mobile runway lengths are derived from the real frame counts for each chain. Mobile uses the slower `MOBILE_FRAMES_PER_VH` rate plus a short scrub catch-up so fast touch flicks do not skip the hero frames. Within a clip, progress follows a trapezoidal velocity profile (ramp up, constant cruise, ramp down).
- Mobile: a dedicated native 9:16 GSAP ScrollTrigger chain uses all six portrait dives and five portrait connectors. It keeps native touch scrolling, loads one Blob-backed clip at a time, coalesces seeks, primes muted video after the first gesture for iOS, and ignores height-only browser-bar resizes.
- Reduced motion: video loading and pinning are removed entirely; the page becomes the lightweight stacked portrait-poster presentation with the same copy and hierarchy.
- Posters: `public/assets/posters/` contains desktop stills, `public/assets/posters-mobile/` contains the generated static portrait fallbacks, and `public/assets/video-mobile/posters/` contains exact first-frame posters for the portrait videos. Original 3:2 PNG masters live in `public/assets/stills/` for future video conditioning.
- Motion handoff: see `cinematic/HANDOFF.md` for delivered media, seam checks, and FFmpeg commands.
- Encoding: desktop clips remain 1920×1080, 24 fps, all-intra (`-g 1 -bf 0`, CRF 26). Mobile clips are 720×1280, 24 fps, silent H.264 with four-frame GOPs (`-g 4`, CRF 23), `faststart`, and Rec.709 metadata.

## Before launch

- Replace the working contact placeholder `hello@digivance.in` in `src/content.js` with the final inbox.
- Live projects: [Studio Agriya](https://studio-agriya.vercel.app/), [SR Timbers](https://srtimbers.com), [Rajlaxmi Prints](https://rajlaxmi-prints.vercel.app) and [Radha Madhav Textiles](https://radha-madhav-textiles.vercel.app/).

## FFmpeg bundle

Both `ffmpeg` and `ffprobe` were verified from the installed BtbN FFmpeg bundle. If a fresh terminal does not resolve them by name, use the installed bundle's `bin` directory explicitly or open a new terminal so the updated PATH is loaded.
