// Load the glMatrix library
await import("https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/3.4.2/gl-matrix-min.js");

const glCanvas = window.lwjglCanvasElement;
if (!(glCanvas instanceof HTMLCanvasElement)) throw new Error("window.lwjglCanvasElement is not set or is not a canvas");
const glCtx = glCanvas.getContext("webgl2", {antialias: false, alpha: true});

var vertexShaderSrc = `
	attribute vec4 aVertexPosition;
	attribute vec4 aColor;
	attribute vec2 aTexCoord;
	uniform mat4 modelView;
	uniform mat4 projection;
	varying vec2 vTexCoord;
	varying vec4 vColor;
	void main() {
		gl_Position = projection * modelView * aVertexPosition;
		vTexCoord = aTexCoord;
		vColor = aColor;
	}
`;
// NOTE: Only the default GL_MODULATE texEnv is supported here
var fragmentShaderSrc = `
	precision mediump float;
	uniform sampler2D uSampler;
	uniform float uTextureMask;
	uniform float uAlphaTest;
	varying vec2 vTexCoord;
	varying vec4 vColor;
	void main() {
		vec4 color = vColor;
		if (uTextureMask > 0.5) {
			vec4 texSample = texture2D(uSampler, vTexCoord);
			color *= texSample;
		}
		
		// Use the alpha test value provided by the game
		if (color.a < uAlphaTest) {
			discard;
		}
		
		gl_FragColor = color;
	}
`;
var vertexShader = glCtx.createShader(glCtx.VERTEX_SHADER);
glCtx.shaderSource(vertexShader, vertexShaderSrc);
glCtx.compileShader(vertexShader);
var fragmentShader = glCtx.createShader(glCtx.FRAGMENT_SHADER);
glCtx.shaderSource(fragmentShader, fragmentShaderSrc);
glCtx.compileShader(fragmentShader);
var program = glCtx.createProgram();
glCtx.attachShader(program, vertexShader);
glCtx.attachShader(program, fragmentShader);
glCtx.linkProgram(program);
glCtx.useProgram(program);
const MAX_BUFFER_SIZE = 1024 * 1024 * 8;
const singleVBO = glCtx.createBuffer();
glCtx.bindBuffer(glCtx.ARRAY_BUFFER, singleVBO);
glCtx.bufferData(glCtx.ARRAY_BUFFER, MAX_BUFFER_SIZE, glCtx.DYNAMIC_DRAW);
const batchBuffer = new Uint8Array(MAX_BUFFER_SIZE);
var vertexPosition = glCtx.getAttribLocation(program, "aVertexPosition");
var colorLocation = glCtx.getAttribLocation(program, "aColor");
var texCoord = glCtx.getAttribLocation(program, "aTexCoord");
var mvLocation = glCtx.getUniformLocation(program, "modelView");
var projLocation = glCtx.getUniformLocation(program, "projection");
var samplerLocation = glCtx.getUniformLocation(program, "uSampler");
var samplerLocation2 = glCtx.getUniformLocation(program, "uSampler2");
var texMaskLocation = glCtx.getUniformLocation(program, "uTextureMask");
var alphaTestLocation = glCtx.getUniformLocation(program, "uAlphaTest");
glCtx.uniform1f(alphaTestLocation, 0.1);
var vertexData =
{
	enabled: false,
	size: 0,
	type: 0,
	stride: 0,
	pointer: 0,
	buf: null
};
var normalData =
{
	enabled: false,
	size: 0,
	type: 0,
	stride: 0,
	pointer: 0,
	buf: null
};
var colorData =
{
	enabled: false,
	size: 0,
	type: 0,
	stride: 0,
	pointer: 0,
	buf: null
};
var texCoordData =
{
	enabled: false,
	size: 0,
	type: 0,
	stride: 0,
	pointer: 0,
	buf: null
};
// TODO: Make buffers resizeable if needed
var immediateModeData = {
	mode: 0,
	vertexBuf: new Float32Array(2048),
	vertexPos: 0,
	texCoordBuf: new Float32Array(2048),
	texCoordPos: 0,
	colorBuf: new Float32Array(2048 * 4),
	colorPos: 0,
	currentColor: [1.0, 1.0, 1.0, 1.0]
};
var verboseLog = false;
var frameCount = 0;
const scratchMat0 = glMatrix.mat4.create();
const multScratch = glMatrix.mat4.create();
const scratchVec3 = new Float32Array(3);
const MAX_TEXTURE_SIZE = 1024 * 1024 * 16;
const scratchTextureBuf = new Uint8Array(MAX_TEXTURE_SIZE);
const immediateVertexView = new Uint8Array(immediateModeData.vertexBuf.buffer);
const immediateColorView = new Uint8Array(immediateModeData.colorBuf.buffer);
const immediateTexCoordView = new Uint8Array(immediateModeData.texCoordBuf.buffer);
const CAPTURE_SLAB_SIZE = 1024 * 1024 * 32;
const captureSlab = new Uint8Array(CAPTURE_SLAB_SIZE);
let captureSlabOffset = 0;
const swapBufferClosure = function(f) { requestAnimationFrame(f); };
const glStateCache = {};
const MAX_QUAD_VERTICES = 1000000;
const indexData = new Uint32Array((MAX_QUAD_VERTICES / 4) * 6);
for (let i = 0, idx = 0; i < MAX_QUAD_VERTICES; i += 4) {
	indexData[idx++] = i;
	indexData[idx++] = i + 1;
	indexData[idx++] = i + 2;
	indexData[idx++] = i;
	indexData[idx++] = i + 2;
	indexData[idx++] = i + 3;
}
var quadIndexBuffer = glCtx.createBuffer();
glCtx.bindBuffer(glCtx.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);
glCtx.bufferData(glCtx.ELEMENT_ARRAY_BUFFER, indexData, glCtx.STATIC_DRAW);
// Set to a non-zero value to stop after a certain number of frames
var frameLimit = 0;
var currentActiveTexture = 0x84C0;
var currentClientActiveTexture = 0x84C0;
let matricesDirty = true;
class MatrixStack
{
	constructor()
	{
		this.data = new Float32Array(16 * 64);
		this.views = [];
		for(let i = 0; i < 64; i++) this.views.push(new Float32Array(this.data.buffer, i * 16 * 4, 16));
		this.ptr = 0;
		glMatrix.mat4.identity(this.views[0]);
	}
	getTop() { return this.views[this.ptr]; }
	push()
	{
		this.views[this.ptr + 1].set(this.views[this.ptr]);
		this.ptr++;
	}
	pop() { this.ptr--; }
}
var projMatrixStack = new MatrixStack();
var modelViewMatrixStack = new MatrixStack();
var textureMatrixStack = new MatrixStack();
var curMatrixStack = modelViewMatrixStack;
function getCurMatrixTop()
{
	return curMatrixStack.getTop();
}
function setCurMatrixTop(m)
{
	curMatrixStack.getTop().set(m);
}
function getEffectiveStride(data) {
	if (data.stride !== 0) return data.stride;
	let bytesPerElement = 4;
	if (data.type === glCtx.UNSIGNED_BYTE || data.type === glCtx.BYTE) {
		bytesPerElement = 1;
	} else if (data.type === glCtx.SHORT || data.type === glCtx.UNSIGNED_SHORT) {
		bytesPerElement = 2;
	}
	return data.size * bytesPerElement;
}
let wasmHeapView = null;
function getWasmHeapView(buffer)
{
	if (!wasmHeapView || wasmHeapView.buffer !== buffer)
		wasmHeapView = new Uint8Array(buffer);
	return wasmHeapView;
}
function uploadAllData(v, count, capVert, capCol, capTex)
{
	let offset = 0;
	let vOffset = 0, cOffset = 0, tOffset = 0;

	let vd = capVert || vertexData;
	let cd = capCol || colorData;
	let td = capTex || texCoordData;

	let heapView = v ? getWasmHeapView(v.buffer) : null;

	if (vd.enabled) {
		let bytes = getEffectiveStride(vd) * count;
		if (vd.buf) {
			batchBuffer.set(vd.buf, offset);
		} else {
			for (let i = 0; i < bytes; i++) batchBuffer[offset + i] = heapView[vd.pointer + i];
		}
		vOffset = offset;
		offset += bytes;
	}
	if (cd.enabled) {
		let bytes = getEffectiveStride(cd) * count;
		if (cd.buf) {
			batchBuffer.set(cd.buf, offset);
		} else {
			for (let i = 0; i < bytes; i++) batchBuffer[offset + i] = heapView[cd.pointer + i];
		}
		cOffset = offset;
		offset += bytes;
	}
	if (td.enabled) {
		let bytes = getEffectiveStride(td) * count;
		if (td.buf) {
			batchBuffer.set(td.buf, offset);
		} else {
			for (let i = 0; i < bytes; i++) batchBuffer[offset + i] = heapView[td.pointer + i];
		}
		tOffset = offset;
		offset += bytes;
	}

	glCtx.bindBuffer(glCtx.ARRAY_BUFFER, singleVBO);
	glCtx.bufferSubData(glCtx.ARRAY_BUFFER, 0, batchBuffer, 0, offset);

	if (vd.enabled) {
		glCtx.vertexAttribPointer(vertexPosition, vd.size, vd.type, vd.type !== glCtx.FLOAT, vd.stride, vOffset);
		glCtx.enableVertexAttribArray(vertexPosition);
	} else glCtx.disableVertexAttribArray(vertexPosition);

	if (cd.enabled) {
		glCtx.vertexAttribPointer(colorLocation, cd.size, cd.type, cd.type !== glCtx.FLOAT, cd.stride, cOffset);
		glCtx.enableVertexAttribArray(colorLocation);
	} else glCtx.disableVertexAttribArray(colorLocation);

	if (td.enabled) {
		glCtx.vertexAttribPointer(texCoord, td.size, td.type, td.type !== glCtx.FLOAT, td.stride, tOffset);
		glCtx.enableVertexAttribArray(texCoord);
	} else {
		glCtx.disableVertexAttribArray(texCoord);
		glCtx.vertexAttrib2f(texCoord, 0, 0);
	}
}

