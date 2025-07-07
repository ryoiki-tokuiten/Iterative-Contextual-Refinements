/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'preact';
import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import { html } from 'htm/preact';

// --- MORPHOLOGY HELPERS ---

// Helper to get a pixel's brightness from a binary (black/white) image buffer.
// Treats out-of-bounds pixels as black (0), which is standard for erosion.
const getPixel = (data: Uint8ClampedArray, x: number, y: number, width: number, height: number): number => {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return 0;
  }
  // We only need one channel since it's a monochrome mask.
  return data[(y * width + x) * 4];
};

// Helper to set a pixel's color in a binary image buffer.
const setPixel = (data: Uint8ClampedArray, x: number, y: number, width: number, value: number) => {
  const i = (y * width + x) * 4;
  data[i] = data[i + 1] = data[i + 2] = value;
  // Alpha is always opaque for the mask.
  data[i + 3] = 255;
};

/**
 * Applies morphological operations (erosion, dilation) to a binary image mask.
 * 'open' (erode then dilate) is good for removing small noise.
 * 'close' (dilate then erode) is good for filling small holes.
 * @param data The image data to modify.
 * @param width The width of the image.
 * @param height The height of the image.
 * @param type The operation type: 'open' or 'close'.
 */
const applyMorphology = (data: Uint8ClampedArray, width: number, height: number, type: 'open' | 'close') => {
  const src = new Uint8ClampedArray(data); // Create a clean copy to read from
  const buffer = new Uint8ClampedArray(data.length); // Intermediate buffer

  const erode = (input: Uint8ClampedArray, output: Uint8ClampedArray) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let min = 255;
        // Check the 3x3 neighborhood
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            min = Math.min(min, getPixel(input, x + i, y + j, width, height));
          }
        }
        setPixel(output, x, y, width, min);
      }
    }
  };

  const dilate = (input: Uint8ClampedArray, output: Uint8ClampedArray) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let max = 0;
        // Check the 3x3 neighborhood
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            max = Math.max(max, getPixel(input, x + i, y + j, width, height));
          }
        }
        setPixel(output, x, y, width, max);
      }
    }
  };

  if (type === 'open') {
    erode(src, buffer);
    dilate(buffer, data); // Final result goes into the original `data` array
  } else if (type === 'close') {
    dilate(src, buffer);
    erode(buffer, data); // Final result goes into the original `data` array
  }
};


