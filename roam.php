<?php
/**
 * Plugin Name:       Roam — Infinite Canvas
 * Description:       An infinite, zoomable, pannable 2D canvas block. Drop content anywhere on an x/y plane. Readers pan and zoom instead of scrolling. Built for Plugin Jam May 2026 — theme: Unbound.
 * Version:           1.7.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Plugin Jam May 2026
 * License:           GPL-2.0-or-later
 * Text Domain:       roam
 *
 * @package Roam
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register the three Roam blocks.
 *
 * - roam/canvas    Top-level container; in nested-zoom mode, wraps children in the infinite-zoom layout.
 * - roam/node      Free-positioned node (drag in editor, absolute on frontend). For non-nested canvases.
 * - roam/section   Stacked editable container (acts like core/group in editor). For nested-zoom canvases.
 */
function roam_register_blocks() {
	register_block_type(
		__DIR__ . '/canvas',
		array( 'render_callback' => 'roam_render_canvas' )
	);
	register_block_type( __DIR__ . '/node' );
	register_block_type( __DIR__ . '/section' );
}
add_action( 'init', 'roam_register_blocks' );

/**
 * Canvas render callback.
 *
 * For non-nested-zoom canvases, the statically-saved markup is returned as-is.
 * For nested-zoom canvases, child roam/section blocks are wrapped with the
 * world positioning + inner-scale transform that produces the Russian-doll
 * infinite-zoom layout — authors write sections as a normal vertical stack
 * and the PHP layer does the spatial math.
 *
 * @param array  $attributes Block attributes.
 * @param string $content    Saved (static) content from the block's save fn.
 * @param object $block      The WP_Block instance.
 */
