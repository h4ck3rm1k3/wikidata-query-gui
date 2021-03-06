var wikibase = wikibase || {};
wikibase.queryService = wikibase.queryService || {};
wikibase.queryService.ui = wikibase.queryService.ui || {};

wikibase.queryService.ui.App = ( function( $, download, window, _, Cookies, moment ) {
	'use strict';

	var SHORTURL_API = '//tinyurl.com/api-create.php?url=';
	var RAWGRAPHS_BASE_URL = 'http://wikidata.rawgraphs.io/?url=';

	var TRACKING_NAMESPACE = 'wikibase.queryService.ui.app.';

	/**
	 * A ui application for the Wikibase query service
	 *
	 * @class wikibase.queryService.ui.App
	 * @license GNU GPL v2+
	 *
	 * @author Stanislav Malyshev
	 * @author Jonas Kress
	 * @constructor
	 *
	 * @param {jQuery} $element
	 * @param {wikibase.queryService.ui.editor.Editor} editor
	 * @param {wikibase.queryService.api.Sparql} queryHelper
	 */
	function SELF( $element, editor, queryHelper, sparqlApi, querySamplesApi ) {
		this._$element = $element;
		this._editor = editor;
		this._queryHelper = queryHelper;
		this._sparqlApi = sparqlApi;
		this._querySamplesApi = querySamplesApi;

		this._init();
	}

	/**
	 * @property {string}
	 * @private
	 */
	SELF.prototype._$element = null;

	/**
	 * @property {wikibase.queryService.ui.ResultView}
	 * @private
	 */
	SELF.prototype._resultView = null;

	/**
	 * @property {wikibase.queryService.api.Sparql}
	 * @private
	 */
	SELF.prototype._sparqlApi = null;

	/**
	 * @property {wikibase.queryService.api.QuerySamples}
	 * @private
	 */
	SELF.prototype._querySamplesApi = null;

	/**
	 * @property {wikibase.queryService.ui.editor.Editor}
	 * @private
	 */
	SELF.prototype._editor = null;

	/**
	 * @property {wikibase.queryService.ui.queryHelper.QueryHelper}
	 * @private
	 */
	SELF.prototype._queryHelper = null;

	/**
	 * @property {boolean}
	 * @private
	 */
	SELF.prototype._isHistoryDisabled = false;

	/**
	 * @property {wikibase.queryService.api.Tracking}
	 * @private
	 */
	SELF.prototype._trackingApi = null;

	/**
	 * @property {boolean}
	 * @private
	 */
	SELF.prototype._hasRunFirstQuery = false;

	/**
	 * Initialize private members and call delegate to specific init methods
	 *
	 * @private
	 */
	SELF.prototype._init = function() {
		if ( !this._sparqlApi ) {
			this._sparqlApi = new wikibase.queryService.api.Sparql();
		}

		if ( !this._resultView ) {
			this._resultView = new wikibase.queryService.ui.ResultView( this._sparqlApi );
		}

		if ( !this._querySamplesApi ) {
			this._querySamplesApi = new wikibase.queryService.api.QuerySamples();
		}

		if ( !this._trackingApi ) {
			this._trackingApi = new wikibase.queryService.api.Tracking();
		}

		if ( !this._editor ) {
			this._editor = new wikibase.queryService.ui.editor.Editor();
		}

		this._track( 'init' );

		this._initApp();
		this._initEditor();
		this._initQueryHelper();
		this._initExamples();
		this._initDataUpdated();
		this._initQuery();
		this._initRdfNamespaces();
		this._initHandlers();
	};

	/**
	 * @private
	 */
	SELF.prototype._initApp = function() {
		// ctr + enter executes query
		$( window ).keydown( function( e ) {
			if ( e.ctrlKey && e.keyCode === 13 ) {
				$( '#execute-button' ).click();
			}
		} );

		// add tooltip to dropdown
		$( '#display-button' ).tooltip();
		$( '#download-button' ).tooltip();
		$( '#link-button' ).tooltip();

		this._actionBar = new wikibase.queryService.ui.toolbar.Actionbar( $( '.action-bar' ) );
	};

	/**
	 * @private
	 */
	SELF.prototype._initEditor = function() {
		this._editor.fromTextArea( this._$element.find( '.queryEditor' )[0] );

		// if(window.history.pushState) {//this works only in modern browser
		// this._editor.registerCallback( 'change', $.proxy( this._updateQueryUrl, this) );
		// }
	};

	/**
	 * @private
	 */
	SELF.prototype._initQueryHelper = function() {
		var self = this,
			cookieHide = 'query-helper-hide';

		if ( !this._queryHelper ) {
			this._queryHelper = new wikibase.queryService.ui.queryHelper.QueryHelper();
		}
		this._queryHelper.setChangeListener( function( ve ) {
			self._editor.setValue( ve.getQuery() );
		} );

		if ( Cookies.get( cookieHide ) === 'true' ) {
			$( '.query-helper-trigger' ).show();
		}

		if ( this._editor ) {
			this._editor.registerCallback( 'change', _.debounce( function() {
				if ( $( '.query-helper-trigger' ).is( ':visible' ) ||
						self._editor.getValue() === self._queryHelper.getQuery() ) {
					return;
				}

				$( '.query-helper' ).hide();
				self._drawQueryHelper();
			}, 1500 ) );
		}

		$( '.query-helper .panel-heading .close' ).click( function() {
			Cookies.set( cookieHide, true );
			$( '.query-helper' ).hide();
			$( '.query-helper-trigger' ).show();
			return false;
		} );

		$( '.query-helper-trigger' ).click( function() {
			$( '.query-helper-trigger' ).hide();
			Cookies.set( cookieHide, false );
			self._drawQueryHelper();
			return false;
		} );
	};

	/**
	 * @private
	 */
	SELF.prototype._drawQueryHelper = function() {
		try {
			this._queryHelper.setQuery( this._editor.getValue() );
			this._queryHelper.draw( $( '.query-helper .panel-body' ) );

			$( '.query-helper' ).delay( 500 ).fadeIn();
		} catch ( e ) {
			window.console.error( e );
		}
	};

	/**
	 * @private
	 */
	SELF.prototype._initExamples = function() {
		var self = this;
		new wikibase.queryService.ui.QueryExampleDialog( $( '#QueryExamples' ),
				this._querySamplesApi, function( query, title ) {
					if ( !query || !query.trim() ) {
						return;
					}

					self._editor.setValue( '#' + title + '\n' + query );
				} );
	};

	/**
	 * @private
	 */
	SELF.prototype._initRdfNamespaces = function() {
		var category,
			select,
			ns,
			container = $( '.namespace-shortcuts' ),
			namespaces = wikibase.queryService.RdfNamespaces.NAMESPACE_SHORTCUTS;

		container.click( function( e ) {
			e.stopPropagation();
		} );

		// add namespaces to dropdowns
		for ( category in namespaces ) {
			select = $( '<select>' ).attr( 'class', 'form-control' ).append(
					$( '<option>' ).text( category ) ).appendTo( container );
			for ( ns in namespaces[category] ) {
				select.append(
					$( '<option>' ).text( ns ).attr( 'value', namespaces[category][ns] )
				);
			}
		}
	};

	/**
	 * @private
	 */
	SELF.prototype._initQuery = function() {
		if ( window.location.hash !== '' ) {
			if ( location.hash.indexOf( '#result#' ) === 0 ) {
				location.hash = location.hash.replace( '#result#', '#' );
			}

			this._isHistoryDisabled = true;
			this._editor.setValue( decodeURIComponent( window.location.hash.substr( 1 ) ) );
			this._editor.refresh();
			this._isHistoryDisabled = false;
		}
	};

	/**
	 * @private
	 */
	SELF.prototype._initDataUpdated = function() {
		var self = this,
			$label = $( '.dataUpdated' );

		var updateDataStatus = function() {
			self._sparqlApi.queryDataUpdatedTime().done( function( time, difference ) {
				var updatestatustext = moment.duration( difference, 'seconds' ).humanize(),
					labelClass,
					badge;

				if ( difference <= 60 * 2 ) {
					labelClass = 'list-group-item-success';
				} else if ( difference <= 60 * 15 ) {
					labelClass =  'list-group-item-warning';
				} else {
					labelClass = 'list-group-item-danger';
				}
				badge = '<span class="badge ' + labelClass + '">' + updatestatustext + '</span>';
				$label.html( $.i18n( 'wdqs-app-footer-updated', badge ) );
			} );
		};

		updateDataStatus();

		window.setInterval( updateDataStatus, 10 * 60 * 1000 );

		$label.hover( function() {
			updateDataStatus();

			var e = $( this );
			self._sparqlApi.queryDataUpdatedTime().done( function( time, difference ) {
				e.popover( {
					html: true,
					placement: 'top',
					content: $.i18n( 'wdqs-app-footer-updated-seconds', difference ) + '.</br>' + time
				} ).popover( 'show' );
			} ).fail( function() {
				e.popover( {
					content: '[unable to connect]'
				} ).popover( 'show' );
			} );
		}, function() {
			var e = $( this );
			e.popover( 'destroy' );
		} );
	};

	/**
	 * @private
	 */
	SELF.prototype._initHandlers = function() {
		var self = this;

		$( '#query-form' ).submit( $.proxy( this._handleQuerySubmit, this ) );
		$( '.namespace-shortcuts' ).on( 'change', 'select',
				$.proxy( this._handleNamespaceSelected, this ) );

		$( '.addPrefixes' ).click( function() {
			var standardPrefixes = wikibase.queryService.RdfNamespaces.STANDARD_PREFIXES,
				prefixes = Object.keys( standardPrefixes ).map( function( x ) {
					return standardPrefixes[x];
				} ).join( '\n' );

			self._editor.prepandValue( prefixes + '\n\n' );
			self._track( 'buttonClick.addPrefixes' );
		} );

		$( '[data-target="#QueryExamples"]' ).click( function() {
			self._track( 'buttonClick.examples' );
		} );

		$( '#clear-button' ).click( function() {
			self._editor.setValue( '' );
			self._track( 'buttonClick.clear' );
		} );

		$( '.explorer-close' ).click( function( e ) {
			e.preventDefault();
			$( '.explorer-panel' ).hide();
		} );

		$( '.restore' ).click( function( e ) {
			e.preventDefault();
			self._editor.restoreValue();
		} );

		$( '.fullscreen' ).click( function( e ) {
			e.preventDefault();
			self._editor.toggleFullscreen();
			self._editor.focus();
		} );

		$( window ).on( 'popstate', $.proxy( this._initQuery, this ) );

		this._initPopovers();
		this._initHandlersDownloads();
	};

	/**
	 * @private
	 */
	SELF.prototype._initPopovers = function() {
		var self = this;

		$( '.shortUrlTrigger.query' ).clickover( {
			placement: 'right',
			'global_close': true,
			'html': true,
			'content': function() {
				self._updateQueryUrl();
				return '<iframe ' +
					'class="shortUrl" ' +
					'src="' + SHORTURL_API + encodeURIComponent( window.location ) + '" ' +
					'referrerpolicy="origin" ' +
					'sandbox="" ' +
					'></iframe>';
			}
		} ).click( function() {
			self._track( 'buttonClick.shortUrlQuery' );
		} );

		$( '.shortUrlTrigger.result' ).clickover( {
			placement: 'left',
			'global_close': true,
			'html': true,
			'content': function() {
				self._updateQueryUrl();
				var $link = $( '<a>' ).attr( 'href', 'embed.html' + window.location.hash );
				return '<iframe ' +
					'class="shortUrl" ' +
					'src="' + SHORTURL_API + encodeURIComponent( $link[0].href ) + '" ' +
					'referrerpolicy="origin" ' +
					'sandbox="" ' +
					'></iframe>';
			}
		} ).click( function() {
			self._track( 'buttonClick.shortUrlResult' );
		} );

		$( '.embed.result' ).clickover( {
			placement: 'left',
			'global_close': true,
			'html': true,
			'content': function() {
				self._updateQueryUrl();

				var b = '';
				if ( self._selectedResultBrowser ) {
					b = '#defaultView:' + self._selectedResultBrowser + '\n';
					b = encodeURIComponent( b );
				}
				var $link = $( '<a>' )
					.attr( 'href', 'embed.html#' + b + window.location.hash.substring( 1 ) );
				var $html = $( '<textarea>' ).text(
					'<iframe ' +
						'style="width: 80vw; height: 50vh; border: none;" ' +
						'src="' + $link[0].href + '" ' +
						'referrerpolicy="origin" ' +
						'sandbox="allow-scripts allow-same-origin allow-popups" ' +
						'></iframe>'
				).click( function() {
					$html.select();
				} );

				return $html;
			}
		} ).click( function() {
			self._track( 'buttonClick.embedResult' );
		} );
	};

	/**
	 * @private
	 */
	SELF.prototype._initHandlersDownloads = function() {
		var api = this._sparqlApi;
		var DOWNLOAD_FORMATS = {
			'CSV': {
				handler: $.proxy( api.getResultAsCsv, api ),
				mimetype: 'text/csv;charset=utf-8'
			},
			'JSON': {
				handler: $.proxy( api.getResultAsJson, api ),
				mimetype: 'application/json;charset=utf-8'
			},
			'TSV': {
				handler: $.proxy( api.getSparqlTsv, api ),
				mimetype: 'text/tab-separated-values;charset=utf-8'
			},
			'Simple TSV': {
				handler: $.proxy( api.getSimpleTsv, api ),
				mimetype: 'text/tab-separated-values;charset=utf-8',
				ext: 'tsv'
			},
			'Full JSON': {
				handler: $.proxy( api.getResultAsAllJson, api ),
				mimetype: 'application/json;charset=utf-8',
				ext: 'json'
			},
			'SVG': {
				handler: function() {
					var $svg = $( '#query-result svg' );

					if ( !$svg.length ) {
						return null;
					}

					$svg.attr( {
						version: '1.1',
						'xmlns': 'http://www.w3.org/2000/svg',
						'xmlns:svg': 'http://www.w3.org/2000/svg',
						'xmlns:xlink': 'http://www.w3.org/1999/xlink'
					} );

					try {
						return '<?xml version="1.0" encoding="utf-8"?>\n'
							+ window.unescape( encodeURIComponent( $svg[0].outerHTML ) );
					} catch ( ex ) {
						return null;
					}
				},
				mimetype: 'data:image/svg+xml;charset=utf-8',
				ext: 'svg'
			}
		};

		var self = this;
		var downloadHandler = function( filename, handler, mimetype ) {
			return function( e ) {
				e.preventDefault();

				// see: http://danml.com/download.html
				self._track( 'buttonClick.download.' + filename );

				var data = handler();

				if ( data ) {
					download( data, filename, mimetype );
				}
			};
		};

		for ( var format in DOWNLOAD_FORMATS ) {
			var extension = DOWNLOAD_FORMATS[format].ext || format.toLowerCase();
			var formatName = format.replace( /\s/g, '-' );
			$( '#download' + formatName ).click( downloadHandler(
				'query.' + extension,
				DOWNLOAD_FORMATS[format].handler,
				DOWNLOAD_FORMATS[format].mimetype
			) );
		}
	};

	/**
	 * @private
	 */
	SELF.prototype._handleQuerySubmit = function( e ) {
		var self = this;

		if ( !this._hasRunFirstQuery ) {
			this._track( 'firstQuery' );
			this._hasRunFirstQuery = true;
		}

		e.preventDefault();
		this._editor.save();
		this._updateQueryUrl();

		$( '#execute-button' ).prop( 'disabled', true );
		this._resultView.draw( this._editor.getValue() ).fail( function ( error ) {
			self._editor.highlightError( error );
		} ).always( function () {
			$( '#execute-button' ).prop( 'disabled', false );
		} );

		$( '.queryUri' ).attr( 'href', self._sparqlApi.getQueryUri() );
		$( '.rawGraphsUri' ).attr( 'href', RAWGRAPHS_BASE_URL + encodeURIComponent( self._sparqlApi.getQueryUri() ) );
	};

	/**
	 * @private
	 */
	SELF.prototype._handleNamespaceSelected = function( e ) {
		var ns,
			uri = e.target.value,
			current = this._editor.getValue();

		if ( current.indexOf( '<' + uri + '>' ) === -1 ) {
			ns = $( e.target ).find( ':selected' ).text();
			this._editor.setValue( 'PREFIX ' + ns + ': <' + uri + '>\n' + current );
		}

		// reselect group label
		e.target.selectedIndex = 0;
	};

	/**
	 * @private
	 */
	SELF.prototype._updateQueryUrl = function() {
		if ( this._isHistoryDisabled ) {
			return;
		}

		var hash = encodeURIComponent( this._editor.getValue() );
		hash = hash.replace( /[!'()*]/g, function( c ) {
			return '%' + c.charCodeAt( 0 ).toString( 16 );
		} );

		if ( window.location.hash !== hash ) {
			if ( window.history.pushState ) {
				window.history.pushState( null, null, '#' + hash );
			} else {
				window.location.hash = hash;
			}
		}
	};

	/**
	 * @private
	 */
	SELF.prototype._track = function( metricName, value, valueType ) {
		this._trackingApi.track( TRACKING_NAMESPACE + metricName, value, valueType );
	};

	return SELF;

}( jQuery, download, window, _, Cookies, moment ) );
