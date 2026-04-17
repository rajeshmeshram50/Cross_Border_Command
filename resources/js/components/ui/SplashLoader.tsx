import { useState, useEffect } from 'react';

export default function SplashLoader({ onComplete }: { onComplete?: () => void }) {
  const [phase, setPhase] = useState<'spinner' | 'logo' | 'done'>('spinner');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('logo'), 1200);
    const t2 = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-500 ${phase === 'done' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{ background: 'linear-gradient(135deg, #fafbfc 0%, #f0f2f5 50%, #e8ecf1 100%)' }}>

      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: `radial-gradient(circle at 1px 1px, #94a3b8 1px, transparent 0)`, backgroundSize: '32px 32px' }} />

      {/* Spinner */}
      <div className={`absolute transition-all duration-600 ease-out ${phase === 'spinner' ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}>
        <svg width="80" height="80" viewBox="0 0 80 80" style={{ animation: 'splash-rotate 1.2s linear infinite' }}>
          <circle cx="40" cy="40" r="32" fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
          <circle cx="40" cy="40" r="32" fill="none" stroke="url(#sg)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="60 141" />
          <defs>
            <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#C5A55A" />
              <stop offset="60%" stopColor="#E8662A" />
              <stop offset="100%" stopColor="#C0392B" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Logo */}
      <div className={`absolute flex flex-col items-center gap-4 transition-all duration-700 ${phase === 'logo' || phase === 'done' ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
        <img src="/images/igc-logo.png" alt="IGC" className="h-14 w-auto"
          style={{ animation: phase === 'logo' ? 'splash-logo-in 0.6s cubic-bezier(0.22,1,0.36,1) both' : undefined }} />
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#C5A55A]" style={{ animation: 'splash-dot 1s ease-in-out infinite' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#E8662A]" style={{ animation: 'splash-dot 1s ease-in-out 0.2s infinite' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[#C0392B]" style={{ animation: 'splash-dot 1s ease-in-out 0.4s infinite' }} />
        </div>
      </div>

      <style>{`
        @keyframes splash-rotate { to { transform: rotate(360deg); } }
        @keyframes splash-logo-in {
          0% { opacity: 0; transform: scale(0.5) translateY(8px); }
          60% { opacity: 1; transform: scale(1.04) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }
        @keyframes splash-dot {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
