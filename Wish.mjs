import {
    createTexture,
    createFramebufferInfo,
    createProgramInfo,
    createBufferInfoFromArrays,
    resizeCanvasToDisplaySize,
    setBuffersAndAttributes,
    setUniforms,
    drawBufferInfo,
    resizeFramebufferInfo,
} from 'twgl.js'

import {make as makeResolutionRatio} from './ResolutionRatioCalculator.mjs'

import { compile } from './Shader.mjs'
import { wrap as wrapFeatures } from './Features.mjs'

const defaultVertexShader = `#version 300 es
in vec4 position;
void main() {
    gl_Position = position;
}`

// Simple full-screen quad
const positions = [
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    -1, 1, 0,
    1, -1, 0,
    1, 1, 0,
]

// Extracted helper for handling shader compilation errors
const handleShaderError = (gl, wrappedFragmentShader) => {
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, wrappedFragmentShader);
    gl.compileShader(fragmentShader);

    /**
     * @type {string | Error}
     */
    let error = gl.getShaderInfoLog(fragmentShader);
    if (error instanceof Error) error = error.message;

    gl.deleteShader(fragmentShader);

    // Find the line with our marker
    const wrappedLines = wrappedFragmentShader.split('\n');
    const markerLineIndex = wrappedLines.findIndex(line => line.includes('31CF3F64-9176-4686-9E52-E3CFEC21FE72'));
    const headerLineCount = markerLineIndex !== -1 ? markerLineIndex + 1 : 0;

    let message = `there was something wrong with ur shader`
    let lineNumber = 0
    const errorMatch = error.match(/ERROR: \d+:(\d+):/);
    if (errorMatch) {
        lineNumber = parseInt(errorMatch[1]) - headerLineCount;
        message = error.split(':').slice(3).join(':').trim();
    }

    throw new Error(JSON.stringify({lineNumber, message})) // Ensure error is properly stringified
}

// Extracted helper for getting WebGL2 context
const getWebGLContext = (canvas) => {
    const gl = canvas.getContext('webgl2', {
        antialias: false,
        powerPreference: 'high-performance',
        attributes: {
            alpha: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            pixelRatio: 1
        }
    })
    if (!gl) {
        throw new Error("WebGL2 not supported");
    }
    return gl;
}

// Extracted helper for creating and configuring framebuffers
const createFramebuffers = (gl) => {
    const frameBuffers = [createFramebufferInfo(gl), createFramebufferInfo(gl)]
    frameBuffers.forEach(fb => {
        const texture = fb.attachments[0]
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    })
    return frameBuffers;
}


/**
 * @param {WebGLRenderingContext} gl
 * @param {HTMLImageElement} initialImage
 * @returns {Promise<WebGLTexture>}
 */
const getInitialFrame = async (gl, initialImage) => {
    if(!initialImage) return createTexture(gl, { width: 1, height: 1, min: gl.NEAREST, mag: gl.NEAREST, wrap: gl.REPEAT })
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    const texture = createTexture(gl, {
        src: initialImage,
        min: gl.NEAREST,
        mag: gl.NEAREST,
        wrap: gl.REPEAT,
    })
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    return texture
}

// Extracted helper to parse props for shader and features
const getShaderAndFeaturesFromProps = (props, lastShader, previousFeatures) => {
    if(props === undefined) return {rawShader: lastShader, features: {...previousFeatures}}
    if(typeof props === 'string') return {rawShader: props, features: {...previousFeatures}}
    if(typeof props !== 'object' || props === null) throw new Error('props must be an object or a string') // Added null check

    const {fragmentShader, features: explicitFeatures, ...otherProps} = props;


    // Combine features explicitly provided and other props
    const features = {
        ...previousFeatures,
        ...(explicitFeatures || {}),
        ...otherProps
    };

    return {
        rawShader: fragmentShader ?? lastShader,
        features
    }
}


const isUniform = (value) => {
    if(typeof value === 'number' && Number.isFinite(value)) return true
    if(Array.isArray(value) && value.every(v => typeof v === 'number' && Number.isFinite(v))) return true
    if(value && typeof value === 'object') return Array.from(value).every(isUniform)
    return false
}


/**
 * @param {Object} deps
 * @param {HTMLCanvasElement} deps.canvas
 * @param {HTMLImageElement} deps.initialImage
 * @param {string} deps.fragmentShader
 * @returns {Function}
 * @description
 * This function creates a new render function.
 * It initializes the WebGL context, sets up double buffering, and sets up the rendering loop.
 * It also handles shader compilation and uniform management.
 *
 * @example
 * const render = make({canvas, initialImage, fragmentShader})
 * render()
 */
