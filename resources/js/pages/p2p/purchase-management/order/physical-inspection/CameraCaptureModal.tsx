// Live camera for inspection proof, the way ChatGPT's camera works: the device
// camera opens in the app, the inspector shoots one or more photos, checks them
// in the strip below and attaches them — they then go through the same upload
// as picked files. Uses the browser's own camera API (getUserMedia), so there
// is no library to load. A plain <input capture> only opens a camera on
// phones; on a desktop it just shows the file picker, which is what this fixes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './camera-capture.css';

type Props = {
  /** What the photos are for — the product name, or "Inspection note". */
  subject: string;
  /** Heading, for screens other than Physical Inspection. */
  title?: string;
  /** Start of each photo's file name — it ends up on the attachment chip. */
  namePrefix?: string;
  onAttach: (files: File[]) => void;
  onClose: () => void;
  /** Most photos one session may take. */
  max?: number;
};

type Shot = { file: File; url: string };
type Problem = { title: string; text: string; retry: boolean };

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_CAM = <svg {...ic} strokeWidth={2.2}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
const ICON_X = <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const ICON_FLIP = <svg {...ic} strokeWidth={2.2}><path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M9 13a3 3 0 0 1 5.2-2" /><polyline points="14.5 8.5 14.5 11 12 11" /><path d="M15 13a3 3 0 0 1-5.2 2" /><polyline points="9.5 17.5 9.5 15 12 15" /></svg>;
const ICON_OK = <svg {...ic} strokeWidth={2.8}><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_WARN = <svg {...ic} strokeWidth={2.2}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
const ICON_IMG = <svg {...ic} strokeWidth={2.2}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>;