function roam_render_canvas( $attributes, $content, $block = null ) {
	if ( empty( $attributes['nestedZoom'] ) ) {
		return $content;
	}

	// Get parsed inner blocks (sections to be positioned).
	$inner_blocks = array();
	if ( $block && isset( $block->parsed_block['innerBlocks'] ) ) {
		$inner_blocks = $block->parsed_block['innerBlocks'];
	}

	// Ratio between consecutive tiers. First dive is dramatic (300×) so the
	// second section appears as a ~4px dot inside the first; subsequent dives
	// are 30× so max zoom stays within GPU transform precision (~270K).
	$ratio_steps = array( 300, 30, 30, 30, 30 );
	// IMPORTANT: dive point at (0, 0). At extreme zoom (state.z > 1e5) the
	// CSS transform matrix is composed into a single 4x4 matrix in float32
	// for GPU compositing. If world coords are large (e.g. 12000), the
	// matrix translation element becomes ~12000 × state.z ≈ 1e9, where
	// float32 has ~256-unit precision and the rendered position oscillates
	// every frame — violent shake. Centering at (0,0) keeps composed
	// matrix elements small and stable.
	$dive_x = 0;
	$dive_y = 0;
	$base_w = 1280;
	$base_h = 720;

	$sections_html = '';
	$tier = 0;

	foreach ( $inner_blocks as $section_block ) {
		// Accept both roam/section AND legacy roam/node blocks as tiers.
		$is_section = isset( $section_block['blockName'] ) && $section_block['blockName'] === 'roam/section';
		$is_node    = isset( $section_block['blockName'] ) && $section_block['blockName'] === 'roam/node';
		if ( ! $is_section && ! $is_node ) {
			continue;
		}

		// Compute world-coord size for this tier.
		$factor = 1.0;
		for ( $i = 0; $i < $tier; $i++ ) {
			$step = isset( $ratio_steps[ $i ] ) ? $ratio_steps[ $i ] : 30;
			$factor *= $step;
		}
		$w     = $base_w / $factor;
		$h     = $base_h / $factor;
		$x     = $dive_x - $w / 2;
		$y     = $dive_y - $h / 2;
		$scale = 1.0 / $factor;
		$pad   = 40.0 * $scale;

		$attrs        = isset( $section_block['attrs'] ) ? $section_block['attrs'] : array();
		$anchor_name  = ! empty( $attrs['anchorName'] ) ? $attrs['anchorName'] : 'section-' . ( $tier + 1 );
		$anchor_label = ! empty( $attrs['anchorLabel'] ) ? $attrs['anchorLabel'] : ucfirst( $anchor_name );

		// Render the section's inner content (works for both stacked sections and old nodes).
		$inner_html = '';
		if ( ! empty( $section_block['innerBlocks'] ) ) {
			foreach ( $section_block['innerBlocks'] as $child ) {
				$inner_html .= render_block( $child );
			}
		}

		// Default per-tier gradients so each section has a visually-distinct
		// background even before the author customises it. Without these,
		// sections appear "transparent" during transitions — they only
		// become visible once their text content is at readable size.
		$default_gradients = array(
			'radial-gradient(ellipse 1200px 800px at 80% -20%,#1f1438 0%,#0a0a10 60%),radial-gradient(ellipse 800px 600px at 10% 110%,#0d2f24 0%,#0a0a10 70%),#0a0a10',
			'linear-gradient(135deg,#1a1530 0%,#0e0e12 60%,#161020 100%)',
			'linear-gradient(180deg,#0b2e1f 0%,#0a1610 100%)',
			'radial-gradient(ellipse at 30% 20%,#1a1030 0%,#0a0a10 70%)',
			'radial-gradient(ellipse at 50% 0%,#1a2a1e 0%,#0a0a10 70%)',
		);
		$bg = '';
		if ( ! empty( $attrs['bgGradient'] ) ) {
			$bg = $attrs['bgGradient'];
		} elseif ( ! empty( $attrs['bgColor'] ) ) {
			$bg = $attrs['bgColor'];
		} else {
			$bg = $default_gradients[ $tier % count( $default_gradients ) ];
		}
		$accent = ! empty( $attrs['accentColor'] ) ? $attrs['accentColor'] : '#7df9c4';

		// Wrap the inner content in a 1280×720 canvas scaled by 1/factor so
		// authors can write CSS at natural pixel sizes; the visual size at
		// this tier is automatic. Sections get a tier-coloured background +
		// generous padding so unstyled core blocks look like a real "page".
		$inner_styled = sprintf(
			'<div class="roam-section-frame" style="position:absolute;left:0;top:0;width:%dpx;height:%dpx;transform:scale(%s);transform-origin:0 0;overflow:hidden;border-radius:%spx;background:%s;color:#f3f3f7;font-family:-apple-system,BlinkMacSystemFont,\'Inter\',\'Segoe UI\',sans-serif;box-shadow:inset 0 0 0 4px rgba(255,255,255,0.04);--roam-accent:%s">' .
				'<div class="roam-section-inner" style="position:absolute;inset:0;padding:80px 96px;overflow:hidden;display:flex;flex-direction:column;justify-content:center">%s</div>' .
			'</div>',
			$base_w,
			$base_h,
			roam_fmt_num( $scale ),
			roam_fmt_num( 24 * $scale ),
			esc_attr( $bg ),
			esc_attr( $accent ),
			$inner_html
		);

		$sections_html .= sprintf(
			'<div class="wp-block-roam-node roam-node is-anchored" style="transform:translate(%spx,%spx) rotate(0deg);width:%spx;height:%spx;position:absolute;z-index:%d" data-x="%s" data-y="%s" data-width="%s" data-height="%s" data-r="0" data-anchor-name="%s" data-anchor-label="%s" data-frame-zoom="1" data-frame-padding="%s" id="roam-anchor-%s">%s</div>',
			roam_fmt_num( $x ),
			roam_fmt_num( $y ),
			roam_fmt_num( $w ),
			roam_fmt_num( $h ),
			$tier + 1,
			roam_fmt_num( $x ),
			roam_fmt_num( $y ),
			roam_fmt_num( $w ),
			roam_fmt_num( $h ),
			esc_attr( $anchor_name ),
			esc_attr( $anchor_label ),
			roam_fmt_num( $pad ),
			esc_attr( $anchor_name ),
			$inner_styled
		);

		$tier++;
	}

	// Build canvas data attributes from $attributes.
	// IMPORTANT: in nestedZoom mode we ALWAYS override maxZoom to a value
	// large enough to reach the deepest tier. The block.json default
	// maxZoom is 4 (a legacy from the boxed/free-positioning mode), which
	// would clamp state.z and keep deeper tiers unreachable. We compute a
	// safe max from the actual number of tiers and the ratio steps used.
	$nested_max_zoom = 10.0;
	$cumulative = 1.0;
	for ( $i = 0; $i < $tier; $i++ ) {
		$step = isset( $ratio_steps[ $i ] ) ? $ratio_steps[ $i ] : 30;
		$cumulative *= $step;
	}
	// Allow ~1.5× headroom past the deepest tier's display zoom.
	$nested_max_zoom = max( $nested_max_zoom, $cumulative * 1.5 );

	$canvas_attrs = array(
		'worldWidth'       => isset( $attributes['worldWidth'] ) ? $attributes['worldWidth'] : 24000,
		'worldHeight'      => isset( $attributes['worldHeight'] ) ? $attributes['worldHeight'] : 24000,
		'initialZoom'      => isset( $attributes['initialZoom'] ) ? $attributes['initialZoom'] : 1,
		'minZoom'          => isset( $attributes['minZoom'] ) ? $attributes['minZoom'] : 0.05,
		'maxZoom'          => $nested_max_zoom,
		'showGrid'         => ! empty( $attributes['showGrid'] ) ? 1 : 0,
		'viewMode'         => isset( $attributes['viewMode'] ) ? $attributes['viewMode'] : 'fullscreen',
		'showAnchorMenu'   => ! empty( $attributes['showAnchorMenu'] ) ? 1 : 0,
		'initialAnchor'    => isset( $attributes['initialAnchor'] ) ? $attributes['initialAnchor'] : '',
		'fitOnLoad'        => ! empty( $attributes['fitOnLoad'] ) ? 1 : 0,
		'nestedZoom'       => 1,
		'flyDuration'      => isset( $attributes['flyDuration'] ) ? $attributes['flyDuration'] : 1500,
	);

	$align_class = '';
	if ( isset( $attributes['align'] ) && in_array( $attributes['align'], array( 'wide', 'full' ), true ) ) {
		$align_class = ' align' . $attributes['align'];
	}

	$canvas_class = 'wp-block-roam-canvas roam-canvas' . $align_class .
		( $canvas_attrs['viewMode'] === 'fullscreen' ? ' is-fullscreen' : '' );

	return sprintf(
		'<div class="%s" data-world-width="%s" data-world-height="%s" data-initial-zoom="%s" data-min-zoom="%s" data-max-zoom="%s" data-initial-x="0" data-initial-y="0" data-show-grid="%d" data-view-mode="%s" data-show-anchor-menu="%d" data-initial-anchor="%s" data-fit-on-load="%d" data-nested-zoom="1" data-fly-duration="%s">' .
			'<div class="roam-world" style="width:%spx;height:%spx">%s</div>' .
			'<div class="roam-controls" aria-hidden="false">' .
				'<button type="button" class="roam-ctrl" data-roam-act="in" aria-label="Zoom in">+</button>' .
				'<button type="button" class="roam-ctrl" data-roam-act="out" aria-label="Zoom out">−</button>' .
				'<button type="button" class="roam-ctrl" data-roam-act="reset" aria-label="Reset">◎</button>' .
			'</div>' .
			'<div class="roam-hint">keep scrolling to dive deeper · the next world is inside this one</div>' .
		'</div>',
		esc_attr( $canvas_class ),
		roam_fmt_num( $canvas_attrs['worldWidth'] ),
		roam_fmt_num( $canvas_attrs['worldHeight'] ),
		roam_fmt_num( $canvas_attrs['initialZoom'] ),
		roam_fmt_num( $canvas_attrs['minZoom'] ),
		roam_fmt_num( $canvas_attrs['maxZoom'] ),
		(int) $canvas_attrs['showGrid'],
		esc_attr( $canvas_attrs['viewMode'] ),
		(int) $canvas_attrs['showAnchorMenu'],
		esc_attr( $canvas_attrs['initialAnchor'] ),
		(int) $canvas_attrs['fitOnLoad'],
		roam_fmt_num( $canvas_attrs['flyDuration'] ),
		roam_fmt_num( $canvas_attrs['worldWidth'] ),
		roam_fmt_num( $canvas_attrs['worldHeight'] ),
		$sections_html
	);
}

/**
 * Format a number for CSS output without locale issues or trailing zeros.
 */
function roam_fmt_num( $n ) {
	$n = (float) $n;
	if ( abs( $n - round( $n ) ) < 0.0000001 ) {
		return (string) (int) round( $n );
	}
	return rtrim( rtrim( sprintf( '%.6F', $n ), '0' ), '.' );
}
