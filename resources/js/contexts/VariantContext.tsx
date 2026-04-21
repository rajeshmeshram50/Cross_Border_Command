import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Variant =
  | 'cbc'
  | 'velzon-default'
  | 'velzon-corporate'
  | 'velzon-creative'
  | 'velzon-galaxy'
  | 'velzon-interactive'
  | 'velzon-master'
  | 'velzon-material'
  | 'velzon-minimal'
  | 'velzon-modern'
  | 'velzon-saas';

export interface VariantMeta {
  id: Variant;
  label: string;
  swatch: string;
}

export const VARIANTS: VariantMeta[] = [
  { id: 'cbc',                label: 'CBC (Default)',  swatch: '#5A51E8' },
  { id: 'velzon-default',     label: 'Velzon Default', swatch: '#405189' },
  { id: 'velzon-corporate',   label: 'Corporate',      swatch: '#687cfe' },
  { id: 'velzon-creative',    label: 'Creative',       swatch: '#3d78e3' },
  { id: 'velzon-galaxy',      label: 'Galaxy',         swatch: '#ad64f1' },
  { id: 'velzon-interactive', label: 'Interactive',    swatch: '#4f46bb' },
  { id: 'velzon-master',      label: 'Master',         swatch: '#4b38b3' },
  { id: 'velzon-material',    label: 'Material',       swatch: '#3577f1' },
  { id: 'velzon-minimal',     label: 'Minimal',        swatch: '#25a0e2' },
  { id: 'velzon-modern',      label: 'Modern',         swatch: '#5ea3cb' },
  { id: 'velzon-saas',        label: 'Saas',           swatch: '#6691e7' },
];

interface VariantCtx {
  variant: Variant;
  setVariant: (v: Variant) => void;
}

const Ctx = createContext<VariantCtx>({ variant: 'cbc', setVariant: () => {} });

export function VariantProvider({ children }: { children: ReactNode }) {
  const [variant, setVariantState] = useState<Variant>(() => {
    const stored = localStorage.getItem('cbc_variant') as Variant | null;
    return stored && VARIANTS.some(v => v.id === stored) ? stored : 'cbc';
  });

  useEffect(() => {
    if (variant === 'cbc') {
      document.documentElement.removeAttribute('data-variant');
    } else {
      document.documentElement.setAttribute('data-variant', variant);
    }
    localStorage.setItem('cbc_variant', variant);
  }, [variant]);

  return (
    <Ctx.Provider value={{ variant, setVariant: setVariantState }}>
      {children}
    </Ctx.Provider>
  );
}

export const useVariant = () => useContext(Ctx);
