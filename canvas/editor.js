/**
 * Roam Canvas — Editor script
 *
 * Vanilla (no JSX, no imports). Uses globals provided by WP core scripts.
 */
( function ( wp ) {
	'use strict';

	var el = wp.element.createElement;
	var Fragment = wp.element.Fragment;
	var useRef = wp.element.useRef;
	var useEffect = wp.element.useEffect;

	var registerBlockType = wp.blocks.registerBlockType;
	var InnerBlocks = wp.blockEditor.InnerBlocks;
	var useBlockProps = wp.blockEditor.useBlockProps;
	var BlockControls = wp.blockEditor.BlockControls;
	var InspectorControls = wp.blockEditor.InspectorControls;

	var ToolbarGroup = wp.components.ToolbarGroup;
	var ToolbarButton = wp.components.ToolbarButton;
	var PanelBody = wp.components.PanelBody;
	var RangeControl = wp.components.RangeControl;
	var ToggleControl = wp.components.ToggleControl;
	var Button = wp.components.Button;

	var dispatch = wp.data.dispatch;
	var select = wp.data.select;
	var useSelect = wp.data.useSelect;
	var createBlock = wp.blocks.createBlock;

	function clamp( v, lo, hi ) { return Math.max( lo, Math.min( hi, v ) ); }

	/**
	 * Canvas Edit component
	 */
	function CanvasEdit( props ) {
		var attributes = props.attributes;
		var setAttributes = props.setAttributes;
		var clientId = props.clientId;

		var worldWidth  = attributes.worldWidth;
		var worldHeight = attributes.worldHeight;
		var minZoom     = attributes.minZoom;
		var maxZoom     = attributes.maxZoom;
		var showGrid    = attributes.showGrid;

		// view state (editor-local, not persisted)
		var viewportRef = useRef( null );
		var worldRef    = useRef( null );

		var viewState = useRef( {
			x: attributes.initialX || 0,
			y: attributes.initialY || 0,
			z: attributes.initialZoom || 1,
			vw: 0,
			vh: 0
		} );

		// Apply current transform to the world div.
		function applyTransform() {
			var w = worldRef.current;
			if ( ! w ) { return; }
			var s = viewState.current;
			w.style.transform = 'translate(' + s.x + 'px, ' + s.y + 'px) scale(' + s.z + ')';
		}

		// Fit world into viewport on mount / resize.
		useEffect( function () {
			var vp = viewportRef.current;
			if ( ! vp ) { return; }

			function measureAndFit( fit ) {
				var rect = vp.getBoundingClientRect();
				viewState.current.vw = rect.width;
				viewState.current.vh = rect.height;
				if ( fit ) {
					var zx = rect.width  / worldWidth;
					var zy = rect.height / worldHeight;
					var z  = Math.min( zx, zy ) * 0.95;
					z = clamp( z, minZoom, maxZoom );
					viewState.current.z = z;
					viewState.current.x = ( rect.width  - worldWidth  * z ) / 2;
					viewState.current.y = ( rect.height - worldHeight * z ) / 2;
				}
				applyTransform();
			}

			measureAndFit( true );

			var ro = new ResizeObserver( function () { measureAndFit( false ); } );
			ro.observe( vp );
			return function () { ro.disconnect(); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [ worldWidth, worldHeight ] );

		// Wheel zoom (toward cursor)
		useEffect( function () {
			var vp = viewportRef.current;
			if ( ! vp ) { return; }

			function onWheel( e ) {
				e.preventDefault();
				var rect = vp.getBoundingClientRect();
				var cx = e.clientX - rect.left;
				var cy = e.clientY - rect.top;
				var s = viewState.current;
				var factor = Math.pow( 1.0015, -e.deltaY );
				var newZ = clamp( s.z * factor, minZoom, maxZoom );
				if ( newZ === s.z ) { return; }
				// zoom toward cursor
				s.x = cx - ( cx - s.x ) * ( newZ / s.z );
				s.y = cy - ( cy - s.y ) * ( newZ / s.z );
				s.z = newZ;
				applyTransform();
			}

			vp.addEventListener( 'wheel', onWheel, { passive: false } );
			return function () { vp.removeEventListener( 'wheel', onWheel ); };
		}, [ minZoom, maxZoom ] );

		// Pan via background drag (middle-mouse OR drag empty space)
		useEffect( function () {
			var vp = viewportRef.current;
			if ( ! vp ) { return; }

			var panning = false;
			var startX = 0, startY = 0, startVX = 0, startVY = 0;

			function onDown( e ) {
				// only pan when the user is dragging the viewport/world background itself,
				// not when they grab a node or its children.
				var target = e.target;
				if ( target.closest( '.wp-block-roam-node' ) ) { return; }
				if ( target.closest( 'a, button, input, textarea, select, [contenteditable="true"]' ) ) { return; }
				if ( target.closest( '.block-editor-block-list__block' ) &&
				     ! target.classList.contains( 'roam-editor-viewport' ) &&
				     ! target.classList.contains( 'roam-editor-world' ) &&
				     ! target.classList.contains( 'roam-editor-grid' ) ) {
					return;
				}
				panning = true;
				startX = e.clientX;
				startY = e.clientY;
				startVX = viewState.current.x;
				startVY = viewState.current.y;
				vp.classList.add( 'is-panning' );
				e.preventDefault();
			}
			function onMove( e ) {
				if ( ! panning ) { return; }
				viewState.current.x = startVX + ( e.clientX - startX );
				viewState.current.y = startVY + ( e.clientY - startY );
				applyTransform();
			}
			function onUp() {
				if ( panning ) {
					panning = false;
					vp.classList.remove( 'is-panning' );
				}
			}

			vp.addEventListener( 'pointerdown', onDown );
			window.addEventListener( 'pointermove', onMove );
			window.addEventListener( 'pointerup', onUp );
			return function () {
				vp.removeEventListener( 'pointerdown', onDown );
				window.removeEventListener( 'pointermove', onMove );
				window.removeEventListener( 'pointerup', onUp );
			};
		}, [] );

		// Toolbar handlers
		function zoom( factor ) {
			var s = viewState.current;
			var newZ = clamp( s.z * factor, minZoom, maxZoom );
			var cx = s.vw / 2, cy = s.vh / 2;
			s.x = cx - ( cx - s.x ) * ( newZ / s.z );
			s.y = cy - ( cy - s.y ) * ( newZ / s.z );
			s.z = newZ;
			applyTransform();
		}
		function resetView() {
			var s = viewState.current;
			var zx = s.vw / worldWidth;
			var zy = s.vh / worldHeight;
			s.z = clamp( Math.min( zx, zy ) * 0.95, minZoom, maxZoom );
			s.x = ( s.vw - worldWidth  * s.z ) / 2;
			s.y = ( s.vh - worldHeight * s.z ) / 2;
			applyTransform();
		}

		function addNode() {
			// Insert a new node at current view center, in world coords.
			var s = viewState.current;
			var wx = ( s.vw / 2 - s.x ) / s.z;
			var wy = ( s.vh / 2 - s.y ) / s.z;
			var block = createBlock( 'roam/node', {
				x: Math.round( wx - 160 ),
				y: Math.round( wy - 60 ),
				width: 320,
				rotation: 0
			}, [
				createBlock( 'core/paragraph', { placeholder: 'Roam free…' } )
			] );
			dispatch( 'core/block-editor' ).insertBlock( block, undefined, clientId, false );
		}

		// In nested-zoom mode the editor renders sections as a normal stacked
		// list (no world transform, no absolute positioning). The PHP
		// render_callback handles all the world coords on the frontend.
		// In free-positioning mode (legacy), children are nodes the author drags.
		var nestedZoom = !! attributes.nestedZoom;

		// For the section switcher: read every roam/section child so we can
		// render quick-jump tabs at the top of the stacked canvas.
		var sectionTabs = useSelect( function ( s ) {
			if ( ! nestedZoom ) { return []; }
			var be = s( 'core/block-editor' );
			var block = be.getBlock( clientId );
			if ( ! block ) { return []; }
			return ( block.innerBlocks || [] )
				.filter( function ( b ) { return b.name === 'roam/section'; } )
				.map( function ( b ) {
					return {
						clientId:    b.clientId,
						anchorName:  ( b.attributes && b.attributes.anchorName )  || '',
						anchorLabel: ( b.attributes && b.attributes.anchorLabel ) || '',
						isActive:    be.isBlockSelected( b.clientId ) || be.hasSelectedInnerBlock( b.clientId, true )
					};
				} );
		}, [ clientId, nestedZoom ] );

		function jumpToSection( sectionClientId ) {
			dispatch( 'core/block-editor' ).selectBlock( sectionClientId );
			// Wait one frame for the selection to render, then scroll into view.
			// In WP 6.x the block list is inside an iframe — fall back to it.
			requestAnimationFrame( function () {
				var node = document.querySelector( '[data-block="' + sectionClientId + '"]' );
				if ( ! node ) {
					var iframes = document.querySelectorAll( 'iframe[name="editor-canvas"]' );
					for ( var i = 0; i < iframes.length && ! node; i++ ) {
						try {
							node = iframes[ i ].contentDocument.querySelector( '[data-block="' + sectionClientId + '"]' );
						} catch ( err ) { /* cross-origin — ignore */ }
					}
				}
				if ( node && node.scrollIntoView ) {
					node.scrollIntoView( { behavior: 'smooth', block: 'start' } );
				}
			} );
		}

		function addSection() {
			var block = createBlock( 'roam/section', {
				anchorName:  'tier-' + ( sectionTabs.length + 1 ),
				anchorLabel: 'Tier ' + ( sectionTabs.length + 1 )
			} );
			dispatch( 'core/block-editor' ).insertBlock( block, undefined, clientId, true );
		}
		var innerBlocksProps = nestedZoom
			? wp.blockEditor.useInnerBlocksProps(
				{ className: 'roam-editor-stack' },
				{
					allowedBlocks: [ 'roam/section' ],
					template: [
						[ 'roam/section', { anchorName: 'hero', anchorLabel: 'Home' } ],
						[ 'roam/section', { anchorName: 'detail', anchorLabel: 'Detail' } ]
					],
					templateLock: false,
					orientation: 'vertical',
					renderAppender: wp.blockEditor.InnerBlocks.ButtonBlockAppender
				}
			)
			: wp.blockEditor.useInnerBlocksProps(
				{
					ref: worldRef,
					className: 'roam-editor-world' + ( showGrid ? ' has-grid' : '' ),
					style: {
						width: worldWidth + 'px',
						height: worldHeight + 'px'
					}
				},
				{
					allowedBlocks: [ 'roam/node' ],
					renderAppender: false,
					templateLock: false,
					orientation: 'horizontal'
				}
			);

		var blockProps = useBlockProps( {
			className: nestedZoom ? 'roam-editor-canvas-stacked' : 'roam-editor-viewport',
			ref: viewportRef
		} );

		return el( Fragment, null,
			el( BlockControls, null,
				el( ToolbarGroup, null,
					el( ToolbarButton, {
						icon: 'plus-alt2',
						label: 'Add node',
						onClick: addNode
					} ),
					el( ToolbarButton, {
						icon: 'search',
						label: 'Zoom in',
						onClick: function () { zoom( 1.25 ); }
					} ),
					el( ToolbarButton, {
						icon: 'minus',
						label: 'Zoom out',
						onClick: function () { zoom( 1 / 1.25 ); }
					} ),
					el( ToolbarButton, {
						icon: 'image-rotate',
						label: 'Reset view',
						onClick: resetView
					} )
				)
			),
			el( InspectorControls, null,
				el( PanelBody, { title: 'World', initialOpen: true },
					el( RangeControl, {
						label: 'World width',
						value: worldWidth,
						min: 800, max: 16000, step: 100,
						onChange: function ( v ) { setAttributes( { worldWidth: v || 4000 } ); }
					} ),
					el( RangeControl, {
						label: 'World height',
						value: worldHeight,
						min: 600, max: 16000, step: 100,
						onChange: function ( v ) { setAttributes( { worldHeight: v || 3000 } ); }
					} ),
					el( ToggleControl, {
						label: 'Show grid',
						checked: !! showGrid,
						onChange: function ( v ) { setAttributes( { showGrid: !! v } ); }
					} )
				),
				el( PanelBody, { title: 'Zoom', initialOpen: false },
					el( RangeControl, {
						label: 'Initial zoom',
						value: attributes.initialZoom,
						min: 0.1, max: 4, step: 0.05,
						onChange: function ( v ) { setAttributes( { initialZoom: v || 1 } ); }
					} ),
					el( RangeControl, {
						label: 'Min zoom',
						value: minZoom,
						min: 0.05, max: 1, step: 0.05,
						onChange: function ( v ) { setAttributes( { minZoom: v || 0.25 } ); }
					} ),
					el( RangeControl, {
						label: 'Max zoom',
						value: maxZoom,
						min: 1, max: 10, step: 0.25,
						onChange: function ( v ) { setAttributes( { maxZoom: v || 4 } ); }
					} )
				),
				el( PanelBody, { title: 'Initial offset', initialOpen: false },
					el( Button, {
						variant: 'secondary',
						onClick: function () {
							var s = viewState.current;
							setAttributes( {
								initialX: Math.round( s.x ),
								initialY: Math.round( s.y ),
								initialZoom: parseFloat( s.z.toFixed( 3 ) ),
								hasInitialOffset: true
							} );
						}
					}, 'Save current view as initial' )
				),
				el( PanelBody, { title: 'Presentation', initialOpen: true },
					el( wp.components.SelectControl, {
						label: 'View mode',
						value: attributes.viewMode || 'boxed',
						options: [
							{ label: 'Boxed (16:10 frame)', value: 'boxed' },
							{ label: 'Fullscreen (fills viewport)', value: 'fullscreen' }
						],
						onChange: function ( v ) { setAttributes( { viewMode: v || 'boxed' } ); }
					} ),
					el( ToggleControl, {
						label: 'Show anchor menu',
						help: 'Display a floating navigation menu listing all anchored nodes.',
						checked: !! attributes.showAnchorMenu,
						onChange: function ( v ) { setAttributes( { showAnchorMenu: !! v } ); }
					} ),
					el( ToggleControl, {
						label: 'Fit world on load',
						help: 'Frame the entire world to fit the viewport when the page loads.',
						checked: !! attributes.fitOnLoad,
						onChange: function ( v ) { setAttributes( { fitOnLoad: !! v } ); }
					} ),
					el( wp.components.TextControl, {
						label: 'Initial anchor',
						help: 'Open framed on this anchor name (overrides fit-on-load if set).',
						value: attributes.initialAnchor || '',
						onChange: function ( v ) { setAttributes( { initialAnchor: v || '' } ); }
					} ),
					el( ToggleControl, {
						label: 'Nested-zoom navigation',
						help: 'Scroll wheel dives into the next anchor; wheel-up backs out. Best for infinite-zoom posts.',
						checked: !! attributes.nestedZoom,
						onChange: function ( v ) { setAttributes( { nestedZoom: !! v } ); }
					} ),
					el( RangeControl, {
						label: 'Transition (ms)',
						value: attributes.flyDuration || 900,
						min: 200, max: 3000, step: 50,
						onChange: function ( v ) { setAttributes( { flyDuration: v || 900 } ); }
					} )
				)
			),
			el( 'div', blockProps,
				nestedZoom
					? el( 'div', { className: 'roam-editor-section-switcher' },
						el( 'div', { className: 'roam-editor-section-switcher-row' },
							el( 'div', { className: 'roam-editor-section-switcher-label' },
								'Sections · ' + sectionTabs.length
							),
							el( 'button', {
								type: 'button',
								className: 'roam-editor-section-switcher-add',
								onClick: addSection,
								title: 'Add a new section'
							}, '+ section' )
						),
						sectionTabs.length
							? el( 'div', { className: 'roam-editor-section-switcher-tabs' },
								sectionTabs.map( function ( t, i ) {
									return el( 'button', {
										key: t.clientId,
										type: 'button',
										className: 'roam-editor-section-tab' + ( t.isActive ? ' is-active' : '' ),
										onClick: function () { jumpToSection( t.clientId ); },
										title: 'Jump to ' + ( t.anchorLabel || t.anchorName || ( 'tier ' + ( i + 1 ) ) )
									},
										el( 'span', { className: 'roam-editor-section-tab-num' }, String( i + 1 ) ),
										el( 'span', { className: 'roam-editor-section-tab-label' },
											t.anchorLabel || t.anchorName || ( 'tier ' + ( i + 1 ) )
										)
									);
								} )
							)
							: el( 'div', { className: 'roam-editor-section-switcher-empty' },
								'No sections yet — add one to get started.'
							)
					)
					: null,
				el( 'div', innerBlocksProps ),
				! nestedZoom
					? el( 'div', { className: 'roam-editor-hud' },
						el( 'button', {
							type: 'button',
							className: 'roam-editor-hud-btn',
							onClick: function () { zoom( 1.25 ); }
						}, '+' ),
						el( 'button', {
							type: 'button',
							className: 'roam-editor-hud-btn',
							onClick: function () { zoom( 1 / 1.25 ); }
						}, '−' ),
						el( 'button', {
							type: 'button',
							className: 'roam-editor-hud-btn',
							onClick: resetView,
							title: 'Reset view'
						}, '◎' ),
						el( 'button', {
							type: 'button',
							className: 'roam-editor-hud-btn roam-editor-hud-add',
							onClick: addNode,
							title: 'Add node'
						}, '+ node' )
					)
					: null,
				! nestedZoom
					? el( 'div', { className: 'roam-editor-hint' },
						'drag empty space to pan · wheel to zoom · drag a node to move it'
					)
					: el( 'div', { className: 'roam-editor-hint roam-editor-hint-stacked' },
						'click any tab above to jump · click a section header to fold it'
					)
			)
		);
	}

	registerBlockType( 'roam/canvas', {
		edit: CanvasEdit,
		save: function ( props ) {
			var a = props.attributes;
			// In nested-zoom mode, save just persists the section markup;
			// the PHP render_callback composes the world wrapper on render.
			if ( a.nestedZoom ) {
				return el( InnerBlocks.Content );
			}
			var blockProps = wp.blockEditor.useBlockProps.save( {
				className: 'roam-canvas' + ( a.viewMode === 'fullscreen' ? ' is-fullscreen' : '' ),
				'data-world-width':  a.worldWidth,
				'data-world-height': a.worldHeight,
				'data-initial-zoom': a.initialZoom,
				'data-min-zoom':     a.minZoom,
				'data-max-zoom':     a.maxZoom,
				'data-initial-x':    a.initialX,
				'data-initial-y':    a.initialY,
				'data-has-initial-offset': a.hasInitialOffset ? '1' : '0',
				'data-show-grid':    a.showGrid ? '1' : '0',
				'data-view-mode':    a.viewMode || 'boxed',
				'data-show-anchor-menu': a.showAnchorMenu ? '1' : '0',
				'data-initial-anchor':   a.initialAnchor || '',
				'data-fit-on-load':      a.fitOnLoad ? '1' : '0',
				'data-nested-zoom':      a.nestedZoom ? '1' : '0',
				'data-fly-duration':     a.flyDuration || 900
			} );
			return el( 'div', blockProps,
				el( 'div', {
					className: 'roam-world' + ( a.showGrid ? ' has-grid' : '' ),
					style: {
						width: a.worldWidth + 'px',
						height: a.worldHeight + 'px'
					}
				}, el( InnerBlocks.Content ) ),
				el( 'div', { className: 'roam-controls', 'aria-hidden': 'false' },
					el( 'button', { type: 'button', className: 'roam-ctrl', 'data-roam-act': 'in',    'aria-label': 'Zoom in'  }, '+' ),
					el( 'button', { type: 'button', className: 'roam-ctrl', 'data-roam-act': 'out',   'aria-label': 'Zoom out' }, '−' ),
					el( 'button', { type: 'button', className: 'roam-ctrl', 'data-roam-act': 'reset', 'aria-label': 'Reset'    }, '◎' )
				),
				el( 'div', { className: 'roam-hint' }, 'drag to pan · wheel / pinch to zoom · press 0 to reset' )
			);
		}
	} );

} )( window.wp );