function captureData(v, data, count)
{
	var ret = { enabled: data.enabled, size: data.size, type: data.type, stride: data.stride, pointer: 0, buf: null };
	if(data.enabled) {
		var effectiveStride = getEffectiveStride(data);
		var len = effectiveStride * count;
		ret.buf = new Uint8Array(len);
		ret.buf.set(new Uint8Array(v.buffer, data.pointer, len));
	}
	return ret;
}
function checkNoList(list)
{
	if(list != null)
		throw new Error("Unsupported command in list");
}
function pushInList(list, args, callee)
{
	// Not an elegant solution, but it works
	// It would be nicer to extract the actual implementation from native interfaces
	// to avoid bringing around the library object
	list.push({f: callee, a: Array.from(args)});
}
function callList(listId)
{
	var l = cmdLists[listId];
	for(var i=0;i<l.length;i++)
	{
		var c = l[i];
		c.f.apply(null, c.a);
	}
}
function drawArraysImpl(mode, first, count)
{
	if (matricesDirty) {
		glCtx.uniformMatrix4fv(mvLocation, false, modelViewMatrixStack.getTop());
		glCtx.uniformMatrix4fv(projLocation, false, projMatrixStack.getTop());
		matricesDirty = false;
	}
	assert(first == 0);
	
	if(mode == 7/*QUADS*/ && (count % 4) == 0) {
		glCtx.bindBuffer(glCtx.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);
		glCtx.drawElements(glCtx.TRIANGLES, (count / 4) * 6, glCtx.UNSIGNED_INT, 0);
	}
	else if(mode == glCtx.LINES || mode == glCtx.LINE_STRIP || mode == glCtx.TRIANGLE_STRIP || mode == glCtx.TRIANGLE_FAN || mode == glCtx.TRIANGLES) {
		glCtx.drawArrays(mode, first, count);
	}
	else {
		debugger;
	}
}
function pushDrawArraysInList(list, v, mode, first, count)
{
	var args = [mode, first, count, captureData(v, vertexData, count), captureData(v, colorData, count), captureData(v, texCoordData, count)];
	list.push({f: drawArraysInList, a: args});
}
function drawArraysInList(mode, first, count, capturedVertexData, capturedColorData, capturedTexCoordData)
{
	uploadAllData(null, count, capturedVertexData, capturedColorData, capturedTexCoordData);
	drawArraysImpl(mode, first, count);
}
// Fix the sampler to texture unit 0
glCtx.uniform1i(samplerLocation, 0);
var curList = null;
var cmdLists = [null];
// The first null implicitly solves resetting on 0 id
var textureObjects = [null];
var textureWidths = [];
var textureHeights = [];
var activeTextureUnit = 0;
var boundTextures = [0, 0, 0, 0, 0, 0, 0, 0];
// We need to use an FBO as the main target to support copyTexSubImage2D that seems broken otherwise
var fbTexture = glCtx.createTexture();
glCtx.bindTexture(glCtx.TEXTURE_2D, fbTexture);
glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, 1000, 500, 0, glCtx.RGBA, glCtx.UNSIGNED_BYTE, null);
glCtx.bindTexture(glCtx.TEXTURE_2D, null);
var mainFb = glCtx.createFramebuffer();
glCtx.bindFramebuffer(glCtx.READ_FRAMEBUFFER, mainFb);
glCtx.bindFramebuffer(glCtx.DRAW_FRAMEBUFFER, mainFb);
glCtx.framebufferTexture2D(glCtx.FRAMEBUFFER, glCtx.COLOR_ATTACHMENT0, glCtx.TEXTURE_2D, fbTexture, 0);
// Add a depth render buffer
var depthRb = glCtx.createRenderbuffer();
glCtx.bindRenderbuffer(glCtx.RENDERBUFFER, depthRb);
glCtx.renderbufferStorage(glCtx.RENDERBUFFER, glCtx.DEPTH_COMPONENT16, 1000, 500);
glCtx.framebufferRenderbuffer(glCtx.FRAMEBUFFER, glCtx.DEPTH_ATTACHMENT, glCtx.RENDERBUFFER, depthRb);
// Synthetize a focus event, it's needed for LWJGL logic
var eventQueue = [{type:"focus"}];

function convertMousePos(x, y) {
	// We have a framebuffer of 1000x500, but Minecraft renders into the bottom left corner of it.
	const offsetX = 0;
	const offsetY = glCanvas.height - 500;

	const xRatio = glCanvas.width / glCanvas.clientWidth;
	const yRatio = glCanvas.height / glCanvas.clientHeight;

	return [x * xRatio - offsetX, y * yRatio - offsetY];
}

/** Convert from MouseEvent.button to X11 mouse button */
function convertMouseButton(button) {
	return button + 1;
}

/**
 * If null, the game does not want the mouse pointer locked.
 * @type {{ x: number, y: number } | null}
 */
let lockedMousePos = null;

glCanvas.addEventListener("mousemove", evt => {
	let [x, y] = convertMousePos(evt.offsetX, evt.offsetY);

	// If the pointer is locked, we can't use offsetX/offsetY
	if (lockedMousePos) {
		x = lockedMousePos.x += evt.movementX;
		y = lockedMousePos.y += evt.movementY;

		if (!document.pointerLockElement) {
			// Game still wants the pointer locked, but it's not
			Java_org_lwjgl_opengl_LinuxDisplay_nGrabPointer();
		}
	}

	if (eventQueue[0]?.type == evt.type) {
		// Update unhandled event
		eventQueue[0].x = x;
		eventQueue[0].y = y;
	} else {
		eventQueue.push({ type: evt.type, x, y });
	}
});
function mouseHandler(evt) {
	const [x, y] = convertMousePos(evt.offsetX, evt.offsetY);
	eventQueue.push({ type: evt.type, x, y, button: convertMouseButton(evt.button) });
}
glCanvas.addEventListener("mousedown", mouseHandler);
glCanvas.addEventListener("mouseup", mouseHandler);
glCanvas.addEventListener("contextmenu", evt => evt.preventDefault());

