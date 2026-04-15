const colors = [
  'from-indigo-500 to-violet-400',
  'from-emerald-500 to-teal-400',
  'from-sky-500 to-blue-400',
  'from-amber-500 to-yellow-400',
  'from-rose-500 to-pink-400',
];

export default function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' | 'lg' }) {
  const idx = initials.charCodeAt(0) % colors.length;
  const s = { sm: 'w-6 h-6 text-[9px]', md: 'w-8 h-8 text-[11px]', lg: 'w-10 h-10 text-sm' };
  return (
    <div className={`${s[size]} rounded-lg bg-gradient-to-br ${colors[idx]} flex items-center justify-center font-bold text-white flex-shrink-0 shadow-sm`}>
      {initials}
    </div>
  );
}
