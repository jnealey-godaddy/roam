/**
 * Roam Node — Editor script
 *
 * A draggable, absolutely-positioned wrapper inside a Roam Canvas.
 * It looks up the parent canvas viewport to figure out the world->screen scale
 * so that 1px of pointer movement maps to 1px of world coordinate at any zoom.
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
	var useInnerBlocksProps = wp.blockEditor.useInnerBlocksProps;
	var BlockControls = wp.blockEditor.BlockControls;
	var InspectorControls = wp.blockEditor.InspectorControls;

	var ToolbarGroup = wp.components.ToolbarGroup;
	var ToolbarButton = wp.components.ToolbarButton;
	var PanelBody = wp.components.PanelBody;
	var RangeControl = wp.components.RangeControl;
	var TextControl = wp.components.TextControl;

	/**
	 * Read the current scale of the surrounding .roam-editor-world by parsing
	 * its transform matrix. Falls back to 1.
	 */
	function getWorldScale( fromEl ) {
		var world = fromEl && fromEl.closest( '.roam-editor-world' );
		if ( ! world ) { return 1; }
		var t = window.getComputedStyle( world ).transform;
		if ( ! t || t === 'none' ) { return 1; }
		// matrix(a, b, c, d, tx, ty)
		var m = t.match( /matrix\(([^)]+)\)/ );
		if ( ! m ) { return 1; }
		var parts = m[1].split( ',' ).map( parseFloat );
		var a = parts[0], b = parts[1];
		var scale = Math.sqrt( a * a + b * b );
		return scale || 1;
	}

	function NodeEdit( props ) {
		var attributes = props.attributes;
		var setAttributes = props.setAttributes;

		var x = attributes.x;
		var y = attributes.y;
		var width = attributes.width;
		var rotation = attributes.rotation;

		var rootRef = useRef( null );
		var handleRef = useRef( null );

		// Drag-to-move via the handle. Children stay editable.
		useEffect( function () {
			var handle = handleRef.current;
			if ( ! handle ) { return; }

			var dragging = false;
			var startCX = 0, startCY = 0;
			var startX = 0, startY = 0;
			var scale = 1;
			var rootEl = null;

			function onDown( e ) {
				if ( e.button !== 0 ) { return; }
				dragging = true;
				rootEl = rootRef.current;
				scale = getWorldScale( rootEl );
				startCX = e.clientX;
				startCY = e.clientY;
				startX = attributes.x;
				startY = attributes.y;
				if ( rootEl ) { rootEl.classList.add( 'is-dragging' ); }
				e.preventDefault();
				e.stopPropagation();
			}
			function onMove( e ) {
				if ( ! dragging ) { return; }
				var dx = ( e.clientX - startCX ) / scale;
				var dy = ( e.clientY - startCY ) / scale;
				var nx = Math.round( startX + dx );
				var ny = Math.round( startY + dy );
				// live preview without dispatching every move (cheap)
				if ( rootEl ) {
					rootEl.style.transform =
						'translate(' + nx + 'px, ' + ny + 'px) rotate(' + rotation + 'deg)';
					rootEl.dataset.lx = nx;
					rootEl.dataset.ly = ny;
				}
			}
			function onUp() {
				if ( ! dragging ) { return; }
				dragging = false;
				if ( rootEl ) {
					rootEl.classList.remove( 'is-dragging' );
					var nx = parseInt( rootEl.dataset.lx, 10 );
					var ny = parseInt( rootEl.dataset.ly, 10 );
					if ( ! isNaN( nx ) && ! isNaN( ny ) && ( nx !== attributes.x || ny !== attributes.y ) ) {
						setAttributes( { x: nx, y: ny } );
					}
				}
			}

			handle.addEventListener( 'pointerdown', onDown );
			window.addEventListener( 'pointermove', onMove );
			window.addEventListener( 'pointerup', onUp );
			return function () {
				handle.removeEventListener( 'pointerdown', onDown );
				window.removeEventListener( 'pointermove', onMove );
				window.removeEventListener( 'pointerup', onUp );
			};
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [ attributes.x, attributes.y, rotation ] );

		var style = {
			transform: 'translate(' + x + 'px, ' + y + 'px) rotate(' + rotation + 'deg)',
			width: width + 'px'
		};

		var blockProps = useBlockProps( {
			ref: rootRef,
			className: 'roam-editor-node',
			style: style
		} );

		var innerBlocksProps = useInnerBlocksProps(
			{ className: 'roam-editor-node-inner' },
			{
				template: [ [ 'core/paragraph', { placeholder: 'Roam free…' } ] ],
				templateLock: false,
				renderAppender: InnerBlocks.ButtonBlockAppender
			}
		);

		return el( Fragment, null,
			el( BlockControls, null,
				el( ToolbarGroup, null,
					el( ToolbarButton, {
						icon: 'move',
						label: 'Drag handle (top-left of node)'
					} ),
					el( ToolbarButton, {
						icon: 'image-rotate-left',
						label: 'Rotate −15°',
						onClick: function () { setAttributes( { rotation: rotation - 15 } ); }
					} ),
					el( ToolbarButton, {
						icon: 'image-rotate-right',
						label: 'Rotate +15°',
						onClick: function () { setAttributes( { rotation: rotation + 15 } ); }
					} )
				)
			),
			el( InspectorControls, null,
				el( PanelBody, { title: 'Position & size', initialOpen: true },
					el( RangeControl, {
						label: 'X',
						value: x,
						min: -8000, max: 16000, step: 1,
						onChange: function ( v ) { setAttributes( { x: v || 0 } ); }
					} ),
					el( RangeControl, {
						label: 'Y',
						value: y,
						min: -8000, max: 16000, step: 1,
						onChange: function ( v ) { setAttributes( { y: v || 0 } ); }
					} ),
					el( RangeControl, {
						label: 'Width',
						value: width,
						min: 40, max: 4000, step: 10,
						onChange: function ( v ) { setAttributes( { width: v || 320 } ); }
					} ),
					el( RangeControl, {
						label: 'Rotation',
						value: rotation,
						min: -180, max: 180, step: 1,
						onChange: function ( v ) { setAttributes( { rotation: typeof v === 'number' ? v : 0 } ); }
					} )
				),
				el( PanelBody, { title: 'Anchor (jump target)', initialOpen: false },
					el( TextControl, {
						label: 'Anchor name',
						help: 'A short id like "hero" or "pricing". Setting this makes the node a jump target.',
						value: attributes.anchorName || '',
						onChange: function ( v ) { setAttributes( { anchorName: ( v || '' ).trim() } ); }
					} ),
					el( TextControl, {
						label: 'Menu label',
						help: 'Friendly label shown in the anchor menu. Defaults to the anchor name.',
						value: attributes.anchorLabel || '',
						onChange: function ( v ) { setAttributes( { anchorLabel: v || '' } ); }
					} ),
					el( RangeControl, {
						label: 'Frame zoom',
						help: 'Zoom multiplier when flying to this anchor. 1.0 = fit-to-node.',
						value: attributes.frameZoom,
						min: 0.25, max: 4, step: 0.05,
						onChange: function ( v ) { setAttributes( { frameZoom: v || 1 } ); }
					} ),
					el( RangeControl, {
						label: 'Frame padding',
						help: 'Padding around node when framing.',
						value: attributes.framePadding,
						min: 0, max: 400, step: 10,
						onChange: function ( v ) { setAttributes( { framePadding: v || 60 } ); }
					} )
				)
			),
			el( 'div', blockProps,
				el( 'div', {
					ref: handleRef,
					className: 'roam-editor-node-handle',
					title: 'Drag to move'
				}, el( 'span', null, '⠿  ' + Math.round( x ) + ', ' + Math.round( y ) ) ),
				el( 'div', innerBlocksProps )
			)
		);
	}

	registerBlockType( 'roam/node', {
		edit: NodeEdit,
		save: function ( props ) {
			var a = props.attributes;
			var saveProps = {
				className: 'roam-node' + ( a.anchorName ? ' is-anchored' : '' ),
				style: {
					transform: 'translate(' + a.x + 'px, ' + a.y + 'px) rotate(' + a.rotation + 'deg)',
					width: a.width + 'px'
				},
				'data-x': a.x,
				'data-y': a.y,
				'data-width': a.width,
				'data-r': a.rotation
			};
			if ( a.anchorName ) {
				saveProps[ 'data-anchor-name' ]  = a.anchorName;
				saveProps[ 'data-anchor-label' ] = a.anchorLabel || a.anchorName;
				saveProps[ 'data-frame-zoom' ]   = a.frameZoom;
				saveProps[ 'data-frame-padding' ] = a.framePadding;
				saveProps.id = 'roam-anchor-' + a.anchorName;
			}
			var blockProps = useBlockProps.save( saveProps );
			return el( 'div', blockProps, el( InnerBlocks.Content ) );
		}
	} );

} )( window.wp );
