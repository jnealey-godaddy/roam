/**
 * Roam Canvas — Frontend runtime.
 *
 *   - Mousewheel zooms toward cursor
 *   - Pointer drag pans (1:1) — works over any node, even text-rich ones
 *   - One-finger touch pans; two-finger pinch zooms
 *   - Arrow keys pan; +/- zoom; 0 resets; Escape returns to initial
 *   - Floating zoom controls (.roam-ctrl[data-roam-act])
 *   - Anchor menu navigates between named nodes with smooth flyTo
 *   - "boxed" or "fullscreen" viewMode
 */
( function () {
	'use strict';

	function clamp( v, lo, hi ) { return Math.max( lo, Math.min( hi, v ) ); }
	function lerp( a, b, t ) { return a + ( b - a ) * t; }

	function initCanvas( root ) {
		if ( root.dataset.roamInit === '1' ) { return; }
		root.dataset.roamInit = '1';

		var world = root.querySelector( '.roam-world' );
		if ( ! world ) { return; }

		var worldWidth  = parseFloat( root.dataset.worldWidth  ) || 4000;
		var worldHeight = parseFloat( root.dataset.worldHeight ) || 3000;
		var minZoom     = parseFloat( root.dataset.minZoom     ) || 0.25;
		var maxZoom     = parseFloat( root.dataset.maxZoom     ) || 4;
		var initialZoom = parseFloat( root.dataset.initialZoom ) || 1;
		var initialX    = parseFloat( root.dataset.initialX    ) || 0;
		var initialY    = parseFloat( root.dataset.initialY    ) || 0;
		var viewMode    = root.dataset.viewMode || 'boxed';
		var showAnchorMenu = root.dataset.showAnchorMenu === '1';
		var initialAnchor = root.dataset.initialAnchor || '';
		var fitOnLoad   = root.dataset.fitOnLoad === '1';
		var nestedZoom  = root.dataset.nestedZoom === '1';
		var flyDuration = parseFloat( root.dataset.flyDuration ) || 900;
		// Older saves without the flag treat any non-(0,0) offset as authored,
		// matching the previous heuristic so existing posts keep their framing.
		var hasInitialOffset = root.dataset.hasInitialOffset === '1' ||
			initialX !== 0 || initialY !== 0;

		// Apply fullscreen class for stretchable runtime mode.
		// Also portal to <body> so we escape any ancestor transform that would
		// trap position:fixed inside the content column.
		if ( viewMode === 'fullscreen' ) {
			root.classList.add( 'is-fullscreen' );
			if ( root.parentNode !== document.body ) {
				document.body.appendChild( root );
			}
		}

		var state = { x: 0, y: 0, z: initialZoom };
		var rect = root.getBoundingClientRect();
		var flying = null; // {fromX, fromY, fromZ, toX, toY, toZ, t0, dur}

		// --- initial framing ----------------------------------------------
		function computeInitial() {
			rect = root.getBoundingClientRect();
			if ( fitOnLoad ) {
				var zx = rect.width  / worldWidth;
				var zy = rect.height / worldHeight;
				var z  = Math.min( zx, zy ) * 0.95;
				state.z = clamp( z, minZoom, maxZoom );
				state.x = ( rect.width  - worldWidth  * state.z ) / 2;
				state.y = ( rect.height - worldHeight * state.z ) / 2;
				return;
			}
			if ( initialAnchor ) {
				var node = world.querySelector( '[data-anchor-name="' + cssEscape( initialAnchor ) + '"]' );
				if ( node ) {
					var target = anchorTarget( node );
					state.x = target.x; state.y = target.y; state.z = target.z;
					return;
				}
			}
			if ( hasInitialOffset ) {
				state.x = initialX;
				state.y = initialY;
			} else {
				state.x = ( rect.width  - worldWidth  * state.z ) / 2;
				state.y = ( rect.height - worldHeight * state.z ) / 2;
			}
		}

		function cssEscape( s ) {
			return CSS.escape( s );
		}

		function anchorTarget( node ) {
			var nx = parseFloat( node.dataset.x ) || 0;
			var ny = parseFloat( node.dataset.y ) || 0;
			var nw = parseFloat( node.dataset.width ) || 320;
			// Prefer cached data-height; offsetHeight can read 0 for sub-pixel
			// sections at deep nesting. Cache the first valid measurement so
			// subsequent calls stay stable even when the node shrinks visually.
			var nh = parseFloat( node.dataset.height );
			if ( ! ( nh > 0 ) ) {
				nh = node.offsetHeight;
				if ( nh > 0 ) { node.dataset.height = nh; }
				else { nh = 200; }
			}
			var pad = parseFloat( node.dataset.framePadding ) || 60;
			var fz  = parseFloat( node.dataset.frameZoom ) || 1;
			rect = root.getBoundingClientRect();
			// Fit-frame: choose zoom so the node + padding fits the viewport.
			var zx = rect.width  / ( nw + pad * 2 );
			var zy = rect.height / ( nh + pad * 2 );
			var fit = Math.min( zx, zy );
			// frameZoom multiplier lets the author override; default 1.0 == "fit".
			var z = clamp( fit * fz, minZoom, maxZoom );
			// Center the node in the viewport at zoom z.
			var cx = nx + nw / 2;
			var cy = ny + nh / 2;
			return {
				x: rect.width  / 2 - cx * z,
				y: rect.height / 2 - cy * z,
				z: z
			};
		}

		// --- transform writer ---------------------------------------------
		// In nested-zoom mode, use a mathematically-equivalent split transform
		// `translate(vw/2, vh/2) scale(z) translate(-divePoint)` instead of
		// `translate(state.x, state.y) scale(z)`. They produce the same screen
		// positions in exact math, but the split form has dramatically better
		// floating-point precision at extreme zoom (z > 100K) because the
		// (world_coord - divePoint) subtraction happens in float space before
		// the multiplication by z, keeping intermediate values small.
		var rafId = 0;
		// Cached viewport size — only refreshed by the ResizeObserver below, NOT
		// per-frame. Calling getBoundingClientRect() every frame forces layout
		// recalculation and can introduce subpixel jitter at extreme zoom.
		var vpW = 0, vpH = 0;
		function refreshVp() {
			var r = root.getBoundingClientRect();
			vpW = r.width;
			vpH = r.height;
		}
		refreshVp();
		function apply() {
			rafId = 0;
			if ( nestedZoom && divePoint ) {
				// `translate3d` forces GPU compositing, which stabilizes the
				// rendered position at extreme zoom (matrix composition happens
				// on the GPU as a single op rather than via multiple layers).
				world.style.transform =
					'translate3d(' + ( vpW / 2 ) + 'px, ' + ( vpH / 2 ) + 'px, 0) ' +
					'scale(' + state.z + ') ' +
					'translate3d(' + ( -divePoint.x ) + 'px, ' + ( -divePoint.y ) + 'px, 0)';
			} else {
				world.style.transform = 'translate3d(' + state.x + 'px, ' + state.y + 'px, 0) scale(' + state.z + ')';
			}
			updateVisibility();
		}
		function schedule() {
			if ( rafId ) { return; }
			rafId = requestAnimationFrame( apply );
		}

		// --- zoom-based visibility for nested-zoom posts ------------------
		// Each anchored node has a "display zoom" (the camera scale that frames
		// it cleanly). We fade nodes in/out as the camera zoom approaches or
		// leaves their display zoom — only when nestedZoom is on.
		var anchorViz = []; // { node, dz }
		function computeAnchorViz() {
			anchorViz = getAnchorSequence().map( function ( node ) {
				return { node: node, dz: anchorTarget( node ).z };
			} );
		}
		function updateVisibility() {
			if ( ! nestedZoom || ! anchorViz.length ) { return; }
			// Sort by display zoom ascending so we know each section's "neighbors".
			// A section is visible only between its parent's display zoom and its
			// own child's display zoom — i.e., once the parent has overflowed and
			// before this section's own child takes over. No fade — hard on/off
			// so each next world genuinely starts as a tiny dot and grows.
			var sorted = anchorViz.slice().sort( function ( a, b ) { return a.dz - b.dz; } );
			sorted.forEach( function ( av, i ) {
				// Section visible only between (exclusive) the previous section's
				// framing zoom and the next section's framing zoom. "Past full
				// screen for the parent" before this section appears at all.
				var lowDz  = sorted[ i - 1 ] ? sorted[ i - 1 ].dz : -Infinity;
				var highDz = sorted[ i + 1 ] ? sorted[ i + 1 ].dz : Infinity;
				var visible = state.z > lowDz && state.z < highDz;
				av.node.style.opacity = visible ? '1' : '0';
				av.node.style.pointerEvents = visible ? '' : 'none';
			} );

			// Sync progress dots' active state to whichever tier is closest
			if ( progressEl ) {
				var idx = currentTierIdx();
				Array.from( progressEl.children ).forEach( function ( dot, i ) {
					dot.classList.toggle( 'is-active', i === idx );
					dot.classList.toggle( 'is-passed', i < idx );
				} );
			}

			// Sync anchor menu active state
			if ( showAnchorMenu ) {
				var menu = root.querySelector( '.roam-anchor-menu' );
				if ( menu ) {
					var seq = getAnchorSequence();
					var activeName = seq[ currentTierIdx() ] && seq[ currentTierIdx() ].getAttribute( 'data-anchor-name' );
					Array.from( menu.children ).forEach( function ( btn ) {
						btn.classList.toggle( 'is-active', btn.dataset.target === activeName );
					} );
				}
			}
		}

		// --- fly-to (animated) --------------------------------------------
		var flyRaf = 0;
		function flyTo( toX, toY, toZ, dur ) {
			cancelFly();
			flying = {
				fromX: state.x, fromY: state.y, fromZ: state.z,
				toX: toX, toY: toY, toZ: toZ,
				t0: performance.now(),
				dur: dur != null ? dur : 700
			};
			tickFly();
		}
		function cancelFly() {
			flying = null;
			if ( flyRaf ) { cancelAnimationFrame( flyRaf ); flyRaf = 0; }
		}
		function easeInOut( t ) {
			return t < 0.5 ? 2 * t * t : 1 - Math.pow( -2 * t + 2, 2 ) / 2;
		}
		function tickFly() {
			if ( ! flying ) { return; }
			var p = ( performance.now() - flying.t0 ) / flying.dur;
			if ( p >= 1 ) {
				state.x = flying.toX; state.y = flying.toY; state.z = flying.toZ;
				flying = null; apply(); return;
			}
			var e = easeInOut( clamp( p, 0, 1 ) );
			// Interpolate translate linearly, but zoom in LOG space for natural
			// "infinite zoom" feel (constant rate of perceived scale change).
			state.x = lerp( flying.fromX, flying.toX, e );
			state.y = lerp( flying.fromY, flying.toY, e );
			var lz = lerp( Math.log( flying.fromZ ), Math.log( flying.toZ ), e );
			state.z = Math.exp( lz );
			apply();
			flyRaf = requestAnimationFrame( tickFly );
		}

		function setZoomAtPoint( newZ, cx, cy ) {
			newZ = clamp( newZ, minZoom, maxZoom );
			if ( newZ === state.z ) { return; }
			state.x = cx - ( cx - state.x ) * ( newZ / state.z );
			state.y = cy - ( cy - state.y ) * ( newZ / state.z );
			state.z = newZ;
			schedule();
		}

		function viewportPoint( clientX, clientY ) {
			var r = root.getBoundingClientRect();
			return { x: clientX - r.left, y: clientY - r.top };
		}

		// --- init paint ---------------------------------------------------
		computeAnchorViz();
		computeInitial();
		apply();

		// Recompute on resize
		var ro = new ResizeObserver( function () {
			rect = root.getBoundingClientRect();
			refreshVp();
		} );
		ro.observe( root );

		// --- continuous zoom toward dive point (nested mode) ---------------
		// `divePoint` is the world coord that stays fixed at viewport center
		// while the camera zooms. Computed from initialAnchor's center (or
		// world center if no initial anchor set).
		var divePoint = null;
		var targetZ = state.z;
		var chaseRaf = 0;

		function computeDivePoint() {
			if ( ! nestedZoom ) { return; }
			var seq = getAnchorSequence();
			if ( ! seq.length ) {
				divePoint = { x: worldWidth / 2, y: worldHeight / 2 };
				return;
			}
			// All anchored nodes share the same world-coord center by convention;
			// use the initial-anchor's center (or first anchor) as the dive point.
			var initial = initialAnchor
				? seq.find( function ( n ) { return n.getAttribute( 'data-anchor-name' ) === initialAnchor; } )
				: seq[ 0 ];
			if ( ! initial ) { initial = seq[ 0 ]; }
			var nx = parseFloat( initial.dataset.x ) || 0;
			var ny = parseFloat( initial.dataset.y ) || 0;
			var nw = parseFloat( initial.dataset.width ) || 320;
			var nh = initial.offsetHeight || 200;
			divePoint = { x: nx + nw / 2, y: ny + nh / 2 };
		}

		function chaseTick() {
			chaseRaf = 0;
			var dz = targetZ - state.z;
			// Lerp in log space so the perceived rate of zoom is constant.
			var lz = Math.log( state.z );
			var ltarget = Math.log( targetZ );
			var diff = ltarget - lz;
			if ( Math.abs( diff ) < 0.001 ) {
				state.z = targetZ;
			} else {
				state.z = Math.exp( lz + diff * 0.18 );
			}
			// Keep dive point pinned to viewport center
			rect = root.getBoundingClientRect();
			state.x = rect.width  / 2 - divePoint.x * state.z;
			state.y = rect.height / 2 - divePoint.y * state.z;
			apply();
			if ( state.z !== targetZ ) {
				chaseRaf = requestAnimationFrame( chaseTick );
			}
		}

		function scheduleChase() {
			// Cancel any in-progress fly so the two animators don't fight
			// over state.x/y/z and produce a visible jitter.
			if ( flying ) { cancelFly(); }
			if ( ! chaseRaf ) { chaseRaf = requestAnimationFrame( chaseTick ); }
		}

		// Wheel handler — branches on nestedZoom for continuous dive vs cursor-zoom
		root.addEventListener( 'wheel', function ( e ) {
			e.preventDefault();

			if ( nestedZoom ) {
				cancelFly();
				if ( ! divePoint ) { computeDivePoint(); }
				// Wheel DOWN (deltaY positive) DIVES IN toward dive point.
				// Wheel UP backs out. Multiplicative — each detent zooms ~1.22x.
				var factor = Math.pow( 1.002, e.deltaY );
				targetZ = clamp( targetZ * factor, minZoom, maxZoom );
				scheduleChase();
				return;
			}

			cancelFly();
			var p = viewportPoint( e.clientX, e.clientY );
			var freeFactor = Math.pow( 1.0015, -e.deltaY );
			setZoomAtPoint( state.z * freeFactor, p.x, p.y );
		}, { passive: false } );

		function getAnchorSequence() {
			return Array.from( world.querySelectorAll( '[data-anchor-name]' ) ).filter( function ( n ) {
				return n.getAttribute( 'data-anchor-name' );
			} );
		}

		// Any element with [data-roam-dive="<anchor-name>"] (anywhere inside the
		// canvas) becomes a "dive" button — click it to fly to that section.
		// This lets authored content (CTAs, nav links) trigger anchor navigation.
		root.addEventListener( 'click', function ( e ) {
			var btn = e.target.closest( '[data-roam-dive]' );
			if ( ! btn ) { return; }
			e.preventDefault();
			e.stopPropagation();
			var name = btn.getAttribute( 'data-roam-dive' );
			if ( name === 'reset' || name === 'home' ) {
				resetView( true );
				return;
			}
			var target = world.querySelector( '[data-anchor-name="' + cssEscape( name ) + '"]' );
			if ( target ) { diveToAnchor( target ); }
		} );

		// Set the camera target zoom to a specific anchor's display zoom and
		// let the chase loop fly us there continuously.
		function diveToAnchor( node ) {
			cancelFly();
			if ( ! divePoint ) { computeDivePoint(); }
			var target = anchorTarget( node );
			targetZ = clamp( target.z, minZoom, maxZoom );
			scheduleChase();
			// Sync UI immediately
			var menu = root.querySelector( '.roam-anchor-menu' );
			if ( menu ) {
				Array.from( menu.querySelectorAll( '.is-active' ) ).forEach( function ( e ) { e.classList.remove( 'is-active' ); } );
				var name = node.getAttribute( 'data-anchor-name' );
				var btn = menu.querySelector( '.roam-anchor-btn[data-target="' + cssEscape( name ) + '"]' );
				if ( btn ) { btn.classList.add( 'is-active' ); }
			}
		}

		// Determine the section closest to current zoom level (for progress UI)
		function currentTierIdx() {
			var seq = getAnchorSequence();
			if ( ! seq.length ) { return 0; }
			var best = 0, bestDist = Infinity;
			for ( var i = 0; i < seq.length; i++ ) {
				var dz = anchorTarget( seq[ i ] ).z;
				var dist = Math.abs( Math.log( state.z / dz ) );
				if ( dist < bestDist ) { bestDist = dist; best = i; }
			}
			return best;
		}

		// --- pointer pan / pinch ------------------------------------------
		var pointers = new Map();
		var panStart = null;
		var pinchStart = null;

		// Selectors that should NOT trigger pan when the pointer comes down on them.
		var NO_PAN_SELECTOR = '.roam-controls, .roam-anchor-menu, a, button, input, textarea, select, [contenteditable="true"]';

		function onPointerDown( e ) {
			if ( e.target.closest( NO_PAN_SELECTOR ) ) { return; }
			// In nested-zoom mode, single-finger drag is disabled (the dive point
			// stays fixed) — only pinch-to-zoom matters. Mouse drag does nothing.
			if ( nestedZoom && e.pointerType !== 'touch' ) { return; }
			// Critical: prevent the browser from starting text-selection or image-drag
			// while we own the pointer for panning.
			e.preventDefault();
			cancelFly();
			try { root.setPointerCapture( e.pointerId ); } catch ( _ ) {}
			pointers.set( e.pointerId, { x: e.clientX, y: e.clientY } );

			if ( pointers.size === 1 ) {
				panStart = nestedZoom ? null : {
					cx: e.clientX, cy: e.clientY,
					sx: state.x,   sy: state.y
				};
				if ( ! nestedZoom ) { root.classList.add( 'is-grabbing' ); }
			} else if ( pointers.size === 2 ) {
				var pts = Array.from( pointers.values() );
				var dx = pts[1].x - pts[0].x;
				var dy = pts[1].y - pts[0].y;
				var dist = Math.hypot( dx, dy );
				var midClient = { x: ( pts[0].x + pts[1].x ) / 2, y: ( pts[0].y + pts[1].y ) / 2 };
				var midLocal = viewportPoint( midClient.x, midClient.y );
				pinchStart = {
					dist: dist,
					z: state.z,
					mid: midLocal,
					sx: state.x, sy: state.y
				};
				panStart = null;
			}
		}

		function onPointerMove( e ) {
			if ( ! pointers.has( e.pointerId ) ) { return; }
			pointers.set( e.pointerId, { x: e.clientX, y: e.clientY } );

			if ( pointers.size === 2 && pinchStart ) {
				var pts = Array.from( pointers.values() );
				var dx = pts[1].x - pts[0].x;
				var dy = pts[1].y - pts[0].y;
				var dist = Math.hypot( dx, dy );
				if ( pinchStart.dist > 0 ) {
					var newZ = clamp( pinchStart.z * ( dist / pinchStart.dist ), minZoom, maxZoom );
					if ( nestedZoom ) {
						// Pinch zooms toward dive point (not pinch midpoint).
						if ( ! divePoint ) { computeDivePoint(); }
						targetZ = newZ;
						scheduleChase();
					} else {
						var m = pinchStart.mid;
						state.x = m.x - ( m.x - pinchStart.sx ) * ( newZ / pinchStart.z );
						state.y = m.y - ( m.y - pinchStart.sy ) * ( newZ / pinchStart.z );
						state.z = newZ;
						schedule();
					}
				}
			} else if ( pointers.size === 1 && panStart ) {
				state.x = panStart.sx + ( e.clientX - panStart.cx );
				state.y = panStart.sy + ( e.clientY - panStart.cy );
				schedule();
			}
		}

		function onPointerUp( e ) {
			pointers.delete( e.pointerId );
			if ( pointers.size < 2 ) { pinchStart = null; }
			if ( pointers.size === 0 ) {
				panStart = null;
				root.classList.remove( 'is-grabbing' );
			} else if ( pointers.size === 1 && ! nestedZoom ) {
				// Re-arm pan with the remaining finger after a pinch — but
				// only outside nested-zoom mode, where the dive point must
				// stay fixed and finger drag should not move the camera.
				var p = Array.from( pointers.values() )[0];
				panStart = { cx: p.x, cy: p.y, sx: state.x, sy: state.y };
			}
		}

		root.addEventListener( 'pointerdown', onPointerDown );
		root.addEventListener( 'pointermove', onPointerMove );
		root.addEventListener( 'pointerup', onPointerUp );
		root.addEventListener( 'pointercancel', onPointerUp );

		// --- keyboard ------------------------------------------------------
		root.tabIndex = 0;
		root.addEventListener( 'keydown', function ( e ) {
			if ( e.target !== root && e.target.closest( 'input, textarea, [contenteditable="true"]' ) ) { return; }

			// In nested-zoom mode, keyboard adjusts targetZ for continuous zoom.
			if ( nestedZoom ) {
				if ( ! divePoint ) { computeDivePoint(); }
				switch ( e.key ) {
					case 'ArrowDown': case 'PageDown':
						targetZ = clamp( targetZ * 1.5, minZoom, maxZoom );
						scheduleChase(); e.preventDefault(); return;
					case 'ArrowUp': case 'PageUp':
						targetZ = clamp( targetZ / 1.5, minZoom, maxZoom );
						scheduleChase(); e.preventDefault(); return;
					case ' ':
						targetZ = clamp( targetZ * 2, minZoom, maxZoom );
						scheduleChase(); e.preventDefault(); return;
					case 'Home':
						var seqH = getAnchorSequence();
						if ( seqH.length ) { diveToAnchor( seqH[ 0 ] ); }
						e.preventDefault(); return;
					case 'End':
						var seqE = getAnchorSequence();
						if ( seqE.length ) { diveToAnchor( seqE[ seqE.length - 1 ] ); }
						e.preventDefault(); return;
				}
			}

			var step = 80;
			switch ( e.key ) {
				case 'ArrowLeft':  cancelFly(); state.x += step; schedule(); e.preventDefault(); break;
				case 'ArrowRight': cancelFly(); state.x -= step; schedule(); e.preventDefault(); break;
				case 'ArrowUp':    cancelFly(); state.y += step; schedule(); e.preventDefault(); break;
				case 'ArrowDown':  cancelFly(); state.y -= step; schedule(); e.preventDefault(); break;
				case '+': case '=':
					cancelFly();
					setZoomAtPoint( state.z * 1.2, rect.width / 2, rect.height / 2 );
					e.preventDefault();
					break;
				case '-': case '_':
					cancelFly();
					setZoomAtPoint( state.z / 1.2, rect.width / 2, rect.height / 2 );
					e.preventDefault();
					break;
				case '0': resetView( true ); e.preventDefault(); break;
				case 'Escape': resetView( true ); break;
			}
		} );

		// Progress dots — only shown in nested-zoom mode
		var progressEl = null;
		function ensureProgress( total ) {
			if ( ! nestedZoom || total < 2 ) { return; }
			if ( progressEl ) { return progressEl; }
			progressEl = document.createElement( 'div' );
			progressEl.className = 'roam-progress';
			var seq = getAnchorSequence();
			for ( var i = 0; i < total; i++ ) {
				var dot = document.createElement( 'button' );
				dot.type = 'button';
				dot.className = 'roam-progress-dot';
				dot.setAttribute( 'aria-label', 'Section ' + ( i + 1 ) );
				dot.dataset.idx = i;
				( function ( idx, node ) {
					dot.addEventListener( 'click', function () {
						diveToAnchor( node );
					} );
				} )( i, seq[ i ] );
				progressEl.appendChild( dot );
			}
			root.appendChild( progressEl );
			return progressEl;
		}
		function updateProgress( idx, total ) {
			ensureProgress( total );
			if ( ! progressEl ) { return; }
			Array.from( progressEl.children ).forEach( function ( dot, i ) {
				dot.classList.toggle( 'is-active', i === idx );
				dot.classList.toggle( 'is-passed', i < idx );
			} );
		}

		function resetView( smooth ) {
			var s0 = { x: state.x, y: state.y, z: state.z };
			computeInitial();
			var s1 = { x: state.x, y: state.y, z: state.z };
			if ( smooth ) {
				state.x = s0.x; state.y = s0.y; state.z = s0.z;
				flyTo( s1.x, s1.y, s1.z, 700 );
			} else {
				apply();
			}
		}

		// --- zoom controls -------------------------------------------------
		var controls = root.querySelector( '.roam-controls' );
		if ( controls ) {
			controls.addEventListener( 'click', function ( e ) {
				var btn = e.target.closest( '[data-roam-act]' );
				if ( ! btn ) { return; }
				var act = btn.dataset.roamAct;
				var s0 = { x: state.x, y: state.y, z: state.z };
				if ( act === 'in' ) {
					cancelFly();
					var newZ = clamp( state.z * 1.4, minZoom, maxZoom );
					var cx = rect.width / 2, cy = rect.height / 2;
					var nx = cx - ( cx - state.x ) * ( newZ / state.z );
					var ny = cy - ( cy - state.y ) * ( newZ / state.z );
					flyTo( nx, ny, newZ, 320 );
				} else if ( act === 'out' ) {
					cancelFly();
					var newZ2 = clamp( state.z / 1.4, minZoom, maxZoom );
					var cx2 = rect.width / 2, cy2 = rect.height / 2;
					var nx2 = cx2 - ( cx2 - state.x ) * ( newZ2 / state.z );
					var ny2 = cy2 - ( cy2 - state.y ) * ( newZ2 / state.z );
					flyTo( nx2, ny2, newZ2, 320 );
				} else if ( act === 'reset' ) {
					resetView( true );
				}
			} );
		}

		// --- anchor menu ---------------------------------------------------
		if ( showAnchorMenu ) {
			buildAnchorMenu();
		}

		// --- nested-zoom init: compute dive point, draw progress dots, sync targetZ
		if ( nestedZoom ) {
			computeDivePoint();
			var seq0 = getAnchorSequence();
			if ( seq0.length ) {
				targetZ = state.z;
				updateProgress( currentTierIdx(), seq0.length );
			}
		}

		function buildAnchorMenu() {
			var anchored = Array.from( world.querySelectorAll( '[data-anchor-name]' ) ).filter( function ( n ) {
				return n.getAttribute( 'data-anchor-name' );
			} );
			if ( ! anchored.length ) { return; }

			var menu = document.createElement( 'nav' );
			menu.className = 'roam-anchor-menu';
			menu.setAttribute( 'aria-label', 'Canvas sections' );

			anchored.forEach( function ( node, idx ) {
				var btn = document.createElement( 'button' );
				btn.type = 'button';
				btn.className = 'roam-anchor-btn';
				btn.textContent = node.getAttribute( 'data-anchor-label' ) || node.getAttribute( 'data-anchor-name' );
				btn.dataset.target = node.getAttribute( 'data-anchor-name' );
				btn.addEventListener( 'click', function () {
					if ( nestedZoom ) {
						diveToAnchor( node );
					} else {
						var target = anchorTarget( node );
						flyTo( target.x, target.y, target.z, 850 );
						Array.from( menu.querySelectorAll( '.is-active' ) ).forEach( function ( e ) { e.classList.remove( 'is-active' ); } );
						btn.classList.add( 'is-active' );
					}
				} );
				menu.appendChild( btn );
				if ( idx === 0 ) { btn.classList.add( 'is-active' ); }
			} );

			root.appendChild( menu );
		}

		// --- hint fade -----------------------------------------------------
		var hint = root.querySelector( '.roam-hint' );
		if ( hint ) {
			setTimeout( function () { hint.classList.add( 'is-fading' ); }, 4500 );
			root.addEventListener( 'pointerdown', function () {
				hint.classList.add( 'is-fading' );
			}, { once: true } );
		}

		// expose a tiny API for external scripts
		root.roam = {
			flyTo: flyTo,
			reset: function () { resetView( true ); },
			getState: function () { return { x: state.x, y: state.y, z: state.z }; },
			flyToAnchor: function ( name ) {
				var node = world.querySelector( '[data-anchor-name="' + cssEscape( name ) + '"]' );
				if ( node ) { var t = anchorTarget( node ); flyTo( t.x, t.y, t.z, 850 ); }
			}
		};
	}

	function initAll() {
		var nodes = document.querySelectorAll( '.wp-block-roam-canvas' );
		for ( var i = 0; i < nodes.length; i++ ) { initCanvas( nodes[ i ] ); }
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', initAll );
	} else {
		initAll();
	}
} )();
