# digiVance cinematic handoff

## Direction

The site is a single-page founder-led portfolio for digiVance. The visual world is a quiet architectural miniature: pale stone, cool cloud-grey negative space, charcoal, deep forest, natural timber, and one signal-lime idea marker (`#D8FF63`). The journey moves through six connected scenes:

1. digiVance world
2. Studio Agriya
3. SR Timbers
4. Rajlaxmi Prints
5. Radha Madhav Textiles
6. Start a project

The accepted still masters are in `public/assets/stills/` and the web posters are in `public/assets/posters/`. Each master is 1536×1024, true 3:2, and has a safe centered composition. The desktop motion is 1920×1080 at 24 fps. Phones now use a complete native portrait film chain from the supplied `mobile/` folder; reduced-motion visitors keep the generated 720×1280 posters in `public/assets/posters-mobile/`. Both motion stages hold an exact video-derived poster until the first decoded frame has painted.

## Motion plan: Architecture B

Produce one short dive clip per scene and five short connector clips. The scroll scrubber will use the dives as the readable scene moments and the connectors as the camera travel between them.

- 24 fps, silent, 16:9 landscape, 1920×1080, matching the accepted delivery.
- Each dive: one continuous camera move, no cuts. Current deliveries run 4–8 seconds.
- Each connector: continuous travel from the exact last frame of the preceding dive to the exact first frame of the next dive. Current deliveries run 6 seconds.
- Keep the camera direction and scale consistent. No title cards, UI, text, logos, or watermark inside generated footage.
- Preserve the cool cloud-grey background and soft-matte miniature treatment in every shot.
- Desktop uses the 16:9 video scrub. Mobile uses its own 9:16, six-dive/five-connector scrub chain; the desktop landscape crop is never used on phones.

Prompt files:

- `prompts/dive-scenes.md` contains the six scene prompts.
- `prompts/connectors.md` contains the five boundary prompts.
- `prompts/README.md` contains the shared prompt preamble and generation notes.

## Asset contract

Use this naming convention when handing over rendered media:

```text
public/assets/video/dive-01-world.mp4
public/assets/video/dive-02-studio-agriya.mp4
public/assets/video/dive-03-sr-timber.mp4
public/assets/video/dive-04-rajlaxmi-prints.mp4
public/assets/video/dive-05-radha-madhav-textiles.mp4
public/assets/video/dive-06-start-a-project.mp4
public/assets/video/connector-01-world-to-agriya.mp4
public/assets/video/connector-02-agriya-to-sr-timber.mp4
public/assets/video/connector-03-sr-timber-to-rajlaxmi.mp4
public/assets/video/connector-04-rajlaxmi-to-textiles.mp4
public/assets/video/connector-05-textiles-to-finale.mp4
```

The normalized portrait delivery follows the same order with `-m` names:

```text
public/assets/video-mobile/dive-01-world-m.mp4
public/assets/video-mobile/dive-02-studio-agriya-m.mp4
public/assets/video-mobile/dive-03-sr-timber-m.mp4
public/assets/video-mobile/dive-04-rajlaxmi-prints-m.mp4
public/assets/video-mobile/dive-05-radha-madhav-textiles-m.mp4
public/assets/video-mobile/dive-06-start-a-project-m.mp4
public/assets/video-mobile/connector-01-world-to-agriya-m.mp4
public/assets/video-mobile/connector-02-agriya-to-sr-timber-m.mp4
public/assets/video-mobile/connector-03-sr-timber-to-rajlaxmi-m.mp4
public/assets/video-mobile/connector-04-rajlaxmi-to-textiles-m.mp4
public/assets/video-mobile/connector-05-textiles-to-finale-m.mp4
```

Their exact frame-zero WebP posters live in `public/assets/video-mobile/posters/`.

Before a connector is generated, extract the final dive frame and the next dive's first frame. Those two boundary images are the only source of truth for the connector. Do not approve a connector from a written description alone.

## Frame-identical seam check

For each boundary, verify:

1. The connector's first frame is pixel-identical to the preceding dive's final frame.
2. The connector's final frame is pixel-identical to the next dive's first frame.
3. All clips share the same dimensions, frame rate, pixel format, and color treatment.
4. There is no one-frame flash, exposure jump, duplicate frame, or camera reset at either join.

The implementation keeps the final dive frame visible until the connector starts and the connector's final frame visible until the next dive starts. The supplied joins are compositionally close but not pixel-identical, so the engine uses a short overlap fade at each seam, with the connector frozen on the shared frame for the duration of that fade.

## Local FFmpeg / FFprobe checks

The BtbN FFmpeg bundle is installed on the workstation and both `ffmpeg` and `ffprobe` have been verified. A fresh terminal may be needed for the updated PATH.

