/**
 * Roam Section — Editor script
 *
 * A simple stacked container for nested-zoom canvases. In the editor it
 * renders as a normal full-width block (like a core/group); on the frontend
 * the parent canvas's PHP render_callback wraps it with the world positioning
 * + inner-scale transform that produces the infinite-zoom effect.
 *
 * Sections collapse when they're not the active selection so authors can
 * see and reach every section without scrolling past tall hero content.
 */
( function ( wp ) {
	'use strict';

	var el = wp.element.createElement;
	var Fragment = wp.element.Fragment;
	var useSelect = wp.data.useSelect;
	var useState = wp.element.useState;

	var registerBlockType = wp.blocks.registerBlockType;
	var InnerBlocks = wp.blockEditor.InnerBlocks;
	var useBlockProps = wp.blockEditor.useBlockProps;
	var useInnerBlocksProps = wp.blockEditor.useInnerBlocksProps;
	var InspectorControls = wp.blockEditor.InspectorControls;

	var PanelBody = wp.components.PanelBody;
	var TextControl = wp.components.TextControl;
	var TextareaControl = wp.components.TextareaControl;
	var ColorPalette = wp.components.ColorPalette;

	function slugify( s ) {
		return ( s || '' ).toLowerCase().replace( /[^a-z0-9-]+/g, '-' ).replace( /^-+|-+$/g, '' );
	}

	function SectionEdit( props ) {
		var attributes = props.attributes;
		var setAttributes = props.setAttributes;
		var clientId = props.clientId;
		var isSelected = props.isSelected;

		// Read this section's tier (position among siblings in the canvas)
		// plus whether the selection lives inside this section.
		var info = useSelect( function ( select ) {
			var be = select( 'core/block-editor' );
			var parents = be.getBlockParentsByBlockName( clientId, 'roam/canvas' );
			if ( ! parents.length ) {
				return { tier: -1, total: 0, hasInner: false };
			}
			var canvas = parents[ 0 ];
			var inner = be.getBlock( canvas ).innerBlocks || [];
			var sections = inner.filter( function ( b ) { return b.name === 'roam/section'; } );
			var idx = sections.findIndex( function ( b ) { return b.clientId === clientId; } );
			return {
				tier: idx,
				total: sections.length,
				hasInner: be.hasSelectedInnerBlock( clientId, true )
			};
		}, [ clientId ] );

		var isActive = isSelected || info.hasInner;
		// Default: expand the first tier and whichever section is being edited.
		// Once the user toggles manually, we honour that until reload.
		var defaultOpen = info.tier === 0 || isActive;
		var overrideState = useState( null );
		var override = overrideState[ 0 ];
		var setOverride = overrideState[ 1 ];
		var isOpen = override === null ? defaultOpen : override;

		function toggleOpen( e ) {
			if ( e && e.stopPropagation ) { e.stopPropagation(); }
			setOverride( ! isOpen );
		}
		function onHeaderKey( e ) {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				e.preventDefault();
				toggleOpen( e );
			}
		}

		var blockProps = useBlockProps( {
			className: 'roam-editor-section'
				+ ( info.tier === 0 ? ' is-tier-0' : '' )
				+ ( isOpen ? ' is-open' : ' is-collapsed' )
				+ ( isActive ? ' is-active' : '' )
		} );

		var innerBlocksProps = useInnerBlocksProps(
			{ className: 'roam-editor-section-inner' },
			{
				template: [
					[ 'core/heading', { level: 2, placeholder: 'Section title…' } ],
					[ 'core/paragraph', { placeholder: 'Write the body. Add columns, images, buttons — anything Gutenberg knows.' } ]
				],
				templateLock: false,
				renderAppender: InnerBlocks.ButtonBlockAppender
			}
		);

		var displayName = attributes.anchorName || ( info.tier >= 0 ? 'section-' + ( info.tier + 1 ) : 'section' );

		return el( Fragment, null,
			el( InspectorControls, null,
				el( PanelBody, { title: 'Section', initialOpen: true },
					el( TextControl, {
						label: 'Anchor name',
						help: 'Short ID used to link to this section (e.g., "hero"). Auto-generated from the title if left blank.',
						value: attributes.anchorName || '',
						onChange: function ( v ) { setAttributes( { anchorName: slugify( v ) } ); }
					} ),
					el( TextControl, {
						label: 'Menu label',
						help: 'Friendly label shown in the anchor menu. Defaults to the anchor name.',
						value: attributes.anchorLabel || '',
						onChange: function ( v ) { setAttributes( { anchorLabel: v } ); }
					} ),
					info.tier >= 0
						? el( 'p', { style: { fontSize: '11px', opacity: 0.7, marginTop: '8px' } },
							'Tier ' + ( info.tier + 1 ) + ' of ' + info.total + ' · drag in list view to reorder' )
						: null
				),
				el( PanelBody, { title: 'Background', initialOpen: false },
					el( 'p', { style: { fontSize: '11px', opacity: 0.7, margin: '0 0 12px' } },
						'A default per-tier gradient is used when these are empty.' ),
					el( 'label', { style: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' } }, 'Solid background colour' ),
					el( ColorPalette, {
						value: attributes.bgColor || '',
						onChange: function ( v ) { setAttributes( { bgColor: v || '' } ); },
						clearable: true
					} ),
					el( TextareaControl, {
						label: 'Custom gradient (advanced)',
						help: 'Any valid CSS background value. Overrides solid colour.',
						value: attributes.bgGradient || '',
						onChange: function ( v ) { setAttributes( { bgGradient: v || '' } ); },
						rows: 3
					} ),
					el( 'label', { style: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px', marginTop: '12px' } }, 'Accent colour' ),
					el( ColorPalette, {
						value: attributes.accentColor || '',
						onChange: function ( v ) { setAttributes( { accentColor: v || '' } ); },
						clearable: true
					} )
				)
			),
			el( 'div', blockProps,
				el( 'div', {
						className: 'roam-editor-section-header',
						onClick: toggleOpen,
						onKeyDown: onHeaderKey,
						role: 'button',
						tabIndex: 0,
						'aria-expanded': isOpen ? 'true' : 'false',
						title: isOpen ? 'Click to collapse this section' : 'Click to expand this section'
					},
					el( 'span', { className: 'roam-editor-section-chevron', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸' ),
					el( 'span', { className: 'roam-editor-section-tier' },
						info.tier >= 0 ? ( 'TIER ' + ( info.tier + 1 ) ) : 'SECTION'
					),
					el( 'span', { className: 'roam-editor-section-name' }, '⌖ ' + displayName ),
					! isOpen
						? el( 'span', { className: 'roam-editor-section-collapsed-tag' }, 'collapsed' )
						: null
				),
				el( 'section', innerBlocksProps )
			)
		);
	}

	registerBlockType( 'roam/section', {
		edit: SectionEdit,
		save: function ( props ) {
			var a = props.attributes;
			var saveProps = wp.blockEditor.useBlockProps.save( {
				className: 'roam-section',
				'data-roam-section': '1'
			} );
			if ( a.anchorName ) {
				saveProps[ 'data-anchor-name' ]  = a.anchorName;
				saveProps[ 'data-anchor-label' ] = a.anchorLabel || a.anchorName;
				saveProps.id = 'roam-anchor-' + a.anchorName;
			}
			return el( 'section', saveProps, el( InnerBlocks.Content ) );
		}
	} );

} )( window.wp );