/** @param {KeyboardEvent} e */
function keyHandler(e)
{
	// Convert to LinuxKeycodes.java keycodes
	// https://github.com/LWJGL/lwjgl/blob/master/src/java/org/lwjgl/opengl/LinuxKeycodes.java
	let keyCode = 0;
	if (e.key.length === 1)
	{
		keyCode = e.key.charCodeAt(0);
	}
	else
	{
		switch (e.key) {
			case "Escape": keyCode = 0xff1b; break;
			case "Enter": keyCode = 0xff0d; break;
			case "Backspace": keyCode = 0xff08; break;
			case "Tab": keyCode = 0xff09; break;
			case "Shift": keyCode = (e.code === "ShiftRight") ? 0xffe2 : 0xffe1; break;
			case "Control": keyCode = (e.code === "ControlRight") ? 0xffe4 : 0xffe3; break;
			case "Alt": keyCode = (e.code === "AltRight") ? 0xffea : 0xffe9; break;
			case "Meta": keyCode = 0xffe7; break;
			case "CapsLock": keyCode = 0xffe5; break;
			case "ArrowUp": keyCode = 0xff52; break;
			case "ArrowDown": keyCode = 0xff54; break;
			case "ArrowLeft": keyCode = 0xff51; break;
			case "ArrowRight": keyCode = 0xff53; break;
			case "PageUp": keyCode = 0xff55; break;
			case "PageDown": keyCode = 0xff56; break;
			case "Home": keyCode = 0xff50; break;
			case "End": keyCode = 0xff57; break;
			case "Insert": keyCode = 0xff63; break;
			case "Delete": keyCode = 0xffff; break;
			case "F1": keyCode = 0xffbe; break;
			case "F2": keyCode = 0xffbf; break;
			case "F3": keyCode = 0xffc0; break;
			case "F4": keyCode = 0xffc1; break;
			case "F5": keyCode = 0xffc2; break;
			case "F6": keyCode = 0xffc3; break;
			case "F7": keyCode = 0xffc4; break;
			case "F8": keyCode = 0xffc5; break;
			case "F9": keyCode = 0xffc6; break;
			case "F10": keyCode = 0xffc7; break;
			case "F11": keyCode = 0xffc8; break;
			case "F12": keyCode = 0xffc9; break;
			default: keyCode = e.keyCode; break;
		}
	}
	eventQueue.push({ type: e.type, keyCode });
	if (e.key !== "F11") e.preventDefault();
}
glCanvas.addEventListener("keydown", keyHandler);
glCanvas.addEventListener("keyup", keyHandler);

function isPowerOfTwo(x)
{
	return (x & (x - 1)) == 0 && x !== 0;
}

function getTextureData(v, memPtr, width, height, format, type)
{
    const ptr = Number(memPtr);
    if (ptr === 0) return null;

    let bpp = 4; 
    if (format === 0x1907 /* GL_RGB */) bpp = 3;
    else if (format === 0x1909 /* GL_LUMINANCE */) bpp = 1;
    else if (format === 0x190A /* GL_LUMINANCE_ALPHA */) bpp = 2;
    else if (format === 0x1908 /* GL_RGBA */ || format === 0x80E1 /* GL_BGRA */) bpp = 4;

    if (type === 0x1403 /* UNSIGNED_SHORT */) bpp *= 2;
    if (type === 0x1406 /* FLOAT */) bpp *= 4;

    const size = width * height * bpp;
    const sourceBuf = new Uint8Array(v.buffer, ptr, size);

    if (format === 0x80E1 /* GL_BGRA */)
    {
        const u8Source = new Uint8Array(v.buffer, ptr, size);
        scratchTextureBuf.set(u8Source, 0);
        
        const u32 = new Uint32Array(scratchTextureBuf.buffer, scratchTextureBuf.byteOffset, size / 4);
        for (let i = 0; i < u32.length; i++) {
            const p = u32[i];
            u32[i] = (p & 0xFF00FF00) | ((p & 0xFF) << 16) | ((p >> 16) & 0xFF);
        }
        return scratchTextureBuf.subarray(0, size);
    }

    return sourceBuf;
}

function translateGLFormat(f) { return (f === 0x80E1 /* BGRA */) ? glCtx.RGBA : f; }
function translateGLType(t) { return (t === 0x8367 /* UNSIGNED_INT_8_8_8_8_REV */) ? glCtx.UNSIGNED_BYTE : t; }
function translateInternalFormat(i)
{
    if (i === 4 || i === 0x8058) return glCtx.RGBA;
    if (i === 3 || i === 0x8051) return glCtx.RGB;
    return i;
}

function Java_org_lwjgl_DefaultSysImplementation_getPointerSize()
{
	return 4;
}

function Java_org_lwjgl_DefaultSysImplementation_getJNIVersion()
{
	return 19;
}

function Java_org_lwjgl_DefaultSysImplementation_setDebug()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nLockAWT()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nSwitchDisplayMode(lib, screen, extension, mode)
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nUnlockAWT()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_setErrorHandler()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_openDisplay(lib)
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nInternAtom()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nIsXrandrSupported()
{
	return 0;
}

function Java_org_lwjgl_opengl_LinuxDisplay_nIsXF86VidModeSupported()
{
	return 1;
}

function Java_org_lwjgl_opengl_LinuxDisplay_nGetDefaultScreen()
{
	return 0;
}

async function Java_org_lwjgl_opengl_LinuxDisplay_nGetAvailableDisplayModes(lib)
{
	var DisplayMode = await lib.org.lwjgl.opengl.DisplayMode;
	var d = await new DisplayMode(1000, 500);
	return [d];
}

function Java_org_lwjgl_opengl_LinuxDisplay_nGetCurrentGammaRamp()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nSetGammaRamp(lib, gammaRampBuffer)
{
}

function Java_org_lwjgl_opengl_LinuxPeerInfo_createHandle()
{
}

function Java_org_lwjgl_opengl_GLContext_nLoadOpenGLLibrary()
{
}

function Java_org_lwjgl_opengl_LinuxDisplayPeerInfo_initDefaultPeerInfo()
{
}

function Java_org_lwjgl_opengl_LinuxDisplayPeerInfo_initDrawable()
{
}

function Java_org_lwjgl_opengl_AWTSurfaceLock_createHandle()
{
}

function Java_org_lwjgl_opengl_AWTSurfaceLock_lockAndInitHandle()
{
	return 1;
}

function Java_org_lwjgl_opengl_LinuxAWTGLCanvasPeerInfo_getScreenFromSurfaceInfo()
{
}

function Java_org_lwjgl_opengl_LinuxAWTGLCanvasPeerInfo_nInitHandle()
{
}

function Java_org_lwjgl_opengl_AWTSurfaceLock_nUnlock()
{
}

function Java_org_lwjgl_opengl_LinuxPeerInfo_nGetDrawable()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nCreateWindow()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_mapRaised()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nCreateBlankCursor()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nSetTitle()
{
}

function Java_org_lwjgl_opengl_LinuxMouse_nGetButtonCount()
{
	return 3;
}

function Java_org_lwjgl_opengl_LinuxMouse_nQueryPointer()
{
}

function Java_org_lwjgl_opengl_LinuxMouse_nGetWindowHeight()
{
	return 500;
}

function Java_org_lwjgl_opengl_LinuxKeyboard_getModifierMapping()
{
}

function Java_org_lwjgl_opengl_LinuxKeyboard_nSetDetectableKeyRepeat()
{
}

function Java_org_lwjgl_opengl_LinuxKeyboard_openIM()
{
}

function Java_org_lwjgl_opengl_LinuxKeyboard_allocateComposeStatus()
{
}

function Java_org_lwjgl_opengl_LinuxContextImplementation_nCreate()
{
}

function Java_org_lwjgl_opengl_LinuxContextImplementation_nMakeCurrent()
{
}

function Java_org_lwjgl_opengl_LinuxContextImplementation_nIsCurrent()
{
	return true;
}

function Java_org_lwjgl_opengl_GLContext_ngetFunctionAddress(lib, stringPtr)
{
	// Return any non-zero address, methods are called by name anyway
	return 1;
}

