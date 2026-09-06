import React, { useState } from 'react';
import { useStore, canViewRecords, canViewActivityLog, canViewFuelMonitoring } from '../store';

type Page = 'home' | 'records' | 'log' | 'admin' | 'new-check' | 'analysis' | 'fuel-monitoring';

interface Props {
  currentPage: string;
  onNavigate: (page: Page) => void;
  isRealtimeConnected?: boolean;
}

export default function Header({ currentPage, onNavigate, isRealtimeConnected }: Props) {
  const currentAdmin = useStore((s) => s.currentAdmin);
  const settings = useStore((s) => s.settings);
  const [menuOpen, setMenuOpen] = useState(false);

  
  const canSeeRecords = canViewRecords(currentAdmin, settings.recordsVisibility);
  const canSeeLog     = canViewActivityLog(currentAdmin, settings.activityLogVisibility ?? 'all');
  const canSeeFuelMonitoring = canViewFuelMonitoring(currentAdmin, settings.fuelMonitoringVisibility ?? 'admin_only');

  function go(page: Page) {
    onNavigate(page);
    setMenuOpen(false);
  }

  const navItems: { key: Page; label: string }[] = [
    { key: 'home',      label: 'Home' },
    { key: 'new-check', label: 'New Check' },
    
    ...(canSeeRecords ? [{ key: 'records' as Page, label: 'Records' }] : []),
    { key: 'analysis',  label: 'Analysis' },
    ...(canSeeFuelMonitoring ? [{ key: 'fuel-monitoring' as Page, label: 'Fuel Monitoring' }] : []),
    ...(canSeeLog ? [{ key: 'log' as Page, label: 'Log' }] : []),
    { key: 'admin',     label: 'Admin' },
  ];

  const isActive = (key: Page) => {
    if (key === 'home') return currentPage === 'home';
    return currentPage === key;
  };

  const navLogo = settings.navLogoUrl;

  return (
    <header
      style={{
        background: '#FFFFFF',
        borderBottom: '0.5px solid rgba(0,0,0,0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {}
        <button
          onClick={() => go('home')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
            touchAction: 'manipulation',
          }}
        >
          {navLogo ? (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#DBEAFE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <img
                src={navLogo}
                alt="logo"
                style={{ width: 32, height: 32, objectFit: 'cover' }}
              />
            </div>
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
          )}
          <span
            className="logo-text"
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: '#1A1A18',
              display: 'none',
            }}
          >
            Daily Checking
          </span>
        </button>

        {}
        <nav className="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {navItems.map((item) => (
            <NavBtn key={item.key} active={isActive(item.key)} onClick={() => go(item.key)}>
              {item.label}
            </NavBtn>
          ))}
          {currentAdmin && (
            <AdminBadge role={currentAdmin.isSuperAdmin ? 'super' : currentAdmin.role} />
          )}
        </nav>

        {}
        <div className="mobile-nav-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {currentAdmin && (
            <AdminBadge role={currentAdmin.isSuperAdmin ? 'super' : currentAdmin.role} />
          )}
          <button
            className="hamburger-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: menuOpen ? '#EFF6FF' : 'none',
              border: '0.5px solid rgba(0,0,0,0.15)',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'background 0.15s',
              touchAction: 'manipulation',
              flexShrink: 0,
            }}
          >
            {menuOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A18" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A18" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {}
      {menuOpen && (
        <div
          style={{
            background: '#FFFFFF',
            borderTop: '0.5px solid rgba(0,0,0,0.10)',
            padding: '8px 16px 12px',
          }}
        >
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => go(item.key)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                border: 'none',
                background: isActive(item.key) ? '#EFF6FF' : 'none',
                color: isActive(item.key) ? '#1D4ED8' : '#1A1A18',
                fontSize: 14,
                fontWeight: isActive(item.key) ? 500 : 400,
                cursor: 'pointer',
                transition: 'background 0.15s',
                fontFamily: 'inherit',
                marginBottom: 2,
                touchAction: 'manipulation',
              }}
            >
              {item.label}
            </button>
          ))}
          {}
          <div
            style={{
              marginTop: 8,
              padding: '8px 12px',
              background: isRealtimeConnected ? '#F0FDF4' : '#FFFBEB',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isRealtimeConnected ? '#22C55E' : '#F59E0B',
                boxShadow: isRealtimeConnected
                  ? '0 0 0 2px rgba(34,197,94,0.25)'
                  : '0 0 0 2px rgba(245,158,11,0.20)',
                flexShrink: 0,
                transition: 'background 0.3s',
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: isRealtimeConnected ? '#166534' : '#92400E',
              }}
            >
              {isRealtimeConnected ? 'Live — synced across all devices' : 'Connecting to sync…'}
            </span>
          </div>
        </div>
      )}

      <style>{`
        /* Show logo text at 480px */
        @media(min-width: 480px) { .logo-text { display: block !important; } }

        /* Desktop nav: show at 600px, hide hamburger */
        @media(min-width: 600px) {
          .desktop-nav { display: flex !important; }
          .mobile-nav-right { display: none !important; }
        }
        /* Mobile: hide desktop nav, show hamburger */
        @media(max-width: 599px) {
          .desktop-nav { display: none !important; }
          .mobile-nav-right { display: flex !important; }
        }
      `}</style>
    </header>
  );
}

function AdminBadge({ role }: { role: 'super' | 'senior' | 'junior' }) {
  const label =
    role === 'super' ? 'Super Admin' : role === 'senior' ? 'Senior Admin' : 'Junior Admin';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        background: '#F0FDF4',
        color: '#166534',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          background: '#22C55E',
          borderRadius: '50%',
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        border: 'none',
        background: active ? '#EFF6FF' : 'transparent',
        color: active ? '#1D4ED8' : '#6B6963',
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        touchAction: 'manipulation',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#F1EFE8';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