export const make = async (deps) => { // Removed async as it's not used
    const {canvas, initialImage, fragmentShader} = deps
    const startTime = performance.now()

    const gl = getWebGLContext(canvas);
    const initialTexture = await getInitialFrame(gl, initialImage); // Use internal helper
    const frameBuffers = createFramebuffers(gl);
    const bufferInfo = createBufferInfoFromArrays(gl, {
        position: positions
    });

    // Persistent random seeds
    const seeds = [Math.random(), Math.random(), Math.random(), Math.random()]

    // State variables
    let frameNumber = 0
    let lastResolutionRatio = 1.0 // Start at 1.0
    let lastShader = fragmentShader
    let previousFeatures = {}

    // Logic to copy rendered frame to canvas extracted
    const copyFrameToCanvas = (frame) => {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, frame.framebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        // Ensure dimensions match the framebuffer, not potentially resized canvas
        gl.blitFramebuffer(
            0, 0, frame.width, frame.height,
            0, 0, frame.width, frame.height, // Blit based on frame buffer size
            gl.COLOR_BUFFER_BIT, gl.NEAREST
        );
        // Explicitly unbind the read framebuffer as well
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }

    let frameRenderTimes = []
    let lastFrameTime = 0
    const getRatio = (time) => {
        frameRenderTimes.push(time - lastFrameTime)
        lastFrameTime = time
        if(frameRenderTimes.length < 20) return 1
        if(frameRenderTimes.length > 20) frameRenderTimes.shift()
        const averageFrameTime = frameRenderTimes.reduce((a, b) => a + b, 0) / frameRenderTimes.length
        return Math.min( 1 /(averageFrameTime * 16), 1)
    }
    const resizeAll= (time) => {
        const ratio = getRatio(time)
        const resized = resizeCanvasToDisplaySize(gl.canvas, ratio)
        // <<< RESTORE THIS >>> User requires FBOs to match canvas size for blit
        if (resized) { // Only resize FBOs if canvas actually resized
             frameBuffers.forEach(fb => resizeFramebufferInfo(gl, fb));
             gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        }
    }

    let programInfo
    /**
     * @param {Object | string | undefined} props
     * @returns {boolean}
     * @description
     * render is the main function that renders a frame. it can take props to update the shader and/or features.
     * it can also take no props to just render the frame.
     *
     * @example
     * const render = make({canvas, initialImage, fragmentShader})
     * render()
     * render({fragmentShader: 'new shader'})
     * render({features: {newFeature: true}})
     */
    const render = (props) => {

        let changedShader = false;
        const now = performance.now();
        const time = (now - startTime) / 1000;
        resizeAll(time); // Resize canvas/FBOs first

        // 1. Parse props
        const { rawShader, features } = getShaderAndFeaturesFromProps(props, lastShader, previousFeatures);

        const [currentFrame, previousFrame] = frameBuffers
        const prevFrameTexture = frameNumber === 0 ? initialTexture : previousFrame.attachments[0];

        // 3. Create dynamic context for uniforms
        const uniforms = {
            // Core uniforms
            initialFrame: initialTexture,
            prevFrame: prevFrameTexture,
            resolution: [frameBuffers[0].width, frameBuffers[0].height, 1],
            time,
            frame: frameNumber,
            touched: features.touched ?? false,
            touch: [features.touchX, features.touchY, features.touched ? 1: 0, 0],
            // Random/seed uniforms
            iRandom: Math.random(),
            seed: seeds[0],
            seed2: seeds[1],
            seed3: seeds[2],
            seed4: seeds[3],
            // User features (override any defaults above)
            ...features
        };
        const wrappedUniforms = wrapFeatures(uniforms);
        const wrappedShader = compile(rawShader, wrappedUniforms);
        // 4. Check if shader needs recompile
        if (rawShader !== lastShader || !programInfo) {
            programInfo = createProgramInfo(gl, [defaultVertexShader, wrappedShader]);
            gl.useProgram(programInfo.program);
        }
        // Skip render if program is invalid
        if (!programInfo?.program) return false;
        gl.bindFramebuffer(gl.FRAMEBUFFER, currentFrame.framebuffer);
        setBuffersAndAttributes(gl, programInfo, bufferInfo);
        setUniforms(programInfo, wrappedUniforms);
        drawBufferInfo(gl, bufferInfo);

        // 7. Copy to Canvas
        copyFrameToCanvas(currentFrame);

        // 8. Update frame counter
        frameNumber++;
        // flip the framebuffers
        frameBuffers.reverse();
        // Update last shader for comparison
        if (rawShader !== lastShader) {
            lastShader = rawShader;
            changedShader = true;
        }
        // Update features for next time
        previousFeatures = {...features};

        return frameBuffers[1].attachments[0]
    }

    // Cleanup logic extracted
    const cleanupResources = () => {
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        // Delete resources - check existence before deleting
        frameBuffers.forEach(fb => {
            gl.deleteFramebuffer(fb.framebuffer)
            gl.deleteTexture(fb.attachments[0])
        })
        gl.deleteTexture(initialTexture)
        gl.deleteProgram(programInfo?.program)
    }

    render.cleanup = () => {
        const image = new Image();
        image.src = gl.canvas.toDataURL();
        cleanupResources();
        return image;
    }
    return render
}
export default make