function Java_org_lwjgl_opengl_GL11_nglGetString(lib, id, funcPtr)
{
	checkNoList(curList);
	// Special case GL_EXTENSION for now
	if(id == 0x1F03)
	{
		// TODO: Do we need any?
		return "";
	}
	else
	{
		return glCtx.getParameter(id);
	}
}

function Java_org_lwjgl_opengl_GL11_nglGetIntegerv(lib, id, memPtr, funcPtr)
{
	checkNoList(curList);
	var v = lib.getJNIDataView();
	var ptr = Number(memPtr);
	
	if (id == /*GL_VIEWPORT*/0xba2) {
		v.setInt32(ptr, 0, true);
		v.setInt32(ptr + 4, 0, true);
		v.setInt32(ptr + 8, 1000, true);
		v.setInt32(ptr + 12, 500, true);
	} else {
		try {
			var val = glCtx.getParameter(id);
			if (typeof val === 'number') {
				v.setInt32(ptr, val, true);
			} else if (Array.isArray(val) || ArrayBuffer.isView(val)) {
				for (var i = 0; i < val.length; i++) {
					v.setInt32(ptr + i * 4, val[i], true);
				}
			} else {
				v.setInt32(ptr, 16, true);
			}
		} catch (e) {
			v.setInt32(ptr, 16, true);
		}
		if (verboseLog) console.log("glGetInteger", id, val);
	}
}

function Java_org_lwjgl_opengl_GL11_nglGetError()
{
	checkNoList(curList);
	// We like living dangerously
	return 0;
}

function Java_org_lwjgl_opengl_LinuxContextImplementation_nSetSwapInterval()
{
}

function Java_org_lwjgl_opengl_GL11_nglClearColor(lib, r, g, b, a, funcPtr)
{
	checkNoList(curList);
	return glCtx.clearColor(r, g, b, a);
}

function Java_org_lwjgl_opengl_GL11_nglClear(lib, a, funcPtr)
{
	checkNoList(curList);
	glCtx.clear(a);
}

function Java_org_lwjgl_opengl_LinuxContextImplementation_nSwapBuffers()
{
	if(verboseLog)
		console.warn("SwapBuffer");
	glCtx.bindFramebuffer(glCtx.DRAW_FRAMEBUFFER, null);
	glCtx.blitFramebuffer(0, 0, 1000, 500, 0, 0, 1000, 500, glCtx.COLOR_BUFFER_BIT, glCtx.NEAREST);
	glCtx.bindFramebuffer(glCtx.DRAW_FRAMEBUFFER, mainFb);
	frameCount++;
	if(frameCount == frameLimit)
	{
		console.warn("Stopping");
		return new Promise(function(){});
	}
	return new Promise(swapBufferClosure);
}

function Java_org_lwjgl_opengl_LinuxEvent_getPending()
{
	return eventQueue.length;
}

function Java_org_lwjgl_opengl_GL11_nglMatrixMode(lib, matrixMode, funcPtr)
{
	if(curList)
		return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglMatrixMode);
	if(matrixMode == 0x1700/*GL_MODELVIEW*/)
		curMatrixStack = modelViewMatrixStack;
	else if(matrixMode == 0x1701/*GL_PROJECTION*/)
		curMatrixStack = projMatrixStack;
	else if(matrixMode == 0x1702/*GL_TEXTURE*/)
		curMatrixStack = textureMatrixStack;
	else
		debugger;
}

function Java_org_lwjgl_opengl_GL11_nglLoadIdentity(lib, funcPtr)
{
	checkNoList(curList);
	glMatrix.mat4.identity(getCurMatrixTop());
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglOrtho(lib, left, right, bottom, top, nearVal, farVal, funcPtr)
{
	checkNoList(curList);
	var m = getCurMatrixTop();
	glMatrix.mat4.ortho(scratchMat0, left, right, bottom, top, nearVal, farVal);
	glMatrix.mat4.multiply(m, m, scratchMat0);
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglTranslatef(lib, x, y, z, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglTranslatef);
	var m = getCurMatrixTop();
	scratchVec3[0] = x; scratchVec3[1] = y; scratchVec3[2] = z;
	glMatrix.mat4.translate(m, m, scratchVec3);
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglViewport(lib, x, y, width, height, funcPtr)
{
	checkNoList(curList);
	glCtx.viewport(x, y, width, height);
}

function Java_org_lwjgl_opengl_GL11_nglDisable(lib, a, funcPtr)
{
	checkNoList(curList);
	if(a == glCtx.BLEND || a == glCtx.CULL_FACE || a == glCtx.DEPTH_TEST){
		glCtx.disable(a);
	} else if(a == 0x806F/*GL_TEXTURE_3D*/) {
		if (currentActiveTexture === 0x84C0) glCtx.uniform1f(texMaskLocation, 0.0);
	} else if (a == 0xBC0 /* GL_ALPHA_TEST */) {
		glCtx.uniform1f(alphaTestLocation, 0.0);
	} else if (a == 0xDE1 /* GL_TEXTURE_2D */) {
		if (currentActiveTexture === 0x84C0) glCtx.uniform1f(texMaskLocation, 0.0);
	} else if(verboseLog) {
		console.log("glDisable " + a.toString(16));
	}
}

function Java_org_lwjgl_opengl_GL11_nglEnable(lib, a, funcPtr)
{
	checkNoList(curList);
	if (a == glCtx.CULL_FACE || a == glCtx.DEPTH_TEST) {
		glCtx.enable(a);
	} else if (a == 0xDE1 /* GL_TEXTURE_2D */) {
		if (currentActiveTexture === 0x84C0) glCtx.uniform1f(texMaskLocation, 1.0);
	} else if(a == 0x806F/*GL_TEXTURE_3D*/) {
		if (currentActiveTexture === 0x84C0) glCtx.uniform1f(texMaskLocation, 1.0);
	} else if(a == glCtx.BLEND) {
		glCtx.enable(glCtx.BLEND);
		glCtx.blendFunc(glCtx.SRC_ALPHA, glCtx.ONE_MINUS_SRC_ALPHA);
	} else if (a == 0xBC0 /* GL_ALPHA_TEST */) {
		glCtx.uniform1f(alphaTestLocation, 0.1);
	} else if(verboseLog) {
		console.log("glEnable " + a.toString(16));
	}
}

function Java_org_lwjgl_opengl_GL11_nglGenTextures(lib, n, memPtr, funcPtr)
{
	checkNoList(curList);
	var v = lib.getJNIDataView();
	var ptr = Number(memPtr);
	
	for(var i=0; i<n; i++) {
		var id = textureObjects.length;
		v.setInt32(ptr + i*4, id, true);
		textureObjects[id] = glCtx.createTexture();
	}
}

function Java_org_lwjgl_opengl_GL11_nglBindTexture(lib, target, id, funcPtr)
{
	checkNoList(curList);
	assert(target == glCtx.TEXTURE_2D);
	boundTextures[activeTextureUnit] = id;
	glCtx.bindTexture(target, textureObjects[id]);
}

function Java_org_lwjgl_opengl_GL11_nglTexParameteri(lib, target, pname, param, funcPtr)
{
	checkNoList(curList);
	glCtx.texParameteri(target, pname, param);
}

function Java_org_lwjgl_opengl_GL11_nglTexImage2D(lib, target, level, internalFormat, width, height, border, format, type, memPtr, funcPtr)
{
    checkNoList(curList);
    if (target === 0x8064) return;

    const v = lib.getJNIDataView();
    const buf = getTextureData(v, memPtr, width, height, format, type);
    
    const glFmt = translateGLFormat(format);
    const glTyp = translateGLType(type);
    const glInt = translateInternalFormat(internalFormat);

    const boundId = boundTextures[activeTextureUnit];
    textureWidths[boundId] = width;
    textureHeights[boundId] = height;

    glCtx.pixelStorei(glCtx.UNPACK_ALIGNMENT, 1);
    glCtx.texImage2D(target, level, glInt, width, height, border, glFmt, glTyp, buf);

    // Standard Mipmap/Filter Setup
    const isPot = ((width & (width - 1)) === 0) && ((height & (height - 1)) === 0);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, isPot ? glCtx.REPEAT : glCtx.CLAMP_TO_EDGE);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, isPot ? glCtx.REPEAT : glCtx.CLAMP_TO_EDGE);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.NEAREST);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.NEAREST);
}

