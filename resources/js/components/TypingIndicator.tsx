/*
 * Small "{name} is typing…" pill with three animated dots. Self-contained —
 * ships its own keyframes so it can drop into any modal/thread. Renders nothing
 * when `name` is falsy, so callers can pass the hook's `typingName` directly.
 */
export function TypingIndicator({ name, color = '#0891b2', align = 'left' }: { name: string | null; color?: string; align?: 'left' | 'right' }) {
  if (!name) return null;
  const dot = (delay: string) => ({
    width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block',
    animation: `cbcTypingBlink 1s ${delay} infinite ease-in-out`,
  } as const);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <style>{`@keyframes cbcTypingBlink { 0%,80%,100% { opacity:.25; transform:translateY(0); } 40% { opacity:1; transform:translateY(-2px); } }`}</style>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <span style={dot('0s')} /><span style={dot('.15s')} /><span style={dot('.3s')} />
      </span>
      <span style={{ fontSize: 9.5, fontWeight: 700, color, letterSpacing: '.01em' }}>{name} is typing…</span>
    </div>
  );
}
