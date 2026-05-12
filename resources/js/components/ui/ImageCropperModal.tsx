import { useCallback, useEffect, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';

/**
 * Instagram / WhatsApp style image crop + zoom + rotate dialog.
 *
 * Opens over the page with a dark backdrop and a circular crop preview
 * (for avatars). Users drag the image, zoom with a slider/scroll-wheel,
 * and rotate in 90° steps. On confirm we render the cropped region into
 * a canvas and emit a JPEG `Blob` the caller can submit as a File.
 *
 * Usage:
 *   <ImageCropperModal
 *     open={cropOpen}
 *     src={pickedDataUrl}
 *     aspect={1}
 *     cropShape="round"
 *     outputSize={512}
 *     onCancel={() => setCropOpen(false)}
 *     onConfirm={async blob => {
 *       const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
 *       …
 *     }}
 *   />
 */

interface Props {
  open: boolean;
  /** Data URL or object URL of the source image. */
  src: string | null;
  /** Width/height ratio of the crop box (1 = square). Default 1. */
  aspect?: number;
  /** Round = circular mask (avatars). Rect = rectangle (logos). */
  cropShape?: 'round' | 'rect';
  /** Output side length in px. Default 512. */
  outputSize?: number;
  /** Output mime type — 'image/jpeg' or 'image/png'. Default jpeg. */
  outputType?: 'image/jpeg' | 'image/png';
  /** JPEG quality 0..1. Default 0.92. */
  outputQuality?: number;
  /** Minimum zoom. Default 1 (WhatsApp/Instagram standard — image always
   *  fills the crop area, can only zoom in). Set < 1 if you need to allow
   *  the whole image to fit inside the circle with letterboxing. */
  minZoom?: number;
  /** Maximum zoom. Default 3. */
  maxZoom?: number;
  /** Title shown in the modal header. */
  title?: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
}

// Build a fresh HTMLImageElement from a (data | object) URL, awaiting load.
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image for cropping.'));
    img.src = src;
  });
}

// Render the chosen crop region + rotation into a square canvas and
// hand back a Blob. Rotating about the centre means we first paint the
// rotated image into an oversized canvas, then carve out the cropped
// region. This is the standard react-easy-crop "rotation aware" recipe.
async function cropToBlob(
  src: string,
  pixelCrop: Area,
  rotation: number,
  outputSize: number,
  type: 'image/jpeg' | 'image/png',
  quality: number,
): Promise<Blob> {
  const image = await loadImage(src);
  const rad = (rotation * Math.PI) / 180;

  // Bounding box that contains the rotated image.
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const bboxW = image.width * cos + image.height * sin;
  const bboxH = image.width * sin + image.height * cos;

  // Stage canvas — rotated image painted onto it.
  const stage = document.createElement('canvas');
  stage.width = bboxW;
  stage.height = bboxH;
  const sctx = stage.getContext('2d');
  if (!sctx) throw new Error('No 2D context for crop stage.');
  sctx.translate(bboxW / 2, bboxH / 2);
  sctx.rotate(rad);
  sctx.drawImage(image, -image.width / 2, -image.height / 2);

  // Crop canvas — extract the user-selected region, normalised to outputSize.
  const out = document.createElement('canvas');
  out.width = outputSize;
  out.height = outputSize;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('No 2D context for crop output.');
  // For JPEGs (no alpha) we fill white so any transparent pixels in a
  // PNG source don't render as black after re-encoding.
  if (type === 'image/jpeg') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
  }
  octx.drawImage(
    stage,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return new Promise((resolve, reject) => {
    out.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas blob failed.'))), type, quality);
  });
}