function Java_org_lwjgl_opengl_GL11_nglTexCoordPointer(lib, size, type, stride, memPtr, funcPtr)
{
	if (currentClientActiveTexture !== 0x84C0) {
		return;
	}
	texCoordData.size = size;
	texCoordData.type = type;
	texCoordData.stride = stride;
	texCoordData.pointer = Number(memPtr);
}

function Java_org_lwjgl_opengl_GL11_nglEnableClientState(lib, v, funcPtr) {
	if(v == 0x8074/*GL_VERTEX_ARRAY*/) {
		vertexData.enabled = true;
	} else if(v == 0x8075/*GL_NORMAL_ARRAY*/) {
		normalData.enabled = true;
	} else if(v == 0x8076/*GL_COLOR_ARRAY*/) {
		colorData.enabled = true;
	} else if(v == 0x8078/*GL_TEXTURE_COORD_ARRAY*/) {
		if (currentClientActiveTexture === 0x84C0) texCoordData.enabled = true;
	} else if(verboseLog) {
		console.log("glEnableClientState");
	}
}

function Java_org_lwjgl_opengl_GL11_nglColorPointer(lib, size, type, stride, memPtr, funcPtr)
{
	colorData.size = size;
	colorData.type = type;
	colorData.stride = stride;
	colorData.pointer = Number(memPtr);
}

function Java_org_lwjgl_opengl_GL11_nglVertexPointer(lib, size, type, stride, memPtr, funcPtr)
{
	vertexData.size = size;
	vertexData.type = type;
	vertexData.stride = stride;
	vertexData.pointer = Number(memPtr);
}

function Java_org_lwjgl_opengl_GL11_nglDrawArrays(lib, mode, first, count, funcPtr)
{
	var v = lib.getJNIDataView();
	if(curList) return pushDrawArraysInList(curList, v, mode, first, count);
	uploadAllData(v, count, null, null, null);
	drawArraysImpl(mode, first, count);
}

function Java_org_lwjgl_opengl_GL11_nglDisableClientState(lib, v, funcPtr) {
	if(v == 0x8074/*GL_VERTEX_ARRAY*/) {
		vertexData.enabled = false;
	} else if(v == 0x8075/*GL_NORMAL_ARRAY*/) {
		normalData.enabled = false;
	} else if(v == 0x8076/*GL_COLOR_ARRAY*/) {
		colorData.enabled = false;
	} else if(v == 0x8078/*GL_TEXTURE_COORD_ARRAY*/) {
		if (currentClientActiveTexture === 0x84C0) texCoordData.enabled = false;
	} else if(verboseLog) {
		console.log("glDisableClientState");
	}
}

function Java_org_lwjgl_opengl_GL11_nglColor4f(lib, r, g, b, a, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglColor4f);
	immediateModeData.currentColor[0] = r;
	immediateModeData.currentColor[1] = g;
	immediateModeData.currentColor[2] = b;
	immediateModeData.currentColor[3] = a;
	glCtx.vertexAttrib4f(colorLocation, r, g, b, a);
}

function Java_org_lwjgl_opengl_GL11_nglAlphaFunc(lib, func, ref, funcPtr) {
	checkNoList(curList);
	if(verboseLog) {
		console.log("glAlphaFunc: func=" + func + ", ref=" + ref);
	}
	if (alphaTestLocation) {
		glCtx.uniform1f(alphaTestLocation, ref);
	}
}

function Java_org_lwjgl_opengl_GL11_nglGenLists(lib, range, funcPtr)
{
	checkNoList(curList);
	var ret = cmdLists.length;
	for(var i=0;i<range;i++)
		cmdLists.push([]);
	return ret;
}

function Java_org_lwjgl_opengl_GL11_nglNewList(lib, list, mode, funcPtr)
{
	checkNoList(curList);
	assert(mode == 0x1300/*GL_COMPILE*/);
	curList = cmdLists[list];
	// Wipe out the current contents of the list if any
	curList.length = 0;
}

function Java_org_lwjgl_opengl_GL11_nglEndList(lib, funcPtr)
{
	curList = null;
}

function Java_org_lwjgl_opengl_GL11_nglColor3f(lib, r, g, b, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglColor3f);
	immediateModeData.currentColor[0] = r;
	immediateModeData.currentColor[1] = g;
	immediateModeData.currentColor[2] = b;
	immediateModeData.currentColor[3] = 1.0;
	glCtx.vertexAttrib4f(colorLocation, r, g, b, 1.0);
}

function Java_org_lwjgl_opengl_LinuxDisplay_nGetNativeCursorCapabilities()
{
}

function Java_org_lwjgl_opengl_GL11_nglShadeModel()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glShaderModel");
}

function Java_org_lwjgl_opengl_GL11_nglClearDepth(lib, a, funcPtr)
{
	checkNoList(curList);
	glCtx.clearDepth(a);
}

function Java_org_lwjgl_opengl_GL11_nglDepthFunc(lib, a, funcPtr)
{
	checkNoList(curList);
	glCtx.depthFunc(a);
}

function Java_org_lwjgl_opengl_GL11_nglCullFace(lib, mode, funcPtr)
{
	checkNoList(curList);
	glCtx.cullFace(mode);
}

function Java_org_lwjgl_opengl_GL11_nglPushMatrix(lib, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglPushMatrix);
	curMatrixStack.push();
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglPopMatrix(lib, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglPopMatrix);
	curMatrixStack.pop();
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglMultMatrixf(lib, memPtr, funcPtr)
{
	checkNoList(curList);
	var m = getCurMatrixTop();
	var v = lib.getJNIDataView();
	var ptr = Number(memPtr);
	
	for (var i = 0; i < 16; i++) {
		multScratch[i] = v.getFloat32(ptr + i * 4, true);
	}
	glMatrix.mat4.multiply(m, m, multScratch);
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglRotatef(lib, angle, x, y, z, funcPtr)
{
	checkNoList(curList);
	var m = getCurMatrixTop();
	scratchVec3[0] = x; scratchVec3[1] = y; scratchVec3[2] = z;
	glMatrix.mat4.rotate(m, m, angle * Math.PI / 180.0, scratchVec3);
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglDepthMask(lib, a, funcPtr)
{
	checkNoList(curList);
	glCtx.depthMask(a);
}

function Java_org_lwjgl_opengl_GL11_nglBlendFunc(lib, sfactor, dfactor)
{
	checkNoList(curList);
	glCtx.blendFunc(sfactor, dfactor);
}

function Java_org_lwjgl_opengl_GL11_nglColorMask(lib, r, g, b, a, funcPtr)
{
	checkNoList(curList);
	glCtx.colorMask(r, g, b, a);
}

function Java_org_lwjgl_opengl_GL11_nglCopyTexSubImage2D(lib, target, level, xoffset, yoffset, x, y, width, height, funcPtr)
{
	checkNoList(curList);
	glCtx.copyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height);
}

function Java_org_lwjgl_opengl_GL11_nglScalef(lib, x, y, z, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL11_nglScalef);
	var m = getCurMatrixTop();
	scratchVec3[0] = x; scratchVec3[1] = y; scratchVec3[2] = z;
	glMatrix.mat4.scale(m, m, scratchVec3);
	matricesDirty = true;
}

function Java_org_lwjgl_opengl_GL11_nglCallLists(lib, n, type, memPtr, funcPtr)
{
	checkNoList(curList);
	assert(type == glCtx.UNSIGNED_INT);
	var v = lib.getJNIDataView();
	var buf = new Int32Array(v.buffer, Number(memPtr), n);
	for(var i=0;i<n;i++)
		callList(buf[i]);
}

function Java_org_lwjgl_opengl_GL11_nglFlush()
{
	checkNoList(curList);
	glCtx.flush();
}

