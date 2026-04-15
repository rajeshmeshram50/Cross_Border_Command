import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

export default function Input({ label, error, required, className = '', ...props }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <input
        className={`px-3 py-2 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted ${error ? 'border-red-400' : ''} ${className}`}
        {...props}
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}

export function Select({ label, required, children, className = '', ...props }: { label?: string; required?: boolean; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <select className={`px-3 py-2 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 ${className}`} {...props}>
        {children}
      </select>
    </div>
  );
}

export function Textarea({ label, required, className = '', ...props }: { label?: string; required?: boolean } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <textarea className={`px-3 py-2 rounded-lg border-[1.5px] border-border bg-surface text-[12.5px] text-text outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted resize-vertical min-h-[80px] ${className}`} {...props} />
    </div>
  );
}

export function FileUpload({ label, required, hint, accept, id, onChange }: { label?: string; required?: boolean; hint?: string; accept?: string; id?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-[11.5px] font-semibold text-text">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>}
      <label className="flex flex-col items-center justify-center py-5 px-4 border-2 border-dashed border-border rounded-xl bg-surface-2 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all text-center">
        <svg className="w-7 h-7 text-muted mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
        <span className="text-[12px] font-semibold text-text">Click to upload</span>
        {hint && <span className="text-[10.5px] text-muted mt-0.5">{hint}</span>}
        <input type="file" className="hidden" accept={accept} id={id} onChange={onChange} />
      </label>
    </div>
  );
}