const App = () => {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [isWebcam, setIsWebcam] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 640, height: 360 });
  const [isRecording, setIsRecording] = useState(false);
  const [controls, setControls] = useState({
    detectionMode: 'color', // 'color', 'luminance'
    detectionThreshold: 15.0, // Swaps between 2.5 and 15.0
    processingResolution: 0.25,
    noiseReduction: 0, // Pre-blur
    adaptationRate: 0.05,
    morphology: 'open', // 'none', 'open', 'close'
    effect: 'classic', // 'classic', 'colorBurn', 'electricTrails'
    invert: false,
    persistence: 0.85, // For 'electricTrails' effect
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const backgroundModelData = useRef<{ mean: Float32Array; variance: Float32Array; } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const handleControlChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value =
      target.type === 'checkbox'
        ? target.checked
        : target.type === 'range'
        ? Number(target.value)
        : target.value;
    
    const newControls = { ...controls, [target.id]: value };

    if (target.id === 'detectionMode') {
      if (value === 'color') {
        newControls.detectionThreshold = 15.0; // Default for color
      } else {
        newControls.detectionThreshold = 2.5; // Default for luminance
      }
    }
    
    setControls(newControls);
  };

  const startWebcam = async () => {
    try {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.src = ''; // Important to clear src
        setIsWebcam(true);
        setSourceUrl(null);
      }
    } catch (err) {
      console.error('Error accessing webcam:', err);
      alert('Could not access the webcam. Please ensure permissions are granted.');
    }
  };

  const handleFileUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      const file = target.files[0];
      const url = URL.createObjectURL(file);
      setIsWebcam(false);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream)
          .getTracks()
          .forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
      setSourceUrl(url);
    }
  };

  const startRecording = () => {
    if (!motionCanvasRef.current) return;
    if (isRecording || !motionCanvasRef.current) return;

    const stream = motionCanvasRef.current.captureStream(30); // 30 FPS
    mediaRecorderRef.current = new MediaRecorder(stream, {
      mimeType: 'video/webm; codecs=vp9',
    });

    recordedChunksRef.current = [];

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      a.download = 'motion-extract.webm';
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      recordedChunksRef.current = [];
    };

    mediaRecorderRef.current.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const draw = useCallback(() => {
    const video = videoRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    const motionCanvas = motionCanvasRef.current;
    const processingCanvas = processingCanvasRef.current;

    if (!video || !sourceCanvas || !motionCanvas || !processingCanvas || video.ended || video.readyState < 2) {
      animationFrameId.current = requestAnimationFrame(draw);
      return;
    }

    const sourceCtx = sourceCanvas.getContext('2d');
    const motionCtx = motionCanvas.getContext('2d');
    const processingCtx = processingCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx || !motionCtx || !processingCtx) return;

    const pWidth = Math.floor(dimensions.width * controls.processingResolution);
    const pHeight = Math.floor(dimensions.height * controls.processingResolution);
    if (processingCanvas.width !== pWidth) processingCanvas.width = pWidth;
    if (processingCanvas.height !== pHeight) processingCanvas.height = pHeight;

    if (controls.effect === 'electricTrails') {
      motionCtx.fillStyle = `rgba(0, 0, 0, ${1 - controls.persistence})`;
      motionCtx.fillRect(0, 0, dimensions.width, dimensions.height);
    } else {
      motionCtx.clearRect(0, 0, dimensions.width, dimensions.height);
    }

    sourceCtx.drawImage(video, 0, 0, dimensions.width, dimensions.height);

    processingCtx.filter = `blur(${controls.noiseReduction}px)`;
    processingCtx.drawImage(video, 0, 0, pWidth, pHeight);

    const currentFrame = processingCtx.getImageData(0, 0, pWidth, pHeight);
    const currentData = currentFrame.data;

    const motionFrame = processingCtx.createImageData(pWidth, pHeight);
    const motionData = motionFrame.data;
    
    if (!backgroundModelData.current) {
      const pSize = pWidth * pHeight;
      const variance = new Float32Array(pSize);
      const initialVariance = 100;
      variance.fill(initialVariance);
      
      let mean;
      if (controls.detectionMode === 'color') {
        mean = new Float32Array(pSize * 3);
        for (let i = 0, j = 0; i < currentData.length; i += 4, j++) {
            mean[j * 3] = currentData[i];     // R
            mean[j * 3 + 1] = currentData[i + 1]; // G
            mean[j * 3 + 2] = currentData[i + 2]; // B
        }
      } else { // luminance
        mean = new Float32Array(pSize);
        for (let i = 0, j = 0; i < currentData.length; i += 4, j++) {
            const brightness = (currentData[i] + currentData[i + 1] + currentData[i + 2]) / 3;
            mean[j] = brightness;
        }
      }

      backgroundModelData.current = { mean, variance };
      animationFrameId.current = requestAnimationFrame(draw);
      return;
    }

    const backgroundModel = backgroundModelData.current;
    const meanData = backgroundModel.mean;
    const varianceData = backgroundModel.variance;
    
    const alpha = controls.adaptationRate;
    const thresholdMultiplier = controls.detectionThreshold;
    const fg = controls.invert ? [0, 0, 0] : [255, 255, 255];
    const bg = controls.invert ? [255, 255, 255] : [0, 0, 0];
    const colorBurn = [3, 218, 198];
    const minVariance = 25;

    for (let i = 0, j = 0; i < currentData.length; i += 4, j++) {
      let isForeground;
      
      const r = currentData[i];
      const g = currentData[i + 1];
      const b = currentData[i + 2];
      const currentBrightness = (r + g + b) / 3;
      const variance = varianceData[j];

      if (controls.detectionMode === 'color') {
        const meanR = meanData[j * 3];
        const meanG = meanData[j * 3 + 1];
        const meanB = meanData[j * 3 + 2];
        const colorDist = Math.sqrt(Math.pow(r - meanR, 2) + Math.pow(g - meanG, 2) + Math.pow(b - meanB, 2));
        isForeground = colorDist > thresholdMultiplier * Math.sqrt(Math.max(variance, minVariance));
        
        if (!isForeground) {
          meanData[j * 3]     = (1 - alpha) * meanR + alpha * r;
          meanData[j * 3 + 1] = (1 - alpha) * meanG + alpha * g;
          meanData[j * 3 + 2] = (1 - alpha) * meanB + alpha * b;
          const meanBrightness = (meanR + meanG + meanB) / 3;
          const diff = currentBrightness - meanBrightness;
          varianceData[j] = (1 - alpha) * variance + alpha * (diff * diff);
        }
      } else { // 'luminance' mode
        const mean = meanData[j];
        const diff = currentBrightness - mean;
        isForeground = Math.abs(diff) > thresholdMultiplier * Math.sqrt(Math.max(variance, minVariance));
        
        if (!isForeground) {
          meanData[j] = (1 - alpha) * mean + alpha * currentBrightness;
          varianceData[j] = (1 - alpha) * variance + alpha * (diff * diff);
        }
      }
      
      if (isForeground) {
        let color = fg;
        if (controls.effect === 'colorBurn' && !controls.invert) {
          color = colorBurn;
        }
        motionData[i] = color[0];
        motionData[i + 1] = color[1];
        motionData[i + 2] = color[2];
        motionData[i + 3] = 255;
      } else {
        motionData[i] = bg[0];
        motionData[i + 1] = bg[1];
        motionData[i + 2] = bg[2];
        motionData[i + 3] = controls.effect === 'electricTrails' ? 0 : 255;
      }
    }

    if (controls.morphology !== 'none') {
      applyMorphology(motionData, pWidth, pHeight, controls.morphology as 'open' | 'close');
    }

    processingCtx.putImageData(motionFrame, 0, 0);
    motionCtx.imageSmoothingEnabled = false;
    motionCtx.drawImage(processingCanvas, 0, 0, dimensions.width, dimensions.height);

    animationFrameId.current = requestAnimationFrame(draw);
  }, [dimensions, controls]);

  // Effect to manage video source lifecycle: loading, playing, and cleanup.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!sourceUrl && !isWebcam)) return;

    if(sourceUrl) {
      video.src = sourceUrl;
    }

    let hasInitialized = false;
    const initPlayback = () => {
      if (hasInitialized || !video) return;
      hasInitialized = true;

      const newWidth = video.videoWidth || 640;
      const newHeight = video.videoHeight || 360;
      const aspectRatio = newWidth / newHeight;
      const displayWidth = 640;
      setDimensions({ width: displayWidth, height: displayWidth / aspectRatio });

      video.play().catch(e => {
        if (e.name !== 'AbortError') {
          console.error("Error playing video:", e);
        }
      });
    };

    video.onloadedmetadata = initPlayback;
    video.oncanplay = initPlayback; // Robustness for webcam streams
    if (video.readyState >= 2) initPlayback(); // HAVE_METADATA

    return () => {
      if (video) {
        video.onloadedmetadata = null;
        video.oncanplay = null;
      }
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl, isWebcam]);

  // Effect to manage the rendering loop.
  useEffect(() => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
    }
    
    if (sourceUrl || isWebcam) {
      animationFrameId.current = requestAnimationFrame(draw);
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [draw, sourceUrl, isWebcam]);


  // Effect to reset the background model when source or key params change.
  useEffect(() => {
    backgroundModelData.current = null;
  }, [controls.processingResolution, controls.detectionMode, sourceUrl, isWebcam]);

  return html`
    <div class="sidebar">
      <div class="sidebar-header">Controls</div>
      <fieldset>
        <legend>Source</legend>
        <div class="button-group">
          <label for="video-upload" class="btn">Upload Video</label>
          <input id="video-upload" type="file" accept="video/*" onChange=${handleFileUpload} />
          <button class="btn secondary" onClick=${startWebcam}>Use Webcam</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Algorithm</legend>
        <div class="control-group">
            <label for="detectionMode">Detection Mode</label>
            <select id="detectionMode" value=${controls.detectionMode} onChange=${handleControlChange}>
                <option value="color">Color (Robust)</option>
                <option value="luminance">Luminance (Classic)</option>
            </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Detection</legend>
        <div class="control-group">
          <label for="detectionThreshold">
            ${controls.detectionMode === 'color' ? 'Color Threshold' : 'Luminance Threshold'}: ${controls.detectionThreshold.toFixed(1)}
          </label>
          <input 
            id="detectionThreshold" 
            type="range" 
            min="1.0" 
            max=${controls.detectionMode === 'color' ? 50.0 : 10.0} 
            step="0.1" 
            value=${controls.detectionThreshold} 
            onInput=${handleControlChange} />
        </div>
        <div class="control-group">
          <label for="adaptationRate">Adaptation Speed: ${Math.round(controls.adaptationRate * 1000)}</label>
          <input id="adaptationRate" type="range" min="0.001" max="0.5" step="0.001" value=${controls.adaptationRate} onInput=${handleControlChange} />
        </div>
        <div class="control-group">
          <label for="processingResolution">Resolution: ${Math.round(controls.processingResolution * 100)}%</label>
          <input id="processingResolution" type="range" min="0.1" max="1" step="0.05" value=${controls.processingResolution} onInput=${handleControlChange} />
        </div>
         <div class="control-group">
          <label for="noiseReduction">Pre-blur: ${controls.noiseReduction}px</label>
          <input id="noiseReduction" type="range" min="0" max="5" step="0.5" value=${controls.noiseReduction} onInput=${handleControlChange} />
        </div>
        <div class="control-group">
          <label for="morphology">Cleanup Filter</label>
          <select id="morphology" value=${controls.morphology} onChange=${handleControlChange}>
            <option value="none">None</option>
            <option value="open">Clean Noise</option>
            <option value="close">Fill Gaps</option>
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Effects</legend>
        <div class="control-group">
          <label for="effect">Style</label>
          <select id="effect" value=${controls.effect} onChange=${handleControlChange}>
            <option value="classic">Classic</option>
            <option value="colorBurn">Color Burn</option>
            <option value="electricTrails">Electric Trails</option>
          </select>
        </div>
        ${controls.effect === 'electricTrails' && html`
          <div class="control-group">
            <label for="persistence">Trail Length: ${Math.round(controls.persistence * 100)}%</label>
            <input id="persistence" type="range" min="0" max="0.99" step="0.01" value=${controls.persistence} onInput=${handleControlChange} />
          </div>
        `}
        <div class="toggle-switch">
          <span class="toggle-label">Invert Colors</span>
          <label class="switch">
            <input id="invert" type="checkbox" checked=${controls.invert} onChange=${handleControlChange} />
            <span class="slider"></span>
          </label>
        </div>
      </fieldset>
      
      <fieldset>
        <legend>Output</legend>
        <button class="btn ${isRecording ? 'recording' : ''}" onClick=${isRecording ? stopRecording : startRecording}>
          ${isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
      </fieldset>
    </div>

    <main>
      ${!sourceUrl && !isWebcam && html`
        <div class="message">
          <h1>Welcome to the Advanced Motion Extractor</h1>
          <p>Upload a video file or activate your webcam to begin. Use the controls on the left to configure the detection and apply visual effects in real-time.</p>
        </div>
      `}
      <div class="canvas-container" style=${{ display: sourceUrl || isWebcam ? 'flex' : 'none' }}>
        <div class="canvas-wrapper">
          <h2>Source</h2>
          <canvas ref=${sourceCanvasRef} width=${dimensions.width} height=${dimensions.height}></canvas>
        </div>
        <div class="canvas-wrapper">
          <h2>Motion</h2>
          <canvas ref=${motionCanvasRef} width=${dimensions.width} height=${dimensions.height}></canvas>
        </div>
      </div>
    </main>

    <video ref=${videoRef} class="hidden" loop muted playsinline></video>
    <canvas ref=${processingCanvasRef} class="hidden"></canvas>
  `;
};

render(html`<${App} />`, document.getElementById('app') as HTMLElement);