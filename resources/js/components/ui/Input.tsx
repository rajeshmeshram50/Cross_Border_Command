import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

export default function Input({ label, error, required, type, className = '', ...props }: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <div className="relative">
        <input
          type={inputType}
          className={`w-full px-3 py-2 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:shadow-sm placeholder:text-muted hover:border-border/80 ${isPassword ? 'pr-10' : ''} ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-100' : ''} ${className}`}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors focus:outline-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error && <span className="text-[10.5px] text-red-500 flex items-center gap-1 animate-in">{error}</span>}
    </div>
  );
}

export function Select({ label, required, children, className = '', ...props }: { label?: string; required?: boolean; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <select className={`px-3 py-2 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:shadow-sm hover:border-border/80 ${className}`} {...props}>
        {children}
      </select>
    </div>
  );
}

export function Textarea({ label, required, className = '', ...props }: { label?: string; required?: boolean } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <textarea className={`px-3 py-2 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all duration-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:shadow-sm placeholder:text-muted resize-vertical min-h-[80px] hover:border-border/80 ${className}`} {...props} />
    </div>
  );
}

export function FileUpload({ label, required, hint, accept, id, onChange }: { label?: string; required?: boolean; hint?: string; accept?: string; id?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <label className="flex flex-col items-center justify-center py-5 px-4 border-2 border-dashed border-border rounded-xl bg-surface-2 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all duration-200 text-center group">
        <svg className="w-7 h-7 text-muted mb-2 transition-transform duration-200 group-hover:scale-110 group-hover:text-primary" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
        <span className="text-[12px] font-semibold text-text">Click to upload</span>
        {hint && <span className="text-[10.5px] text-muted mt-0.5">{hint}</span>}
        <input type="file" className="hidden" accept={accept} id={id} onChange={onChange} />
      </label>
    </div>
  );
}
