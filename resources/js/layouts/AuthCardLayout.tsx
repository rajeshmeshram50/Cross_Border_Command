import type { ReactNode } from 'react';
import { FaLinkedin, FaInstagram, FaFacebook } from 'react-icons/fa';
interface AuthCardLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
}

const socialLinks = [
  { icon: FaLinkedin, href: 'https://www.linkedin.com/company/inorbvict-agrotech-pvt-ltd', label: 'LinkedIn' },
  { icon: FaInstagram, href: 'https://www.instagram.com/inorbvict_agrotech/', label: 'Instagram' },
  { icon: FaFacebook, href: 'https://www.facebook.com/people/Inorbvict-Agrotech', label: 'Facebook' },
];

export default function AuthCardLayout({ children, title, subtitle, icon }: AuthCardLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 font-sans">
      {/* Background Layer */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-[10000ms] scale-105"
        style={{ backgroundImage: 'url(/images/loginbg.png)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/80 via-slate-950/40 to-transparent" />
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(245,158,11,0.12),transparent_40%)]" />

      {/* Main Content Container */}
      <div className="relative z-10 flex w-full h-full">
        {/* Left Side: Branding & Info */}
        <div className="flex-1 hidden lg:flex flex-col justify-between p-16 xl:p-24 text-white">
          <div className="max-w-xl animate-in fade-in slide-in-from-left duration-700">
            <div className="mb-1">
              <div className="inline-flex items-center gap-4">
                <div className="w-65 h-45">
                  <img src="/images/igc-logo.png" alt="IGC Group" className="w-full h-full object-contain" />
                </div>

              </div>
            </div>

            <h1 className="text-6xl xl:text-5xl font-black tracking-tight leading-[1.05] mb-8">
              Welcome to <br />
              <span className="gradient-text italic">Cross Border Command</span>
            </h1>

            <p className="text-xl text-white/70 font-medium leading-relaxed max-w-[32rem]">
              An intelligent platform connecting Operations, Procurement, Logistics, Finance, and Compliance in one unified ecosystem.
            </p>

            <div className="mt-12 flex items-center gap-8">
              {[
                { label: 'Latency', value: ' <14ms' },
                { label: 'Availability', value: '99.9%' },
                { label: 'Security', value: 'SOC-2' },
              ].map((item) => (
                <div key={item.label} className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-[0.2em] font-bold text-white/40">{item.label}</span>
                  <span className="text-lg font-bold text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center max-w-xl animate-in fade-in slide-in-from-left duration-1000">
            <div className="flex items-center gap-4">
              {socialLinks.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-12 h-12 rounded-full flex items-center justify-center border border-white/25 bg-white/10 text-white/60 hover:bg-white hover:text-primary hover:border-white hover:scale-110 transition-all duration-300"
                >
                  <Icon size={20} />
                </a>
              ))}
            </div>
          </div>

          <div className="text-sm font-medium text-white/50">© 2026 IGC Group. All rights reserved.</div>
        </div>

        {/* Right Side: Login Form Card */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 lg:bg-transparent opacity-95">
          <div className="w-full max-w-[480px] animate-in zoom-in-95 duration-500">
            <div className="bg-white/75 rounded-[32px] shadow-[0_30px_80px_rgba(0,0,0,0.35)] p-10 relative overflow-hidden">
              {/* Logo in Card */}
              <div className="flex justify-center mb-6">
                <img src="/images/igc-logo.png" alt="Logo" className="w-[120px] object-contain" />
              </div>

              {(title || subtitle) && (
                <div className="mb-10 text-center">
                  {title && (
                    <div className="flex items-center justify-center gap-2 mb-2">
                      {icon && <span className="text-primary">{icon}</span>}
                      <h2 className="text-[26px] font-bold gradient-text tracking-tight">{title}</h2>
                    </div>
                  )}
                  {subtitle && <p className="text-[13px] text-[#5e6b85] font-medium leading-tight">{subtitle}</p>}
                </div>
              )}

              {children}
            </div>

            <div className="mt-8 text-center text-white/50 text-[13px] font-medium lg:hidden">
              © 2026 IGC Group. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