function Java_org_lwjgl_opengl_GL11_nglTexSubImage2D(lib, target, level, xoffset, yoffset, width, height, format, type, memPtr, funcPtr)
{
    checkNoList(curList);
    const v = lib.getJNIDataView();
    
    const buf = getTextureData(v, memPtr, width, height, format, type);
    const glFmt = translateGLFormat(format);
    const glTyp = translateGLType(type);

    glCtx.pixelStorei(glCtx.UNPACK_ALIGNMENT, 1);
    glCtx.texSubImage2D(target, level, xoffset, yoffset, width, height, glFmt, glTyp, buf);
}

function Java_org_lwjgl_opengl_GL11_nglGetFloatv(lib, a, memPtr, funcPtr)
{
	checkNoList(curList);
	var v = lib.getJNIDataView();
	var ptr = Number(memPtr);
	
	if(a == /*GL_MODELVIEW_MATRIX*/0xba6) {
		var mat = modelViewMatrixStack.getTop();
		for(var i=0; i<16; i++) v.setFloat32(ptr + i*4, mat[i], true);
	} else if(a == /*GL_PROJECTION_MATRIX*/0xba7) {
		var mat = projMatrixStack.getTop();
		for(var i=0; i<16; i++) v.setFloat32(ptr + i*4, mat[i], true);
	} else if(verboseLog) {
		console.log("glGetFloat " + a);
	}
}

function Java_org_lwjgl_opengl_GL11_nglFogfv()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glFog");
}

function Java_org_lwjgl_opengl_GL11_nglGetTexLevelParameteriv(lib, target, level, pname, memPtr, funcPtr)
{
	checkNoList(curList);
	var v = lib.getJNIDataView();
	var ptr = Number(memPtr);
	var boundId = boundTextures[activeTextureUnit];
	
	if (pname === 0x1000 /* GL_TEXTURE_WIDTH */) {
		v.setInt32(ptr, textureWidths[boundId] || 0, true);
	} else if (pname === 0x1001 /* GL_TEXTURE_HEIGHT */) {
		v.setInt32(ptr, textureHeights[boundId] || 0, true);
	} else {
		v.setInt32(ptr, 0, true);
	}
}

function Java_org_lwjgl_opengl_GL11_nglNormal3f()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glNormal3f");
}

function Java_org_lwjgl_opengl_GL11_nglFogi()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glFogi");
}

function Java_org_lwjgl_opengl_GL11_nglFogf()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glFogf");
}

function Java_org_lwjgl_opengl_GL11_nglColorMaterial()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glColorMaterial");
}

function Java_org_lwjgl_opengl_GL11_nglCallList(lib, listId, funcPtr)
{
	checkNoList(curList);
	callList(listId);
}

function Java_org_lwjgl_opengl_GL13_nglActiveTexture(lib, texture, funcPtr)
{
	if(curList) return pushInList(curList, arguments, Java_org_lwjgl_opengl_GL13_nglActiveTexture);
	if(verboseLog) console.log("glActiveTexture: " + texture.toString(16));
	activeTextureUnit = texture - 0x84C0;
	currentActiveTexture = texture;
	glCtx.activeTexture(texture);
}

function Java_org_lwjgl_opengl_GL11_nglLightfv()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glLightfv");
}

function Java_org_lwjgl_opengl_GL11_nglLightModelfv()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glLightModelfv");
}

function Java_org_lwjgl_opengl_GL11_nglNormalPointer(lib, type, stride, memPtr, funcPtr)
{
	normalData.size = 3;
	normalData.type = type;
	normalData.stride = stride;
	normalData.pointer = Number(memPtr);
}

function Java_org_lwjgl_opengl_GL13_nglMultiTexCoord2f()
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glMultiTexCoord2f");
}

function Java_org_lwjgl_opengl_GL13_nglClientActiveTexture(lib, texture, funcPtr)
{
	if(verboseLog) console.log("glClientActiveTexture: " + texture.toString(16));
	currentClientActiveTexture = texture;
}

function Java_org_lwjgl_opengl_GL11_nglLineWidth(lib, width, funcPtr)
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glLineWidth: " + width);
	glCtx.lineWidth(width);
}

function Java_org_lwjgl_opengl_GL11_nglPolygonOffset(lib, factor, units, funcPtr)
{
	checkNoList(curList);
	if(verboseLog)
		console.log("glPolygonOffset");
	glCtx.polygonOffset(factor, units);
}

function Java_org_lwjgl_opengl_GL11_nglBegin(lib, mode, funcPtr)
{
	checkNoList(curList);
	immediateModeData.mode = mode;
	immediateModeData.vertexPos = 0;
	immediateModeData.texCoordPos = 0;
	immediateModeData.colorPos = 0;
}

function Java_org_lwjgl_opengl_GL11_nglTexCoord2f(lib, x, y, funcPtr)
{
	checkNoList(curList);
	var curPos = immediateModeData.texCoordPos;
	if(curPos > immediateModeData.texCoordBuf.length)
	{
		console.log("glTexCoord2f overflow");
		return;
	}
	immediateModeData.texCoordBuf[curPos] = x;
	immediateModeData.texCoordBuf[curPos + 1] = y;
	immediateModeData.texCoordPos = curPos + 2;
}

function Java_org_lwjgl_opengl_GL11_nglVertex3f(lib, x, y, z, funcPtr)
{
	checkNoList(curList);
	immediateModeData.vertexBuf[immediateModeData.vertexPos++] = x;
	immediateModeData.vertexBuf[immediateModeData.vertexPos++] = y;
	immediateModeData.vertexBuf[immediateModeData.vertexPos++] = z;

	immediateModeData.colorBuf[immediateModeData.colorPos++] = immediateModeData.currentColor[0];
	immediateModeData.colorBuf[immediateModeData.colorPos++] = immediateModeData.currentColor[1];
	immediateModeData.colorBuf[immediateModeData.colorPos++] = immediateModeData.currentColor[2];
	immediateModeData.colorBuf[immediateModeData.colorPos++] = immediateModeData.currentColor[3];
}

function Java_org_lwjgl_opengl_GL11_nglEnd(lib, funcPtr)
{
	checkNoList(curList);
	var count = immediateModeData.vertexPos / 3;

	let offset = 0;
	let vBytes = immediateModeData.vertexPos * 4;
	let cBytes = immediateModeData.colorPos * 4;
	let tBytes = immediateModeData.texCoordPos * 4;
	
	let vOffset = offset;
	batchBuffer.set(immediateVertexView.subarray(0, vBytes), offset);
	offset += vBytes;
	
	let cOffset = offset;
	batchBuffer.set(immediateColorView.subarray(0, cBytes), offset);
	offset += cBytes;
	
	let tOffset = offset;
	if (tBytes > 0)
	{
		batchBuffer.set(immediateTexCoordView.subarray(0, tBytes), offset);
		offset += tBytes;
	}
	
	glCtx.bindBuffer(glCtx.ARRAY_BUFFER, singleVBO);
	glCtx.bufferSubData(glCtx.ARRAY_BUFFER, 0, batchBuffer, 0, offset);
	
	glCtx.vertexAttribPointer(vertexPosition, 3, glCtx.FLOAT, false, 0, vOffset);
	glCtx.enableVertexAttribArray(vertexPosition);
	
	glCtx.vertexAttribPointer(colorLocation, 4, glCtx.FLOAT, false, 0, cOffset);
	glCtx.enableVertexAttribArray(colorLocation);
	
	if (tBytes > 0)
	{
		glCtx.vertexAttribPointer(texCoord, 2, glCtx.FLOAT, false, 0, tOffset);
		glCtx.enableVertexAttribArray(texCoord);
	}
	else
	{
		glCtx.disableVertexAttribArray(texCoord);
		glCtx.vertexAttrib2f(texCoord, 0, 0);
	}

	drawArraysImpl(immediateModeData.mode, 0, count);
}

// These stubs make sure audio creation fails sooner rather than later
function Java_org_lwjgl_openal_AL_nCreate()
{
}

function Java_org_lwjgl_openal_AL10_initNativeStubs()
{
}

function Java_org_lwjgl_openal_ALC10_initNativeStubs()
{
}

function Java_org_lwjgl_openal_ALC10_nalcOpenDevice()
{
}

function Java_org_lwjgl_openal_AL_resetNativeStubs()
{
}

function Java_org_lwjgl_openal_AL_nDestroy()
{
}

