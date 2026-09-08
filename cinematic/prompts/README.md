# Prompt notes

Use the same preamble and negative constraints in every generation. The six accepted stills define the visual world; the video prompts add only camera motion and small physical gestures.

## Shared preamble

```text
Use case: stylized-concept. Asset type: silent cinematic portfolio motion clip, one continuous shot, wide 3:2 landscape. Use the supplied scene still as a strict visual reference for style, composition, materials, lighting, color, and scale; do not redesign the set. Preserve the exact cool cloud-grey solid background, pale-stone miniature island, elevated isometric three-quarter camera language, soft-matte architectural-diorama finish, diffuse studio daylight, gentle ambient occlusion, long feathered shadows, charcoal and deep forest details, natural muted timber, and one restrained signal-lime accent. Keep every essential object inside the safe central 75% of frame. No people, text, letters, numbers, logos, watermark, signage, readable UI, or hard cuts. Silent output. The camera move must be physically continuous and end in a stable frame that can be joined to another clip.
```

Generate at 24 fps for 3.0–4.0 seconds. Keep motion restrained: camera travel and natural parallax first, object animation second. Do not add new objects that are absent from the still. Use a 1920×1280 delivery when the renderer supports it.

The stills are intentionally the source of truth. If a rendered clip changes object count, background color, camera height, or material character, reject it and regenerate from the reference still.
