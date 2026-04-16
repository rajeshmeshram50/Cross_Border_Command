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
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans relative">
      {/* Background Layer */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-[10000ms] scale-105 pointer-events-none"
        style={{ backgroundImage: 'url(/images/loginbg.png)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950/80 via-slate-950/40 to-transparent pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(245,158,11,0.15),transparent_40%)] pointer-events-none animate-pulse-ring" />

      {/* Main Content Container */}
      <div className="relative z-10 flex w-full h-full">
        {/* Left Side: Branding & Info */}
        <div className="flex-1 hidden lg:flex flex-col justify-between p-8 xl:p-12 text-white">
          <div className="max-w-xl animate-in fade-in slide-in-from-left duration-700">
            <div className="mb-2 animate-float">
              <div className="w-48 h-32 hover-lift transition-transform duration-500">
                <img src="/images/igc-logo.png" alt="IGC Group" className="w-full h-full object-contain object-left filter drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]" />
              </div>
            </div>

            <h1 className="text-4xl xl:text-5xl font-black tracking-tight leading-tight mb-4">
              Welcome to <br />
              <span className="gradient-text italic drop-shadow-[0_0_10px_rgba(109,99,244,0.3)]">Cross Border Command</span>
            </h1>

            <p className="text-base text-white/70 font-medium leading-relaxed max-w-md">
              An intelligent platform connecting Operations, Procurement, Logistics, Finance, and Compliance in one unified ecosystem.
            </p>

            <div className="mt-8 flex items-center gap-6">
              {[
                { label: 'Latency', value: '<14ms' },
                { label: 'Availability', value: '99.9%' },
                { label: 'Security', value: 'SOC-2' },
              ].map((item) => (
                <div key={item.label} className="flex flex-col hover-lift p-2 rounded-lg hover:bg-white/5 transition-all">
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/40">{item.label}</span>
                  <span className="text-sm font-bold text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {socialLinks.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded-full flex items-center justify-center border border-white/20 bg-white/5 text-white/50 hover:bg-white hover:text-primary hover:border-white hover-scale hover-lift transition-all duration-300"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
            <div className="text-[10px] font-medium text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors cursor-default">© 2026 IGC Group. All rights reserved.</div>
          </div>
        </div>

        {/* Right Side: Login Form Card */}
        <div className="flex-1 flex items-center justify-center p-4 lg:p-8">
          <div className="w-full max-w-[400px] animate-in zoom-in-95 duration-500">
            <div className="bg-white/75 backdrop-blur-xl rounded-[24px] shadow-[0_30px_60px_rgba(0,0,0,0.4)] p-6 sm:p-8 relative overflow-hidden border border-white/30 transition-all duration-700 ease-out hover:shadow-[0_45px_100px_rgba(90,81,232,0.25)] hover:scale-[1.01] hover:border-white/50 group/card">

              {/* Logo in Card */}
              <div className="flex justify-center mb-4">
                <img src="/images/igc-logo.png" alt="Logo" className="w-[80px] object-contain" />
              </div>

              {(title || subtitle) && (
                <div className="mb-6 text-center">
                  {title && (
                    <div className="flex items-center justify-center gap-2 mb-1">
                      {icon && <span className="text-primary">{icon}</span>}
                      <h2 className="text-[20px] font-bold gradient-text tracking-tight">{title}</h2>
                    </div>
                  )}
                  {subtitle && <p className="text-[11px] text-[#5e6b85] font-medium leading-tight">{subtitle}</p>}
                </div>
              )}

              {children}
            </div>

            <div className="mt-4 text-center text-white/40 text-[11px] font-medium lg:hidden">
              © 2026 IGC Group. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
