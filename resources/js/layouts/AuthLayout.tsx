import type { ReactNode } from 'react';
import Logo from '../components/Logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Left - Form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
        <div className="w-full max-w-[440px]">
          {/* Logo — big and prominent on login */}
          <div className="mb-10">
            <Logo variant="auth" />
          </div>
          {children}
        </div>
      </div>

      {/* Right - Branding */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-[#2C29A8] via-primary to-purple-600 items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23fff' fill-opacity='.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6z'/%3E%3C/g%3E%3C/svg%3E")` }} />
        <div className="text-center text-white max-w-sm z-10">
          {/* Logo on right panel — large with glow */}
          <div className="mb-6">
            <Logo variant="authHero" />
          </div>
          <h2 className="text-[28px] font-extrabold tracking-tight mb-3">Multi-Tenant SaaS Platform</h2>
          <p className="text-[15px] opacity-80 leading-relaxed">Manage clients, branches, users, roles and permissions from a single powerful dashboard.</p>
          <div className="flex gap-3 justify-center mt-7">
            {[['150+', 'Clients'], ['4.2K', 'Users'], ['99.9%', 'Uptime']].map(([v, l]) => (
              <div key={l} className="bg-white/15 rounded-xl px-5 py-3 backdrop-blur-sm">
                <div className="text-xl font-extrabold">{v}</div>
                <div className="text-[11px] opacity-70">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