/** Why the camera could not start, in words an inspector can act on. */
function explain(e: unknown): Problem {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { title: 'Camera access is blocked', text: 'Allow the camera from the camera icon in the address bar, then try again.', retry: true };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return { title: 'No camera found', text: 'This device has no camera the browser can use. Choose a photo from the device instead.', retry: false };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { title: 'The camera is busy', text: 'Another app (Zoom, Teams, …) is using the camera. Close it and try again.', retry: true };
  }
  return { title: 'Could not start the camera', text: 'Something stopped the camera from opening. Try again, or choose a photo from the device.', retry: true };
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export default function CameraCaptureModal({ subject, title = 'Take inspection photos', namePrefix = 'inspection', onAttach, onClose, max = 10 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const shotsRef = useRef<Shot[]>([]);
  const seq = useRef(0);

  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  // The camera asked for (null = the back camera if there is one) and the one running.
  const [wanted, setWanted] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  // A front / laptop camera is shown mirrored, like a mirror; the photo itself is not.
  const [mirror, setMirror] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [flash, setFlash] = useState(false);
  shotsRef.current = shots;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Start (or switch / retry) the camera.
  useEffect(() => {
    let alive = true;
    setLive(false);
    setProblem(null);
    stop();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setProblem({ title: 'Camera needs a secure connection', text: 'The browser only opens the camera over https. Choose a photo from the device instead.', retry: false });
      return;
    }
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: wanted ? { deviceId: { exact: wanted }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
    }).then(async (stream) => {
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
      setCurrent(settings.deviceId ?? '');
      setMirror(settings.facingMode !== 'environment');
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => undefined); }
      // Camera names are only readable once access is granted.
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      if (!alive) return;
      setCams(all.filter((d) => d.kind === 'videoinput'));
      setLive(true);
    }).catch((e) => { if (alive) setProblem(explain(e)); });
    return () => { alive = false; };
  }, [wanted, attempt, stop]);

  // Leaving: release the camera (its light goes off) and the photo previews.
  useEffect(() => () => {
    stop();
    shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
  }, [stop]);

  useEffect(() => { cardRef.current?.focus(); }, []);

  const full = shots.length >= max;

  const shoot = useCallback(() => {
    const v = videoRef.current;
    if (!live || !v || !v.videoWidth || shotsRef.current.length >= max) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const n = ++seq.current;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `${namePrefix}-${stamp()}-${n}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      setShots((list) => [...list, { file, url: URL.createObjectURL(blob) }]);
    }, 'image/jpeg', 0.9);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 160);
  }, [live, max]);

  const remove = (i: number) => setShots((list) => {
    URL.revokeObjectURL(list[i].url);
    return list.filter((_, ix) => ix !== i);
  });

  const nextCam = () => {
    if (cams.length < 2) return;
    const at = cams.findIndex((c) => c.deviceId === current);
    setWanted(cams[(at + 1) % cams.length].deviceId);
  };

  const attach = () => {
    if (!shots.length) return;
    onAttach(shots.map((s) => s.file));
    onClose();
  };

  // Space takes a photo, Esc closes. Stops here so the inspection behind stays open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); shoot(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, shoot]);

  const n = shots.length;

  return createPortal(
    <div className="spi-mdl-backdrop pins-layer cam-layer">
      <div className="cam-card" role="dialog" aria-modal="true" aria-labelledby="cam-title" tabIndex={-1} ref={cardRef}>
        <div className="cam-head">
          <span className="cam-head__ico">{ICON_CAM}</span>
          <div className="cam-head__txt">
            <div className="cam-head__t" id="cam-title">{title}</div>
            <div className="cam-head__s">{subject}</div>
          </div>
          <button type="button" className="cam-x" onClick={onClose} aria-label="Close camera">{ICON_X}</button>
        </div>

        <div className="cam-stage">
          <video ref={videoRef} className={`cam-video${mirror ? ' is-mirror' : ''}${live ? '' : ' is-off'}`} playsInline muted autoPlay />
          {!live && !problem && (
            <div className="cam-msg" role="status"><span className="cam-spin" />Starting camera…</div>
          )}
          {problem && (
            <div className="cam-msg cam-msg--err" role="alert">
              <span className="cam-msg__ico">{ICON_WARN}</span>
              <span className="cam-msg__t">{problem.title}</span>
              <span className="cam-msg__s">{problem.text}</span>
              <span className="cam-msg__acts">
                {problem.retry && <button type="button" className="cam-btn cam-btn--primary" onClick={() => setAttempt((a) => a + 1)}>Try again</button>}
                <button type="button" className="cam-btn" onClick={() => fileRef.current?.click()}>{ICON_IMG}Choose from device</button>
              </span>
            </div>
          )}
          {flash && <div className="cam-flash" />}
          {live && n > 0 && <span className="cam-count">{n} / {max}</span>}
        </div>

        {n > 0 && (
          <div className="cam-tray" aria-label="Photos taken">
            {shots.map((s, i) => (
              <div className="cam-thumb" key={s.url}>
                <img src={s.url} alt={`Photo ${i + 1}`} />
                <button type="button" className="cam-thumb__x" onClick={() => remove(i)} aria-label={`Remove photo ${i + 1}`}>{ICON_X}</button>
              </div>
            ))}
          </div>
        )}

        <div className="cam-bar">
          <div className="cam-bar__side">
            {cams.length > 1 && (
              <button type="button" className="cam-round" onClick={nextCam} disabled={!live} aria-label="Switch camera" title="Switch camera">{ICON_FLIP}</button>
            )}
          </div>
          <button type="button" className="cam-shutter" onClick={shoot} disabled={!live || full}
            aria-label="Take photo" title={full ? `Limit reached — ${max} photo${max === 1 ? '' : 's'} can be added here` : 'Take photo (Space)'}>
            <span />
          </button>
          <div className="cam-bar__side cam-bar__side--end">
            <button type="button" className="cam-attach" onClick={attach} disabled={!n}>
              {ICON_OK}<span>Attach{n ? ` ${n}` : ''}</span><span className="cam-attach__word">photo{n === 1 ? '' : 's'}</span>
            </button>
          </div>
        </div>

        {/* No usable camera: the device's own picker (on a phone it offers the camera app). */}
        <input ref={fileRef} className="cam-file-in" type="file" accept="image/*" capture="environment" multiple
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            if (picked.length) { onAttach(picked); onClose(); }
          }} />
      </div>
    </div>,
    document.body,
  );
}