// Basic input support
async function Java_org_lwjgl_opengl_LinuxEvent_createEventBuffer(lib)
{
	// This is intended to represent a X11 event, but we are free to use any layout
	var ByteBuffer = await lib.java.nio.ByteBuffer;
	return await ByteBuffer.allocateDirect(4 * 8);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nNextEvent(lib, windowId, buffer)
{
	var bufferAddr = Number(await buffer.address());
	var v = lib.getJNIDataView();
	var e = eventQueue.shift();

	if (!e) {
		v.setInt32(bufferAddr + 0, 9 /*FocusIn*/, true);
		return;
	}

	switch(e.type)
	{
		case "focus":
			v.setInt32(bufferAddr + 0, /*FocusIn*/9, true);
			break;
		case "mousedown":
			v.setInt32(bufferAddr + 0, /*ButtonPress*/4, true);
			v.setInt32(bufferAddr + 4, e.x, true);
			v.setInt32(bufferAddr + 8, e.y, true);
			v.setInt32(bufferAddr + 12, e.button, true);
			break;
		case "mouseup":
			v.setInt32(bufferAddr + 0, /*ButtonRelease*/5, true);
			v.setInt32(bufferAddr + 4, e.x, true);
			v.setInt32(bufferAddr + 8, e.y, true);
			v.setInt32(bufferAddr + 12, e.button, true);
			break;
		case "mousemove":
			v.setInt32(bufferAddr + 0, /*MotionNotify*/6, true);
			v.setInt32(bufferAddr + 4, e.x, true);
			v.setInt32(bufferAddr + 8, e.y, true);
			break;
		case "keydown":
			v.setInt32(bufferAddr + 0, /*KeyPress*/2, true);
			v.setInt32(bufferAddr + 4, e.keyCode, true);
			break;
		case "keyup":
			v.setInt32(bufferAddr + 0, /*KeyRelease*/3, true);
			v.setInt32(bufferAddr + 4, e.keyCode, true);
			break;
		default:
			v.setInt32(bufferAddr + 0, 9 /*FocusIn*/, true);
	}
}

function Java_org_lwjgl_opengl_LinuxEvent_nGetWindow()
{
	// Only a single window is emulated
	return 0;
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetType(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 0, true);
}

function Java_org_lwjgl_opengl_LinuxEvent_nFilterEvent()
{
}

function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonTime()
{
	// TODO: Event timestamps
}

function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonRoot()
{
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonXRoot(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 4, true);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonYRoot(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 8, true);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonX(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 4, true);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonY(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 8, true);
}

function Java_org_lwjgl_opengl_LinuxEvent_nGetFocusDetail()
{
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonType(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 0, true);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetButtonButton(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 12, true);
}

function Java_org_lwjgl_opengl_LinuxDisplay_nGrabPointer()
{
	try {
		glCanvas.requestPointerLock();
	} catch (err) {
		console.warn("Mouse lock blocked - click the screen first!");
	}
	lockedMousePos = { x: 0, y: 0 };
}

function Java_org_lwjgl_opengl_LinuxDisplay_nUngrabPointer()
{
	document.exitPointerLock();
	lockedMousePos = null;
}

function Java_org_lwjgl_opengl_LinuxDisplay_nDefineCursor()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_getRootWindow()
{
}

function Java_org_lwjgl_opengl_LinuxDisplay_nSetWindowIcon()
{
}

function Java_org_lwjgl_opengl_LinuxMouse_nGetWindowWidth()
{
	return 1000;
}

function Java_org_lwjgl_opengl_LinuxMouse_nSendWarpEvent()
{
}

function Java_org_lwjgl_opengl_LinuxMouse_nWarpCursor()
{
}

function Java_org_lwjgl_opengl_LinuxEvent_nSetWindow()
{
}

function Java_org_lwjgl_opengl_LinuxEvent_nSendEvent()
{
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetKeyAddress(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 4, true);
}

function Java_org_lwjgl_opengl_LinuxEvent_nGetKeyTime()
{
	// TODO: Event timestamps
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetKeyType(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 0, true);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetKeyKeyCode(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	return lib.getJNIDataView().getInt32(bufferAddr + 4, true);
}

async function Java_org_lwjgl_opengl_LinuxEvent_nGetKeyState(lib, buffer)
{
	var bufferAddr = Number(await buffer.address());
	var type = lib.getJNIDataView().getInt32(bufferAddr + 0, true);
	return (type === 2) ? 1 : 0;
}

function Java_org_lwjgl_opengl_LinuxKeyboard_lookupKeysym(lib, eventPtr, index)
{
	return Number(eventPtr);
}

function Java_org_lwjgl_opengl_LinuxContextImplementation_nReleaseCurrentContext(lib, peer, funcPtr)
{
    return 1;
}

async function Java_org_lwjgl_opengl_LinuxKeyboard_lookupString(lib, eventPtr, buffer)
{
	var charCode = Number(eventPtr);
	if (charCode >= 32 && charCode <= 126) {
		var bufferAddr = Number(await buffer.address());
		var v = lib.getJNIDataView();
		v.setInt8(bufferAddr, charCode);
		return 1;
	}
	return 0;
}

export default {
	Java_org_lwjgl_DefaultSysImplementation_getPointerSize,
	Java_org_lwjgl_DefaultSysImplementation_getJNIVersion,
	Java_org_lwjgl_DefaultSysImplementation_setDebug,
	Java_org_lwjgl_opengl_LinuxDisplay_nLockAWT,
        Java_org_lwjgl_opengl_LinuxDisplay_nSwitchDisplayMode,
	Java_org_lwjgl_opengl_LinuxDisplay_nUnlockAWT,
	Java_org_lwjgl_opengl_LinuxDisplay_setErrorHandler,
	Java_org_lwjgl_opengl_LinuxDisplay_openDisplay,
	Java_org_lwjgl_opengl_LinuxDisplay_nInternAtom,
	Java_org_lwjgl_opengl_LinuxDisplay_nIsXrandrSupported,
	Java_org_lwjgl_opengl_LinuxDisplay_nIsXF86VidModeSupported,
	Java_org_lwjgl_opengl_LinuxDisplay_nGetDefaultScreen,
	Java_org_lwjgl_opengl_LinuxDisplay_nGetAvailableDisplayModes,
	Java_org_lwjgl_opengl_LinuxDisplay_nGetCurrentGammaRamp,
        Java_org_lwjgl_opengl_LinuxDisplay_nSetGammaRamp,
	Java_org_lwjgl_opengl_LinuxPeerInfo_createHandle,
	Java_org_lwjgl_opengl_GLContext_nLoadOpenGLLibrary,
	Java_org_lwjgl_opengl_LinuxDisplayPeerInfo_initDefaultPeerInfo,
	Java_org_lwjgl_opengl_LinuxDisplayPeerInfo_initDrawable,
	Java_org_lwjgl_opengl_AWTSurfaceLock_createHandle,
	Java_org_lwjgl_opengl_AWTSurfaceLock_lockAndInitHandle,
	Java_org_lwjgl_opengl_LinuxAWTGLCanvasPeerInfo_getScreenFromSurfaceInfo,
	Java_org_lwjgl_opengl_LinuxAWTGLCanvasPeerInfo_nInitHandle,
	Java_org_lwjgl_opengl_AWTSurfaceLock_nUnlock,
	Java_org_lwjgl_opengl_LinuxPeerInfo_nGetDrawable,
	Java_org_lwjgl_opengl_LinuxDisplay_nCreateWindow,
	Java_org_lwjgl_opengl_LinuxDisplay_mapRaised,
	Java_org_lwjgl_opengl_LinuxDisplay_nCreateBlankCursor,
	Java_org_lwjgl_opengl_LinuxDisplay_nSetTitle,
	Java_org_lwjgl_opengl_LinuxMouse_nGetButtonCount,
	Java_org_lwjgl_opengl_LinuxMouse_nQueryPointer,
	Java_org_lwjgl_opengl_LinuxMouse_nGetWindowHeight,
	Java_org_lwjgl_opengl_LinuxKeyboard_getModifierMapping,
	Java_org_lwjgl_opengl_LinuxKeyboard_nSetDetectableKeyRepeat,
	Java_org_lwjgl_opengl_LinuxKeyboard_openIM,
	Java_org_lwjgl_opengl_LinuxKeyboard_allocateComposeStatus,
	Java_org_lwjgl_opengl_LinuxContextImplementation_nCreate,
	Java_org_lwjgl_opengl_LinuxContextImplementation_nMakeCurrent,
	Java_org_lwjgl_opengl_LinuxContextImplementation_nIsCurrent,
	Java_org_lwjgl_opengl_GLContext_ngetFunctionAddress,
	Java_org_lwjgl_opengl_GL11_nglGetString,
	Java_org_lwjgl_opengl_GL11_nglGetIntegerv,
	Java_org_lwjgl_opengl_GL11_nglGetError,
	Java_org_lwjgl_opengl_LinuxContextImplementation_nSetSwapInterval,
	Java_org_lwjgl_opengl_GL11_nglClearColor,
	Java_org_lwjgl_opengl_GL11_nglClear,
	Java_org_lwjgl_opengl_LinuxContextImplementation_nSwapBuffers,
	Java_org_lwjgl_opengl_LinuxEvent_getPending,
	Java_org_lwjgl_opengl_GL11_nglMatrixMode,
	Java_org_lwjgl_opengl_GL11_nglLoadIdentity,
	Java_org_lwjgl_opengl_GL11_nglOrtho,
	Java_org_lwjgl_opengl_GL11_nglTranslatef,
	Java_org_lwjgl_opengl_GL11_nglViewport,
	Java_org_lwjgl_opengl_GL11_nglDisable,
	Java_org_lwjgl_opengl_GL11_nglEnable,
	Java_org_lwjgl_opengl_GL11_nglGenTextures,
	Java_org_lwjgl_opengl_GL11_nglBindTexture,
	Java_org_lwjgl_opengl_GL11_nglTexParameteri,
	Java_org_lwjgl_opengl_GL11_nglTexImage2D,
	Java_org_lwjgl_opengl_GL11_nglTexCoordPointer,
	Java_org_lwjgl_opengl_GL11_nglEnableClientState,
	Java_org_lwjgl_opengl_GL11_nglColorPointer,
	Java_org_lwjgl_opengl_GL11_nglVertexPointer,
	Java_org_lwjgl_opengl_GL11_nglDrawArrays,
	Java_org_lwjgl_opengl_GL11_nglDisableClientState,
	Java_org_lwjgl_opengl_GL11_nglColor4f,
	Java_org_lwjgl_opengl_GL11_nglAlphaFunc,
	Java_org_lwjgl_opengl_GL11_nglGenLists,
	Java_org_lwjgl_opengl_GL11_nglNewList,
	Java_org_lwjgl_opengl_GL11_nglEndList,
	Java_org_lwjgl_opengl_GL11_nglColor3f,
	Java_org_lwjgl_opengl_LinuxDisplay_nGetNativeCursorCapabilities,
	Java_org_lwjgl_opengl_GL11_nglShadeModel,
	Java_org_lwjgl_opengl_GL11_nglClearDepth,
	Java_org_lwjgl_opengl_GL11_nglDepthFunc,
	Java_org_lwjgl_opengl_GL11_nglCullFace,
	Java_org_lwjgl_opengl_GL11_nglPushMatrix,
	Java_org_lwjgl_opengl_GL11_nglPopMatrix,
	Java_org_lwjgl_opengl_GL11_nglMultMatrixf,
	Java_org_lwjgl_opengl_GL11_nglRotatef,
	Java_org_lwjgl_opengl_GL11_nglDepthMask,
	Java_org_lwjgl_opengl_GL11_nglBlendFunc,
	Java_org_lwjgl_opengl_GL11_nglColorMask,
	Java_org_lwjgl_opengl_GL11_nglCopyTexSubImage2D,
	Java_org_lwjgl_opengl_GL11_nglScalef,
	Java_org_lwjgl_opengl_GL11_nglCallLists,
	Java_org_lwjgl_opengl_GL11_nglFlush,
	Java_org_lwjgl_opengl_GL11_nglTexSubImage2D,
	Java_org_lwjgl_opengl_GL11_nglGetFloatv,
	Java_org_lwjgl_opengl_GL11_nglFogfv,
	Java_org_lwjgl_opengl_GL11_nglGetTexLevelParameteriv,
	Java_org_lwjgl_opengl_GL11_nglNormal3f,
	Java_org_lwjgl_opengl_GL11_nglFogi,
	Java_org_lwjgl_opengl_GL11_nglFogf,
	Java_org_lwjgl_opengl_GL11_nglColorMaterial,
	Java_org_lwjgl_opengl_GL11_nglCallList,
	Java_org_lwjgl_opengl_GL13_nglActiveTexture,
	Java_org_lwjgl_opengl_GL11_nglLightfv,
	Java_org_lwjgl_opengl_GL11_nglLightModelfv,
	Java_org_lwjgl_opengl_GL11_nglNormalPointer,
	Java_org_lwjgl_opengl_GL13_nglMultiTexCoord2f,
	Java_org_lwjgl_opengl_GL13_nglClientActiveTexture,
	Java_org_lwjgl_opengl_GL11_nglLineWidth,
	Java_org_lwjgl_opengl_GL11_nglPolygonOffset,
	Java_org_lwjgl_opengl_GL11_nglBegin,
	Java_org_lwjgl_opengl_GL11_nglTexCoord2f,
	Java_org_lwjgl_opengl_GL11_nglVertex3f,
	Java_org_lwjgl_opengl_GL11_nglEnd,
	Java_org_lwjgl_openal_AL_nCreate,
	Java_org_lwjgl_openal_AL10_initNativeStubs,
	Java_org_lwjgl_openal_ALC10_initNativeStubs,
	Java_org_lwjgl_openal_ALC10_nalcOpenDevice,
	Java_org_lwjgl_openal_AL_resetNativeStubs,
	Java_org_lwjgl_openal_AL_nDestroy,
	Java_org_lwjgl_opengl_LinuxEvent_createEventBuffer,
	Java_org_lwjgl_opengl_LinuxEvent_nNextEvent,
	Java_org_lwjgl_opengl_LinuxEvent_nGetWindow,
	Java_org_lwjgl_opengl_LinuxEvent_nGetType,
	Java_org_lwjgl_opengl_LinuxEvent_nFilterEvent,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonTime,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonRoot,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonXRoot,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonYRoot,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonX,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonY,
	Java_org_lwjgl_opengl_LinuxEvent_nGetFocusDetail,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonType,
	Java_org_lwjgl_opengl_LinuxEvent_nGetButtonButton,
	Java_org_lwjgl_opengl_LinuxDisplay_nGrabPointer,
	Java_org_lwjgl_opengl_LinuxDisplay_nUngrabPointer,
	Java_org_lwjgl_opengl_LinuxDisplay_nDefineCursor,
	Java_org_lwjgl_opengl_LinuxDisplay_getRootWindow,
	Java_org_lwjgl_opengl_LinuxDisplay_nSetWindowIcon,
	Java_org_lwjgl_opengl_LinuxMouse_nGetWindowWidth,
	Java_org_lwjgl_opengl_LinuxMouse_nSendWarpEvent,
	Java_org_lwjgl_opengl_LinuxMouse_nWarpCursor,
	Java_org_lwjgl_opengl_LinuxEvent_nSetWindow,
	Java_org_lwjgl_opengl_LinuxEvent_nSendEvent,
	Java_org_lwjgl_opengl_LinuxEvent_nGetKeyAddress,
	Java_org_lwjgl_opengl_LinuxEvent_nGetKeyTime,
	Java_org_lwjgl_opengl_LinuxEvent_nGetKeyType,
	Java_org_lwjgl_opengl_LinuxEvent_nGetKeyKeyCode,
	Java_org_lwjgl_opengl_LinuxEvent_nGetKeyState,
	Java_org_lwjgl_opengl_LinuxKeyboard_lookupKeysym,
	Java_org_lwjgl_opengl_LinuxKeyboard_lookupString,
	Java_org_lwjgl_opengl_LinuxContextImplementation_nReleaseCurrentContext,
}
