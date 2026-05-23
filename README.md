# Roam — Infinite Canvas

> **Posts as spaces.** An infinite, zoomable, pannable 2D canvas block for WordPress. Built for Plugin Jam May 2026 — theme: **Unbound**.

Every blog post is a column. Same width, same direction, same starting point. Twenty-five years of the web has been a single tall stack of paragraphs falling steadily into the void.

Roam asks: *what if the post was a place you could walk through?*

---

## What it does

Roam adds a `Roam Canvas` block that turns the post body into a navigable space. Two modes:

- **Nested zoom (recommended).** Each section is a tier in a continuous Russian-doll infinite-zoom. The reader scrolls into a section and it becomes the whole world; the next section starts as a single pixel inside it and grows. Like those infinite-zoom artworks — but every tier is a real Gutenberg block tree.
- **Free positioning (legacy).** Drop nodes anywhere on an 8K × 6K plane. Readers drag to pan, wheel/pinch to zoom.

No build step. No external services. No tracking. Vanilla JS + PHP + CSS. The plugin is a single zip.

## Blocks

| Block | Purpose |
| --- | --- |
| `roam/canvas`  | Top-level container. In nested-zoom mode, wraps its child sections in the infinite zoom (composed by a PHP render callback on the frontend). |
| `roam/section` | Stacked editable container for nested-zoom canvases. In the editor, sections render as collapsible cards with a sticky tab-bar for quick jumping between tiers. On the frontend each becomes a zoom tier. |
| `roam/node`    | Free-positioned node (drag in editor, absolute on frontend). For the non-nested mode. |

## Installation

### From a zip

1. Download `roam.zip` from [Releases](https://github.com/jnealey-godaddy/roam/releases) (or build one yourself — see below).
2. WordPress admin → **Plugins → Add New → Upload Plugin**.
3. Activate.

### From source

```sh
cd wp-content/plugins
git clone https://github.com/jnealey-godaddy/roam.git
```

Then activate `Roam — Infinite Canvas` in the plugins screen.

### Building a zip

```sh
# from the repo root
zip -r roam.zip . -x ".git/*" "*.DS_Store"
```

## Usage

1. Create a new post.
2. Insert a **Roam Canvas** block.
3. In the block inspector → **Presentation**, turn on **Nested-zoom navigation** and **Fullscreen**. Add an initial anchor if you want a specific section to be the first frame.
4. The canvas seeds itself with two Roam Section children — your hero and a detail tier. Use the sticky tab-bar at the top of the canvas to jump between them; click any section header to collapse/expand it. Add more sections from the **+ section** button.
5. Inside each section, drop in *anything Gutenberg knows* — headings, paragraphs, columns, buttons, images. The frontend renders each section as a 1280×720 frame scaled into a tier of the world.
6. Publish.

On the frontend the reader scrolls to dive. Each tier appears as a pixel inside the previous, grows until it fills the viewport, and then becomes the world for the next dive. Click any anchored link inside a section to fly straight to that tier.

## Settings

Roam Canvas block inspector → **Presentation**:

- **View mode** — *Boxed* (16:10 frame inline with post) or *Fullscreen* (fixed overlay).
- **Show anchor menu** — Floating jump-menu listing every section.
- **Initial anchor** — Tier to frame on load.
- **Nested-zoom navigation** — On = infinite-zoom dive on scroll. Off = pan/zoom canvas.
- **Transition (ms)** — Easing duration for fly-to-anchor.

Roam Section block inspector → **Section** & **Background**:

- **Anchor name** — Short ID (`hero`, `features`). Used by the anchor menu and links.
- **Menu label** — Friendly text shown in the anchor menu.
- **Background colour / Custom gradient / Accent colour** — Per-tier theming. Defaults to a per-tier gradient so an empty canvas already looks like a real landing page.

## Technical notes

- **Vanilla JS, no build step.** Editor scripts use `wp.element.createElement` directly (no JSX). Block registration via `block.json` (apiVersion 3).
- **Frontend rendering for nested zoom** is dynamic — `roam_render_canvas` (in `roam.php`) walks the section markup and composes the world wrapper + per-tier positioning. The block save just persists the section content; PHP composes the world.
- **Float-32 stable**. At deep zoom (z = 250,000+), the dive point is held at the world origin so the composed CSS transform matrix stays in float-32 range — no jitter or shake.
- **Editor UX**: in nested-zoom mode, sections stack as collapsible cards (only the active tier expands by default) with a sticky tab-bar so any tier is one click away, no matter how tall the hero is.

## Requirements

- WordPress 6.4+
- PHP 7.4+

## License

GPL-2.0-or-later.

## Credits

Built for [Plugin Jam May 2026](https://pluginjam.com) — theme **Unbound** (blocks that defy WordPress / Gutenberg constraints).