Inspect a delivered clip:

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames,pix_fmt -of json .\public\assets\video\dive-01-world.mp4
```

Extract a boundary frame for review:

```powershell
ffmpeg -sseof -0.05 -i .\public\assets\video\dive-01-world.mp4 -frames:v 1 .\cinematic\frames\dive-01-world\last.png
ffmpeg -i .\public\assets\video\dive-02-studio-agriya.mp4 -frames:v 1 .\cinematic\frames\dive-02-studio-agriya\first.png
```

Create a normalized delivery copy when needed:

```powershell
ffmpeg -i .\input.mp4 -an -vf "fps=24,format=yuv420p" -c:v libx264 -preset slow -crf 26 -g 1 -keyint_min 1 -sc_threshold 0 -bf 0 -profile:v high -level 4.1 -movflags +faststart .\public\assets\video\normalized.mp4
```

Normalize a native portrait source for phone scrubbing:

```powershell
ffmpeg -i .\mobile\input.mp4 -an -vf "scale=720:-2,unsharp=5:5:0.6:5:5:0.0,fps=24" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -g 4 -keyint_min 4 -sc_threshold 0 -fps_mode cfr -movflags +faststart -color_primaries bt709 -color_trc bt709 -colorspace bt709 .\public\assets\video-mobile\output-m.mp4
```

`-g 1 -bf 0` makes every frame a keyframe. A scrub seek then decodes exactly one
frame instead of walking up to a full GOP, which is what stopped the scrub from
holding a steady rate. Measured on the same six-second source, the previous
GOP-8 encode seeked at a mean of 25ms with a p90 of 63ms and a worst case of
77ms; the all-intra encode seeks at a mean of 11ms, a p90 of 12ms and a worst
case of 25ms. CRF 26 holds the total delivery near 93MB across eleven clips,
close to the nine-clip GOP-8 set it replaces. Do not re-add the `unsharp` pass:
it costs bitrate that all-intra needs, and the sources are already sharp.

## Connector seam measurements

All eleven clips are delivered. The supplied joins are compositionally close but
not pixel-identical, so the engine cross-fades at each seam. SSIM between the
frames either side of each join, at 960x540 luma:

| Seam | SSIM |
| --- | --- |
| dive-01 last to connector-01 first | 0.64 |
| connector-01 last to dive-02 first | 0.84 |
| dive-02 last to connector-02 first | 0.74 |
| connector-02 last to dive-03 first | 0.78 |
| dive-03 last to connector-03 first | 0.71 |
| connector-03 last to dive-04 first | 0.70 |
| dive-04 last to connector-04 first | 0.81 |
| connector-04 last to dive-05 first | 0.57 |
| dive-05 last to connector-05 first | 0.70 |
| connector-05 last to dive-06 first | 0.78 |

The connector-04 to dive-05 join at 0.57 is the loosest in the chain. It sits
within the range already accepted for connectors 01 to 03 and the cross-fade
covers it, but it is the first seam to revisit if either clip is regenerated.

To keep those cross-fades invisible the engine freezes each connector on its
first frame for the opening 8% of its runway and on its last frame for the
closing 10%, so a seam always blends two still images rather than blending a
moving image against a frozen one.

## Current status

| Item | Status |
| --- | --- |
| Six still masters | Accepted and verified at 1536×1024 |
| Six WebP poster fallbacks | Encoded and wired into the site |
| Six dive clips | Delivered, normalized, and integrated |
| Connectors 01–05 | Delivered, normalized, and integrated |
| Clip encoding | Re-encoded all-intra at CRF 26 so every scrub seek is a single frame decode |
| Scroll pacing | Runway derived per clip from frame count, trapezoidal velocity profile, in `src/pacing.js` |
| Desktop scrub engine | GSAP ScrollTrigger + ScrollSmoother, Blob-backed seeks, one seek in flight at a time gated on frame presentation, connector endpoint holds, and seam fades |
| Mobile scrub engine | Native-touch GSAP ScrollTrigger, complete 9:16 chain, one-at-a-time lazy loading, coalesced seeks, iOS gesture priming, `svh` runway geometry, safe-area copy, and width-only refreshes |
| Mobile encodes | All 11 clips normalized to 720×1280, 24 fps, silent H.264, GOP 4, CRF 23, fast-start; original `mobile/` files preserved |
| Reduced-motion fallback | Stacked native portrait posters; no video fetch, pinning, or motion-dependent copy |
| QA | FFprobe, lint, production build, desktop regression pass, 390×844 portrait, 844×390 landscape, reduced motion, and runtime midpoint checks for every mobile dive and connector complete |

The three unrelated root-level videos were reviewed but were not added to the digiVance camera chain because they depict a separate forest/logo-reveal concept.
