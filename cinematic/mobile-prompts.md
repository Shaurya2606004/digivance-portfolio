# digiVance mobile scroll-film prompts

These prompts are for a second, native portrait chain. Render the mobile scenes in **9:16**; do not make a center-crop of the desktop 16:9 clips.

## Shared style preamble

Use this preamble verbatim at the start of every prompt:

```text
Create a native portrait cinematic scroll-scrub clip for digiVance, an independent digital practice that turns real business needs into clear websites and focused digital tools. Match the supplied digiVance visual references: cloud green #e8ece7, soft mist #f1f4f0, deep ink #161a18, forest #2d4a3e and signal lime #d8ff63. The tone is direct, tactile, precise and premium.

Format 9:16 portrait, 1080x1920 master, 24 fps, silent, no audio. Compose the focal subject inside the central 70% of the frame. Keep the top 15% and bottom 20% visually quiet for HTML copy, browser chrome and the home indicator. Keep important objects away from the extreme left and right edges. Make the composition safe for a 4:5 crop without relying on the crop.

One continuous camera move, no hard cuts. Use restrained motion: slow push-in, gentle vertical drift, controlled parallax or a calm rise-and-reveal. Include a clean opening hold, one clear hero moment and a clean ending hold so the clip feels intentional when scrubbed by a finger. Preserve supplied screenshots, logos and interface layouts as visual references; do not invent UI copy. All typography, buttons and project descriptions remain separate HTML overlays.
```

## Six portrait dive prompts

For each dive, use that scene's **portrait start frame** as the exact first frame. Keep the final frame stable enough to hand to the next connector.

### 01 — digiVance / world

```text
[SHARED STYLE PREAMBLE]
Use the supplied digiVance portrait start frame exactly. Begin above a connected miniature world that brings together architecture, timber, print and textile details. Descend slowly through one central visual thread, revealing small interface fragments and material cues without clutter. Settle on a calm, spacious central composition for the digiVance title. The last second is a gentle hold with no new objects and no camera shake.
```

### 02 — Studio Agriya

```text
[SHARED STYLE PREAMBLE]
Use the supplied Studio Agriya portrait start frame exactly. Begin with the full architectural studio world, then make a measured vertical descent toward the model home and material library. Let the geometry open with subtle depth and parallax; preserve the supplied website capture and logo as references. Resolve into a clean hero frame with quiet space above and below for HTML copy. No fast rotation, no invented text, no layout distortion.
```

### 03 — SR Timbers

```text
[SHARED STYLE PREAMBLE]
Use the supplied SR Timbers portrait start frame exactly. Begin with a close tactile view of natural timber grain and stacked hardwood, then drift upward and inward toward the vertical digital business card. Keep the card centered and readable, with warm natural light and restrained paper-and-wood texture. End on a stable portrait frame where the card is fully legible and the lower safe area remains uncluttered.
```

### 04 — Rajlaxmi Prints

```text
[SHARED STYLE PREAMBLE]
Use the supplied Rajlaxmi Prints portrait start frame exactly. Move slowly through layered paper, print swatches and catalogue selections in a single vertical composition. Build toward one clear selection moment at the central catalogue picker, then hold it. Keep swatch colors faithful, edges clean and the interface readable. No frantic browsing, no duplicate products, no fake labels or invented typography.
```

### 05 — Radha Madhav Textiles

```text
[SHARED STYLE PREAMBLE]
Use the supplied Radha Madhav Textiles portrait start frame exactly. Start at a macro textile weave, glide gently across pattern and color, then resolve into the supplied website's main storefront frame. Let fabric texture feel organic but slow, with soft folds and controlled parallax. Finish with a calm centered hold, preserving the UI and leaving the bottom safe area clear for HTML copy.
```

### 06 — Start a project / finale

```text
[SHARED STYLE PREAMBLE]
Use the supplied digiVance closing portrait start frame exactly. Bring the project worlds into a calm vertical worktable composition where four paths meet beside an inviting doorway. Drift upward slowly through the table, then settle on the digiVance contact prompt as the single hero moment. Leave the lower quarter open for the CTA and finish with a still, holdable frame. No extra objects arrive after the final hold.
```

## Five portrait connector prompts

For every connector, pass the **actual last rendered mobile frame** of Scene A as the start frame and the **actual first rendered mobile frame** of Scene B as the end frame. Do not use the original stills for connector endpoints.

```text
Create a native 9:16 portrait connector for a mobile scroll-scrub portfolio film. Use the supplied start frame as frame 0 and the supplied end frame as the final composition. One continuous camera move, 4–5 seconds, silent, no hard cut. Hold the opening and ending compositions briefly for touch scrolling and crossfade. Preserve the same lighting, color grade, scale, material language and camera direction. Add no unrelated objects, no new logos and no text. The start frame must be obeyed exactly; the end only needs to land on the same composition.
```

Use these scene-specific movement lines after the shared connector prompt:

```text
01 → 02: Lift gently out of the connected digiVance world, follow the central route upward and arrive above the Studio Agriya architectural island, beginning a slow descent toward its model home.
```

```text
02 → 03: Pull away from the architectural model, glide through a quiet field of structural lines and warm light, then arrive above the SR Timbers workshop and begin to settle toward the timber grain.
```

```text
03 → 04: Drift away from the timber workshop along the grain, transition across a clean paper surface and arrive above the Rajlaxmi Prints swatch table, keeping the camera movement slow and level.
```

```text
04 → 05: Let the paper and print swatches travel upward into a soft textile weave, then arrive above the Radha Madhav studio and begin a gentle descent toward the loom and fabric rolls.
```

```text
05 → 06: Rise slowly from the textile studio, carry the fabric colors into a quiet open space and arrive above the digiVance worktable and doorway, beginning the final settling move.
```

## Global negative prompt

```text
landscape framing, 16:9 composition, center-cropped desktop video, letterboxing, black bars, subject touching the edges, important detail under the notch or home indicator, unreadable tiny text, invented UI copy, gibberish typography, distorted logos, warped website layouts, fake buttons, rapid cuts, whip pans, shaky camera, jitter, strobing, aggressive zoom, excessive parallax, excessive motion blur, clutter behind the copy area, low contrast, harsh bloom, oversaturated colors, abrupt ending, mismatched first and last frames, inconsistent lighting, extra objects, duplicate products, watermarks, compression artifacts
```

## Mobile implementation prompt

```text
Adapt the digiVance portfolio's cinematic scroll experience for phones. Use the native 9:16 portrait clips and posters as clipMobile, connectorsMobile and stillMobile; never silently center-crop the desktop film. Keep GSAP ScrollSmoother desktop-only and use native touch scrolling on phones. Give each scene a generous scroll runway, map scroll to video time with a restrained scrub, add a short endpoint hold and a soft seam crossfade, and keep project copy in HTML over the reserved safe areas. Use muted, playsInline video, poster-first loading, lazy-load only the nearby scene, coalesce seek requests, prime videos on first touch for iOS, and fall back to portrait posters on slow or reduced-motion devices. Serve a 720x1280 mobile encode with a short GOP for phones, while keeping the 1080x1920 master for higher-quality exports.
```
