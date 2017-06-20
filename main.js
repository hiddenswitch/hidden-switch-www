/* Copyright:		© 2012 by Vitaly Gordon (rocket.mind@gmail.com)
 * Licensed under:	MIT
 */

Life = _.extends (Viewport, {
	init: function () {
		var bufferWidth = Math.min(512, Math.max(Math.pow(2, Math.ceil(Math.log2(window.innerWidth))), 1024));
		var bufferHeight = Math.min(256, Math.max(Math.pow(2, Math.ceil(Math.log2(window.innerHeight))), 1024));
		_.extend (this, {
			/* shaders */
			randomNoiseShader: this.shaderProgram ({
				vertex: 'cell-vs',
				fragment: 'cell-random-noise-fs',
				attributes: ['position'],
				uniforms: ['seed']
			}),
			iterationShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-iteration-fs',
				attributes: ['position'],
				uniforms: ['previousStep', 'screenSpace', 'pixelOffset', 'rules']
			}),
			parametricBrushShader: this.shaderProgram ({
				vertex: 'cell-vs-pixeloffset',
				fragment: 'cell-brush-fs',
				attributes: ['position'],
				uniforms: ['cells', 'rules', 'brushPosition1', 'brushPosition2', 'brushSize', 'seed',
					'pixelSpace', 'screenSpace', 'pixelOffset', 'noise', 'fill', 'animate']
			}),
			drawCellsShader: this.shaderProgram ({
				vertex: 'simple-vs',
				fragment: 'draw-cells-fs',
				attributes: ['position'],
				uniforms: ['cells', 'transform']
			}),
			/* square mesh */
			square: this.vertexBuffer ({
				type: this.gl.TRIANGLE_STRIP,
				vertices: [
			         1.0,  1.0,  0.0,
			        -1.0,  1.0,  0.0,
			         1.0, -1.0,  0.0,
			        -1.0, -1.0,  0.0
		        ]
			}),
			/* rules */
			rulesBuffer: this.texture ({
				width: 16,
				height: 1,
				data: this.genRulesBufferData (this.rules = [0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
			}),
			/* buffers */
			cellBuffer: null, 												// current
			cellBuffer1: this.renderTexture ({ width: bufferWidth, height: bufferHeight }),	// back
			cellBuffer2: this.renderTexture ({ width: bufferWidth, height: bufferHeight }),	// front
			/* transform matrices */
			transform: new Transform (),
			screenTransform: new Transform (),
			/* changeable parameters */
			brushSize: 16.0,
			maxZoom: 8.0,
			/* other stuff */
			firstFrame: true
		});
		this.cellBuffer = this.cellBuffer1;
		this.fillWithRandomNoise (true);
		this.initUserInput ();

        // Fill with random noise every 18 seconds
        var self = this;
        this.interval = window.setInterval(function() {
            self.fillWithRandomNoise (false);
        }, 18000);
	},
	genRulesBufferData: function (input) {
		return new Uint8Array (_.flatten (_.map (input, function (i) {
			return i == 2 ? [0,255,0,0] : (i == 1 ? [0,0,0,0] : [255,0,0,0])
		})))
	},
	initUserInput: function () {
		$(this.canvas).mousewheel ($.proxy (this.onZoom, this));
		$(this.canvas).bind('mousedown touchstart', $.proxy (function (e) {
			this.onPaintStart (e)
		}, this));
		$(window).resize ($.proxy (function () {
			var container = $('.viewport-container');
			var width = container.width (),
				height = container.height ();
			this.resize (width, height)
		}, this)).resize ()
	},
	eventPoint: function (e) {
		var offset = $(this.canvas).offset ();
		var clientX = e.clientX || (e.originalEvent.touches && e.originalEvent.touches[0].clientX);
		var clientY = e.clientY || (e.originalEvent.touches && e.originalEvent.touches[0].clientY);
		return [
			(clientX - offset.left) / (this.viewportWidth * 0.5) - 1.0,
			(offset.top - clientY) / (this.viewportHeight * 0.5) + 1.0, 0.0]
	},
	onZoom: function (e) {
		var zoom = Math.pow (1.03, e.originalEvent.wheelDelta ?
			(e.originalEvent.wheelDelta / (navigator.platform == 'MacIntel' ? 360.0 : 36.0)) : -e.originalEvent.detail);
		var origin = this.transform.applyInverse (this.eventPoint (e));
		if (zoom < 1 || this.getZoom() < this.maxZoom) {
			this.updateTransform (this.transform.multiply (new Transform ()
				.translate (origin)
				.scale ([zoom, zoom, 1.0])
				.translate ([-origin[0], -origin[1], 0.0])))
		}
	},
	getZoom: function () {
		return vec3.length (vec3.subtract (
				this.transform.apply ([0, 0, 0]),
				this.transform.apply ([1, 0, 0])))
	},
	onPaintStart: function (e) {
		this.paintFrom = this.paintTo = this.eventPoint (e);
		this.shouldPaint = true;
		var onMousemove = $.proxy (function (e) {
			this.paintTo = this.eventPoint (e);
			this.shouldPaint = true
		}, this);
		$(this.canvas).bind('mousemove touchmove', onMousemove);
		$(this.canvas).bind('mouseup touchend', $.proxy (function (e) {
			$(this.canvas).unbind ('mousemove touchmove', onMousemove)
		}, this))
	},
	fillWithRandomNoise: function (firstFrame) {
		this.cellBuffer.draw (function () {
			this.randomNoiseShader.use ();
			this.randomNoiseShader.attributes.position.bindBuffer (this.square);
			this.randomNoiseShader.uniforms.seed.set2f (Math.random (), Math.random ());
			this.square.draw ()
		}, this);
		this.firstFrame = firstFrame;
	},
	springDynamics: function () {
		var zoom = this.getZoom ();
		if (!this.isDragging) {
			if (zoom > 0.99) {
				var center = this.transform.apply ([0, 0, 0]);
				var springForce = [
					(Math.max (0, Math.abs(center[0]) - (zoom - 1))) / zoom,
					(Math.max (0, Math.abs(center[1]) - (zoom - 1))) / zoom];
				this.updateTransform (this.transform.translate ([
					(Math.pow (1.2, springForce[0]) - 1.0) * (center[0] > 0 ? -1 : 1),
					(Math.pow (1.2, springForce[1]) - 1.0) * (center[1] > 0 ? -1 : 1), 0.0]))
			} else {
				this.updateTransform (this.transform.translate (this.transform.applyInverse ([0, 0, 0])))
			}
		}
		if (zoom < 1.0) {
			var springForce = Math.pow (1.2, 1.0 - zoom);
			this.updateTransform (this.transform.scale ([springForce, springForce, 1.0]))
		}
	},
	updateTransform: function (newTransform) {
		var viewportTransform = new Transform ();
		var aspect = this.viewportWidth / this.viewportHeight;
		var bufferAspect = this.cellBuffer.width / this.cellBuffer.height;
		if (aspect > bufferAspect) {
			viewportTransform = viewportTransform.scale ([1.0, aspect / bufferAspect, 1.0])
		} else {
			viewportTransform = viewportTransform.scale ([bufferAspect / aspect, 1.0, 1.0])
		}
		this.transform = newTransform || this.transform;
		this.screenTransform = this.transform.multiply (viewportTransform)
	},
	beforeDraw: function () {
		if (this.shouldPaint) {
			this.paint (true)
		} else {
			this.iterate ()
		}
		this.springDynamics ()
	},
	renderCells: function (callback) {
		/* backbuffering */
		var targetBuffer = (this.cellBuffer == this.cellBuffer1 ? this.cellBuffer2 : this.cellBuffer1);
		targetBuffer.draw (callback, this);
		this.cellBuffer = targetBuffer;
		this.firstFrame = false
	},
	iterate: function () {
		this.renderCells (function () {
			this.iterationShader.use ();
			this.iterationShader.attributes.position.bindBuffer (this.square);
			this.iterationShader.uniforms.previousStep.bindTexture (this.cellBuffer, 0);
			this.iterationShader.uniforms.rules.bindTexture (this.rulesBuffer, 1);
			this.iterationShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height);
			this.iterationShader.uniforms.pixelOffset.set2f (
				0.0 / this.cellBuffer.width,
				-0.5 / this.cellBuffer.height);
		    this.square.draw ()
		})
	},
	paint: function (animate) {
		this.paintParametricBrush (animate);
		this.paintFrom = this.paintTo;
		this.shouldPaint = false
	},
	paintParametricBrush: function (animate) {
		this.renderCells (function () {
			var pixelSpace = new Transform ()
				.scale ([this.viewportWidth, this.viewportHeight, 1.0])
				.multiply (this.screenTransform);
			var texelSize =
				pixelSpace.apply ([0,0,0])[0] -
				pixelSpace.apply ([-1.0 / this.cellBuffer.width, 0, 0])[0];
			this.parametricBrushShader.use ();
			this.parametricBrushShader.attributes.position.bindBuffer (this.square);
			this.parametricBrushShader.uniforms.cells.bindTexture (this.cellBuffer, 0);
			this.parametricBrushShader.uniforms.rules.bindTexture (this.rulesBuffer, 1);
			this.parametricBrushShader.uniforms.brushPosition1.set2fv (this.screenTransform.applyInverse (this.paintFrom));
			this.parametricBrushShader.uniforms.brushPosition2.set2fv (this.screenTransform.applyInverse (this.paintTo));
			this.parametricBrushShader.uniforms.pixelSpace.setMatrix (pixelSpace);
			this.parametricBrushShader.uniforms.pixelOffset.set2f (0.0,
				animate ? (-0.5 / this.cellBuffer.height) : 0.0);
			this.parametricBrushShader.uniforms.screenSpace.set2f (1.0 / this.cellBuffer.width, 1.0 / this.cellBuffer.height);
			this.parametricBrushShader.uniforms.brushSize.set1f (Math.max (this.brushSize, texelSize));
			this.parametricBrushShader.uniforms.seed.set2f (Math.random (), Math.random ());
			this.parametricBrushShader.uniforms.noise.set1i (1.0);
			this.parametricBrushShader.uniforms.fill.set1f (1.0);
			this.parametricBrushShader.uniforms.animate.set1i (animate ? 1 : 0);
		    this.square.draw ()
		})
	},
	draw: function () {
		this.gl.disable (this.gl.DEPTH_TEST);
		this.gl.clear (this.gl.COLOR_BUFFER_BIT);
		this.drawCellsShader.use ();
		this.drawCellsShader.attributes.position.bindBuffer (this.square);
		this.drawCellsShader.uniforms.transform.setMatrix (this.screenTransform);
		this.drawCellsShader.uniforms.cells.bindTexture (this.cellBuffer, 0);
		this.square.draw ()
	}
});

$(document).ready (function () {
	var life = new Life ({
		canvas: $('.viewport').get (0)
	})
});