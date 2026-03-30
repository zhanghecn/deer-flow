# Seedream Prompt Examples

Use this template file when the request matches a common `doubao-seedream-5.x`
scenario and you want a stronger starting prompt than a blank JSON file.

These patterns are adapted from Volcengine's public Seedream documentation and
official developer articles. Keep the final prompt in English when executing the
skill, even if the user asks in Chinese.

## Core Prompt Pattern

Use this order when you need a compact but reliable prompt:

1. Subject
2. Scene
3. Style
4. Lighting
5. Camera / angle
6. Material / texture / details
7. Negative prompt

Minimal schema:

```json
{
  "prompt": "Primary subject and action in the target scene",
  "style": "Visual style and rendering direction",
  "composition": "Framing, lens feel, camera angle, subject placement",
  "lighting": "Time of day, contrast, shadow quality, mood",
  "color_palette": "Key palette and color temperature",
  "negative_prompt": "Artifacts and unwanted elements"
}
```

## Example 1: Food / Product Hero Shot

Inspired by Volcengine's official cake poster example.

```json
{
  "prompt": "A black forest cake centered on a rustic wooden table, topped with glossy cherries and layered chocolate shavings, rich cream texture, premium dessert advertising shot",
  "style": "high-end food photography, realistic commercial lighting, rich detail",
  "composition": "top-down close shot, centered subject, balanced layout, shallow depth of field",
  "lighting": "soft studio key light with controlled shadows, warm highlights on the cherries and cream",
  "color_palette": "deep chocolate brown, cherry red, cream white, warm wood tones",
  "negative_prompt": "messy plate, extra desserts, blurry texture, deformed food, text, watermark"
}
```

## Example 2: Style Transfer / Artistic Remix

Inspired by Volcengine's official Van Gogh style transfer example.

Use this when the user gives you a reference image and asks for a painterly or
strong visual-language transformation.

```json
{
  "prompt": "Transform the input scene into a Van Gogh inspired painting while preserving the main composition and horizon line, swirling expressive brushwork, vivid stars and cloud patterns, emotionally intense texture",
  "style": "post-impressionist oil painting, Van Gogh visual language, hand-painted texture",
  "composition": "preserve the original framing while exaggerating motion in the sky and sea",
  "lighting": "dramatic twilight glow with luminous sky accents",
  "color_palette": "cobalt blue, ultramarine, sunflower yellow, orange highlights",
  "negative_prompt": "photorealistic rendering, flat color blocks, low detail, washed-out sky, text"
}
```

## Example 3: Character IP / Consistent Visual Identity

Inspired by Volcengine's official Wang Zhaojun / IP adaptation examples.

Use this when the user wants a recognizable character rendered in a stable style
across multiple iterations.

```json
{
  "prompt": "Create a refined character key visual of an elegant historical heroine with a calm expression, recognizable silhouette, ornamental costume details, long flowing sleeves, premium collectible IP design quality",
  "style": "high-detail Chinese fantasy illustration, polished character concept art",
  "composition": "full-body character sheet style hero pose, clean readable silhouette, centered figure",
  "lighting": "soft cinematic rim light with gentle facial fill light",
  "color_palette": "jade green, ivory, muted gold, subtle crimson accents",
  "technical": {
    "detail_level": "highly detailed fabrics, ornaments, and embroidery"
  },
  "negative_prompt": "extra fingers, asymmetric face, broken costume, muddy accessories, blurry eyes, text"
}
```

## Example 4: Editorial / Academic Cover Image

Inspired by Volcengine's official journal cover example.

Use this when the user needs a polished key visual for a report, cover, or
poster, especially when the main task is atmosphere and layout rather than
literal text rendering.

```json
{
  "prompt": "A premium academic cover image about intelligent medical imaging, translucent anatomical forms blended with futuristic diagnostic interfaces, abstract data ribbons, precise and trustworthy visual tone",
  "style": "editorial science illustration, premium journal cover aesthetic, clean and sophisticated",
  "composition": "strong central focal point with supporting scientific visual motifs arranged around it, generous negative space for later layout",
  "lighting": "cool diffused studio lighting with subtle glow accents",
  "color_palette": "sterile white, icy cyan, deep navy, metallic silver",
  "negative_prompt": "cartoon style, chaotic layout, excessive lens flare, distorted anatomy, watermark"
}
```

## Example 5: Multi-Reference Image Editing

Seedream supports multiple reference images in official image editing flows. Use
this when the user provides several references for subject, costume, material,
or background control.

```json
{
  "prompt": "Combine the main character identity from the first reference image, the costume design language from the second reference image, and the premium studio product lighting from the third reference image into one cohesive hero image",
  "style": "high-end cinematic commercial still",
  "composition": "single primary subject, clean hierarchy, strong silhouette separation",
  "lighting": "soft key light, controlled edge light, subtle background falloff",
  "negative_prompt": "duplicate subjects, mixed anatomy, messy costume merge, low detail, text"
}
```

## Usage Notes

- Prefer one strong scene objective per prompt. Do not mix poster, portrait,
  product, and landscape goals in a single generation request unless the user
  explicitly wants that.
- If the user asks for image editing, describe what should be preserved from the
  reference image and what should change.
- When text must appear in the final design, describe layout and reserve space
  first; exact typographic rendering is still less reliable than manual post-editing.
