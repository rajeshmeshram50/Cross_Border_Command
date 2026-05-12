import { useCallback, useEffect, useRef, useState } from 'react';

// face-api.js is loaded lazily on first mount so the bundle doesn't pay the
// ~1MB tax on routes that never touch the camera. Model files (~10MB) are
// fetched from the public CDN the library maintainer hosts. Self-hosting is
// just a matter of copying weights into /public/face-models and overriding
// MODEL_URL via Vite env. Documented in the comment at the URL constant.
//
// We use:
//   - tinyFaceDetector (lighter, ~190 KB, fine for one face at close range)
//   - faceLandmark68Net (point map needed for the descriptor)
//   - faceRecognitionNet (the 128-d embedding model)

type FaceApi = typeof import('face-api.js');

// Self-host in /public/face-models so production isn't dependent on an
// external CDN. Drop the weights from the npm package into that folder
// (instructions in the runbook) — Vite copies /public/* verbatim into the
// build output, so this path works in dev and prod.
const MODEL_URL = import.meta.env.VITE_FACE_MODEL_URL || '/face-models';

let faceApiPromise: Promise<FaceApi> | null = null;
let modelsLoaded = false;

async function ensureFaceApi(): Promise<FaceApi> {
  if (!faceApiPromise) {
    faceApiPromise = import('face-api.js');
  }
  const faceapi = await faceApiPromise;
  if (!modelsLoaded) {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  }
  return faceapi;
}

export interface FaceCaptureResult {
  /** 128-floats descriptor — ship straight to the API. */
  descriptor: number[];
  /** Square score (0–1) for the detector. Higher = more confident. */
  detectionScore: number;
  /** PNG data-URL of the captured frame, for preview UI. */
  previewDataUrl: string;
}

interface Props {
  /** Called when the user clicks Capture and a face is successfully detected. */
  onCapture: (result: FaceCaptureResult) => void;
  /** Optional CTA label. Defaults to "Capture". */
  captureLabel?: string;
  /** Hide the capture button — caller drives the capture via ref. */
  hideCaptureButton?: boolean;
  /** Stops the webcam stream. Caller passes true after success to release the camera. */
  paused?: boolean;
}

/**
 * Self-contained webcam tile that loads face-api.js, opens the user's camera,
 * and (on click of the Capture button) detects ONE face, computes the 128-d
 * descriptor, and bubbles it up via `onCapture`.
 *
 * Errors that the UI surfaces:
 *   - "Loading models…" until weights are fetched
 *   - "Camera permission denied" when getUserMedia rejects
 *   - "No face detected" / "Multiple faces detected" on capture failure
 */
export default function FaceCapture({ onCapture, captureLabel = 'Capture', hideCaptureButton, paused }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<'loading-models' | 'opening-camera' | 'ready' | 'error'>('loading-models');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [working, setWorking] = useState(false);

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Boot: load face-api models, then open the camera.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureFaceApi();
        if (cancelled) return;
        setPhase('opening-camera');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => { /* autoplay may need a tick */ });
        }
        setPhase('ready');
      } catch (err: any) {
        if (cancelled) return;
        setPhase('error');
        const isPermission = err?.name === 'NotAllowedError' || /denied/i.test(String(err?.message));
        const isNoDevice  = err?.name === 'NotFoundError'   || /no\s*camera|no\s*device/i.test(String(err?.message));
        if (isPermission) setErrorMsg('Camera permission was denied. Please allow camera access in your browser and reload.');
        else if (isNoDevice) setErrorMsg('No camera was found on this device.');
        else setErrorMsg(err?.message || 'Could not start the camera.');
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause/resume hook — caller can flip `paused` true to release the camera
  // after a successful capture without unmounting the whole component.
  useEffect(() => {
    if (paused) stopStream();
  }, [paused, stopStream]);

  const handleCapture = useCallback(async () => {
    if (working) return;
    if (!videoRef.current || phase !== 'ready') return;
    setWorking(true);
    try {
      const faceapi = await ensureFaceApi();
      const video = videoRef.current;

      // Detect ONE face plus its landmarks + descriptor. inputSize controls
      // accuracy vs speed; 224 is the practical sweet spot for laptop webcams.
      const detector = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const detections = await faceapi.detectAllFaces(video, detector)
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (!detections || detections.length === 0) {
        setErrorMsg('No face detected. Move closer to the camera and ensure good lighting.');
        return;
      }
      if (detections.length > 1) {
        setErrorMsg('Multiple faces detected. Make sure only your face is in the frame.');
        return;
      }
      const det = detections[0];
      const descriptorArr = Array.from(det.descriptor as Float32Array);

      // Snap a still frame for the preview tile.
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 480;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      setErrorMsg('');
      onCapture({
        descriptor: descriptorArr,
        detectionScore: det.detection.score,
        previewDataUrl: canvas.toDataURL('image/png'),
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Face capture failed. Please try again.');
    } finally {
      setWorking(false);
    }
  }, [onCapture, phase, working]);

  return (
    <div className="d-flex flex-column gap-2">
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 480,
          aspectRatio: '4/3',
          background: '#0f172a',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 12px 32px rgba(15,23,42,0.18)',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(-1)', // mirror — feels natural to the user
          }}
        />
        {/* Soft circular guide so the user knows where to position their face */}
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '55%', aspectRatio: '1/1', borderRadius: '50%',
              border: '2px dashed rgba(255,255,255,0.55)',
            }}
          />
        </div>

        {phase !== 'ready' && (
          <div style={{
            position: 'absolute', inset: 0, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(15,23,42,0.55)', textAlign: 'center', padding: 16,
          }}>
            {phase === 'loading-models' && (<><i className="ri-loader-4-line ri-spin me-2" /> Loading face-recognition models…</>)}
            {phase === 'opening-camera' && (<><i className="ri-camera-line me-2" /> Opening your camera…</>)}
            {phase === 'error' && (<div>
              <i className="ri-error-warning-line me-2" />
              <div style={{ marginTop: 6, fontSize: 13 }}>{errorMsg || 'Could not start the camera.'}</div>
            </div>)}
          </div>
        )}
      </div>

      {errorMsg && phase === 'ready' && (
        <div className="text-danger" style={{ fontSize: 13 }}>
          <i className="ri-error-warning-line me-1" />
          {errorMsg}
        </div>
      )}

      {!hideCaptureButton && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCapture}
          disabled={phase !== 'ready' || working}
        >
          {working ? (<><span className="spinner-border spinner-border-sm me-2" /> Analysing…</>) : (
            <><i className="ri-camera-3-line me-1" /> {captureLabel}</>
          )}
        </button>
      )}
    </div>
  );
}