export default function ImageCropperModal({
  open,
  src,
  aspect = 1,
  cropShape = 'round',
  outputSize = 512,
  outputType = 'image/jpeg',
  outputQuality = 0.92,
  minZoom = 1,
  maxZoom = 3,
  title = 'Adjust photo',
  onCancel,
  onConfirm,
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(minZoom);
  const [rotation, setRotation] = useState(0);
  const [pixelCrop, setPixelCrop] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset all transform state whenever a new source loads (or the modal
  // re-opens with a different image). Without this, stale crop position
  // from a previous session leaves the image stuck below / off-circle.
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(minZoom);
    setRotation(0);
    setPixelCrop(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixelCrop(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!src || !pixelCrop) return;
    setSaving(true);
    try {
      const blob = await cropToBlob(src, pixelCrop, rotation, outputSize, outputType, outputQuality);
      await onConfirm(blob);
    } finally {
      setSaving(false);
    }
  };

  // Reset transform when the source changes (e.g. user re-picks a file).
  const handleClose = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(minZoom);
    setRotation(0);
    setPixelCrop(null);
    onCancel();
  };

  if (!open || !src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="cbc-crop-backdrop"
      onClick={handleClose}
    >
      <style>{`
        @keyframes cbcCropFade   { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cbcCropPop    { from { opacity: 0; transform: scale(0.97) translateY(8px) } to { opacity: 1; transform: scale(1) translateY(0) } }
        @keyframes cbcCropSlide  { from { transform: translateY(60px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes cbcSpin       { from { transform: rotate(0) } to { transform: rotate(360deg) } }

        /* ── Backdrop & shell ─────────────────────────────────────── */
        .cbc-crop-backdrop {
          position: fixed; inset: 0; z-index: 2000;
          display: flex; align-items: center; justify-content: center;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          animation: cbcCropFade .2s ease both;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
        }
        /* Fully dark cropper — explicit colors, no theme vars. Photo
           editors look the same in light or dark app themes (Instagram,
           WhatsApp, Photoshop, Lightroom all use a dark photo-focused UI
           regardless of system theme), so the cropper's chrome doesn't
           shift colors as the user toggles app theme. */
        .cbc-crop-shell {
          width: min(94vw, 640px);
          background: #161c2b;
          color: #e5e7eb;
          border-radius: 16px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
          overflow: hidden;
          animation: cbcCropPop .26s cubic-bezier(0.22,1,0.36,1) both;
          display: flex; flex-direction: column;
          max-height: 92vh;
        }

        /* ── Header ────────────────────────────────────────────────── */
        .cbc-crop-head {
          padding: 14px 18px;
          background: #1c2336;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0;
        }
        .cbc-crop-head-title {
          display: flex; align-items: center; gap: 10px;
          font-size: 15px; font-weight: 700; letter-spacing: -0.01em;
          color: #ffffff;
        }
        .cbc-crop-head-chip {
          width: 30px; height: 30px; border-radius: 9px;
          display: inline-flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, #1d4fc4, #3b82f6);
          color: #fff;
          box-shadow: 0 4px 10px rgba(29,79,196,0.40);
        }
        .cbc-crop-close {
          width: 32px; height: 32px; border-radius: 9px;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65);
          border: 1px solid rgba(255,255,255,0.10);
          cursor: pointer; transition: all .15s ease;
        }
        .cbc-crop-close:hover {
          background: rgba(239,68,68,0.15); color: #fca5a5;
          border-color: rgba(239,68,68,0.40);
        }

        /* ── Stage ────────────────────────────────────────────────── */
        .cbc-crop-stage {
          position: relative;
          height: min(420px, 56vh);
          background: #0a0f1d;
          flex-shrink: 0;
        }
        /* Crop circle — bright white ring with strong dark dim outside.
           The library's box-shadow uses currentColor; setting color here
           is how we control overlay opacity. */
        .cbc-crop-stage .reactEasyCrop_CropArea {
          border: 2.5px solid #ffffff !important;
          color: rgba(0, 0, 0, 0.72) !important;
          box-sizing: border-box !important;
        }

        /* ── Controls block ───────────────────────────────────────── */
        .cbc-crop-controls {
          padding: 16px 18px 18px;
          display: flex; flex-direction: column; gap: 14px;
          background: #1c2336;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        /* Zoom row */
        .cbc-crop-zoom-row { display: flex; align-items: center; gap: 12px; }
        .cbc-crop-zoom-ic {
          display: inline-flex; color: rgba(255,255,255,0.55); flex-shrink: 0;
        }
        .cbc-crop-slider {
          flex: 1; height: 4px; appearance: none;
          background: linear-gradient(to right,
            #3b82f6 0%,
            #3b82f6 var(--cbc-fill, 0%),
            rgba(255,255,255,0.12) var(--cbc-fill, 0%),
            rgba(255,255,255,0.12) 100%);
          border-radius: 999px; outline: none; cursor: pointer;
        }
        .cbc-crop-slider::-webkit-slider-thumb {
          appearance: none; width: 18px; height: 18px; border-radius: 50%;
          background: #fff; border: 2px solid #1d4fc4;
          box-shadow: 0 2px 6px rgba(29,79,196,0.30);
          cursor: pointer; transition: transform .15s ease, box-shadow .15s ease;
        }
        .cbc-crop-slider:hover::-webkit-slider-thumb,
        .cbc-crop-slider:active::-webkit-slider-thumb {
          transform: scale(1.12);
          box-shadow: 0 2px 6px rgba(29,79,196,0.30), 0 0 0 6px rgba(29,79,196,0.12);
        }
        .cbc-crop-slider::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: #fff; border: 2px solid #1d4fc4;
          box-shadow: 0 2px 6px rgba(29,79,196,0.30); cursor: pointer;
        }
        .cbc-crop-zoom-pill {
          min-width: 54px; text-align: center;
          font-size: 12px; font-weight: 700; color: #ffffff;
          font-variant-numeric: tabular-nums;
          padding: 5px 10px; border-radius: 999px;
          background: rgba(59,130,246,0.18);
          border: 1px solid rgba(59,130,246,0.30);
        }

        /* Action row — Rotate / Reset on left, Cancel / Save on right */
        .cbc-crop-action-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap;
        }
        .cbc-crop-tool-group { display: flex; gap: 8px; }
        .cbc-crop-tool {
          width: 40px; height: 40px; border-radius: 10px;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.85);
          cursor: pointer;
          transition: all .15s ease;
        }
        .cbc-crop-tool:hover {
          color: #ffffff; border-color: rgba(59,130,246,0.50);
          background: rgba(59,130,246,0.12);
        }
        .cbc-crop-tool i { font-size: 17px; }

        .cbc-crop-cta-group { display: flex; gap: 8px; align-items: center; }
        .cbc-crop-btn {
          height: 40px; padding: 0 20px; border-radius: 10px;
          font-size: 12.5px; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase; cursor: pointer; border: none;
          display: inline-flex; align-items: center; gap: 6px;
          transition: filter .15s ease, transform .15s ease, box-shadow .15s ease;
          font-family: inherit;
        }
        .cbc-crop-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .cbc-crop-btn:disabled { opacity: .5; cursor: not-allowed; }
        .cbc-crop-btn-ghost {
          background: transparent; color: rgba(255,255,255,0.70);
          padding: 0 14px;
        }
        .cbc-crop-btn-ghost:hover:not(:disabled) {
          color: #ffffff;
        }
        .cbc-crop-btn-primary {
          background: linear-gradient(135deg, #1d4fc4 0%, #3b82f6 100%);
          color: #fff;
          box-shadow: 0 6px 16px rgba(29,79,196,0.45);
        }
        .cbc-crop-btn-primary:hover:not(:disabled) {
          box-shadow: 0 10px 22px rgba(29,79,196,0.55);
          filter: brightness(1.08);
        }

        /* ── Mobile (<= 600px): bottom-sheet style ───────────────── */
        @media (max-width: 600px) {
          .cbc-crop-backdrop { align-items: flex-end; }
          .cbc-crop-shell {
            width: 100vw;
            max-height: 94vh;
            border-radius: 18px 18px 0 0;
            border-left: none; border-right: none; border-bottom: none;
            animation: cbcCropSlide .28s cubic-bezier(0.22,1,0.36,1) both;
          }
          .cbc-crop-shell::before {
            content: ''; display: block; width: 40px; height: 4px;
            background: rgba(255,255,255,0.25); border-radius: 999px;
            margin: 8px auto 0;
          }
          .cbc-crop-head     { padding: 12px 16px; }
          .cbc-crop-head-chip { width: 28px; height: 28px; }
          .cbc-crop-head-title { font-size: 14px; }
          .cbc-crop-stage    { height: 50vh; }
          .cbc-crop-controls { padding: 14px 16px calc(18px + env(safe-area-inset-bottom, 0px)); gap: 12px; }
          .cbc-crop-tool     { width: 42px; height: 42px; }
          .cbc-crop-tool i   { font-size: 19px; }
          .cbc-crop-btn      { height: 42px; padding: 0 18px; }
          .cbc-crop-cta-group { flex: 1; justify-content: flex-end; }
          .cbc-crop-btn-primary { flex: 1; justify-content: center; max-width: 200px; }
          .cbc-crop-slider::-webkit-slider-thumb { width: 22px; height: 22px; }
        }
      `}</style>

      <div className="cbc-crop-shell" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="cbc-crop-head">
          <div className="cbc-crop-head-title">
            <span className="cbc-crop-head-chip">
              <i className="ri-crop-2-line" style={{ fontSize: 15 }} />
            </span>
            {title}
          </div>
          <button
            type="button"
            className="cbc-crop-close"
            onClick={handleClose}
            aria-label="Close"
            disabled={saving}
          >
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </button>
        </div>

        {/* Crop stage */}
        <div className="cbc-crop-stage">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={aspect}
            cropShape={cropShape}
            showGrid={cropShape === 'rect'}
            minZoom={minZoom}
            maxZoom={maxZoom}
            zoomSpeed={0.5}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            objectFit="cover"
          />
        </div>

        {/* Controls */}
        <div className="cbc-crop-controls">
          {/* Zoom slider with mountain icons (matches the reference) */}
          <div className="cbc-crop-zoom-row">
            <span className="cbc-crop-zoom-ic" title="Zoom out">
              <i className="ri-image-line" style={{ fontSize: 17 }} />
            </span>
            <input
              className="cbc-crop-slider"
              type="range" min={minZoom} max={maxZoom} step={0.01}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              aria-label="Zoom"
              style={{
                ['--cbc-fill' as any]: `${((zoom - minZoom) / (maxZoom - minZoom)) * 100}%`,
              }}
            />
            <span className="cbc-crop-zoom-ic" title="Zoom in">
              <i className="ri-image-2-fill" style={{ fontSize: 20 }} />
            </span>
            <span className="cbc-crop-zoom-pill">{Math.round(zoom * 100)}%</span>
          </div>

          {/* Action row */}
          <div className="cbc-crop-action-row">
            <div className="cbc-crop-tool-group">
              <button
                type="button" className="cbc-crop-tool"
                onClick={() => setRotation(r => (r - 90 + 360) % 360)}
                aria-label="Rotate left" title="Rotate left"
              >
                <i className="ri-anticlockwise-line" />
              </button>
              <button
                type="button" className="cbc-crop-tool"
                onClick={() => setRotation(r => (r + 90) % 360)}
                aria-label="Rotate right" title="Rotate right"
              >
                <i className="ri-clockwise-line" />
              </button>
              <button
                type="button" className="cbc-crop-tool"
                onClick={() => { setZoom(minZoom); setRotation(0); setCrop({ x: 0, y: 0 }); }}
                aria-label="Reset" title="Reset"
              >
                <i className="ri-refresh-line" />
              </button>
            </div>
            <div className="cbc-crop-cta-group">
              <button
                className="cbc-crop-btn cbc-crop-btn-ghost"
                onClick={handleClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="cbc-crop-btn cbc-crop-btn-primary"
                onClick={handleConfirm}
                disabled={saving || !pixelCrop}
              >
                {saving ? (
                  <>
                    <i className="ri-loader-4-line" style={{ animation: 'cbcSpin 0.8s linear infinite' }} />
                    Saving
                  </>
                ) : (
                  <>
                    <i className="ri-check-line" style={{ fontSize: 16 }} />
                    Save Crop
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
