import React, { useState, useRef } from 'react';
import {
  useStore,
  ChecklistItem,
  AdminRole,
  AdminUser,
  ActivityLog,
  FieldConfig,
  FieldType,
  EquipmentType,
  GLOBAL_EQUIPMENT_ID,
  resolveFieldConfigs,
  isSuperAdmin,
  canManageJuniors,
  canAccessAdminTab,
  RecordsVisibility,
  ActivityLogVisibility,
  FuelMonitoringVisibility,
  getMappedEquipmentTypeIds,
} from '../store';

import { formatDateTime } from '../pdfUtils';
import { fetchRemoteAdmins, startPresenceTracking, getActiveUsersByDay } from '../lib/sync';

function AdminHeader({
  currentAdmin,
  onLogout,
}: {
  currentAdmin: AdminUser;
  onLogout: () => void;
}) {
  const roleLabel = currentAdmin.isSuperAdmin
    ? 'Super Admin'
    : currentAdmin.role === 'senior'
    ? 'Senior Admin'
    : 'Junior Admin';

  const roleBg = currentAdmin.isSuperAdmin
    ? '#DBEAFE'
    : currentAdmin.role === 'senior'
    ? '#EDE9FE'
    : '#DCFCE7';

  const roleColor = currentAdmin.isSuperAdmin
    ? '#1E40AF'
    : currentAdmin.role === 'senior'
    ? '#5B21B6'
    : '#166534';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>Admin Panel</h2>
        <p style={{ fontSize: 12, color: '#9C9A92', marginTop: 2 }}>
          Signed in as{' '}
          <span style={{ color: '#1A1A18', fontWeight: 500 }}>{currentAdmin.email}</span>
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              background: roleBg,
              color: roleColor,
              padding: '2px 8px',
              borderRadius: 20,
              fontWeight: 500,
            }}
          >
            {roleLabel}
          </span>
        </p>
      </div>
      <button
        onClick={onLogout}
        style={{
          padding: '8px 14px',
          background: '#FEF2F2',
          color: '#DC2626',
          border: '0.5px solid #FECACA',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.15s',
          fontFamily: 'inherit',
          flexShrink: 0,
          touchAction: 'manipulation',
        }}
        onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.background = '#FEE2E2')}
        onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.background = '#FEF2F2')}
      >
        Sign Out
      </button>
    </div>
  );
}

function SetPasswordScreen({ pendingEmail }: { pendingEmail: string }) {
  const setAdminPassword = useStore((s) => s.setAdminPassword);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (pw !== pw2) {
      setError('Passwords do not match.');
      return;
    }
    const ok = await setAdminPassword(pendingEmail, pw);
    if (!ok) {
      setError('Unable to set password. Please contact the super administrator.');
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 16px' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: '#DCFCE7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Create Your Password</h2>
        <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 4 }}>
          Welcome! Your account has been registered.
        </p>
        <p
          style={{
            fontSize: 12,
            background: '#EFF6FF',
            color: '#1D4ED8',
            padding: '6px 14px',
            borderRadius: 20,
            display: 'inline-block',
            marginBottom: 24,
            fontFamily: 'monospace',
          }}
        >
          {pendingEmail}
        </p>

        {error && <div className="banner-error">{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left' }}>
          <div>
            <label className="form-label">
              New Password <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                className="form-input"
                placeholder="At least 6 characters"
                value={pw}
                onChange={(e) => { setPw(e.target.value); setError(''); }}
                autoComplete="new-password"
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#9C9A92', padding: 0,
                }}
                tabIndex={-1}
              >
                {showPw ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">
              Confirm Password <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type={showPw ? 'text' : 'password'}
              className="form-input"
              placeholder="Re-enter your password"
              value={pw2}
              onChange={(e) => { setPw2(e.target.value); setError(''); }}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 4 }}>
            Set Password &amp; Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

function LoginScreen() {
  const login           = useStore((s) => s.login);
  const getPendingAdmin = useStore((s) => s.getPendingAdmin);
  const mergeRemoteAdmins = useStore((s) => s.mergeRemoteAdmins);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  
  if (pendingEmail) {
    return <SetPasswordScreen pendingEmail={pendingEmail} />;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoggingIn(true);

    try {
      
      
      
      
      
      const remoteAdmins = await fetchRemoteAdmins();
      if (remoteAdmins && remoteAdmins.length > 0) {
        mergeRemoteAdmins(remoteAdmins);
      }

      
      
      
      const pending = getPendingAdmin(email.trim());
      if (pending) {
        setPendingEmail(pending.email);
        return;
      }

      
      const user = await login(email.trim(), password);
      if (!user) {
        setError('Invalid email or password.');
      }
    } catch (err) {
      console.error('[handleLogin] unexpected error:', err);
      setError('Login failed. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 16px' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: '#DBEAFE',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Admin Login</h2>
        <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 24 }}>
          Sign in to access the admin panel.
        </p>

        {error && <div className="banner-error">{error}</div>}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ textAlign: 'left' }}>
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              placeholder="admin@system.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              autoComplete="username"
            />
          </div>
          <div style={{ textAlign: 'left' }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              autoComplete="current-password"
            />
          </div>
          <p style={{ fontSize: 11, color: '#9C9A92', textAlign: 'left', marginTop: -8 }}>
            First time? Enter your registered email — you'll be prompted to create a password.
          </p>
          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', marginTop: 4, opacity: loggingIn ? 0.7 : 1 }}
            disabled={loggingIn}
          >
            {loggingIn ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ChecklistBuilder() {
  const equipmentTypes        = useStore((s) => s.equipmentTypes);
  const sections              = useStore((s) => s.sections);
  const checklistTemplates    = useStore((s) => s.checklistTemplates);
  const upsertChecklistTemplate = useStore((s) => s.upsertChecklistTemplate);
  const [selEquip, setSelEquip] = useState('');
  const [selSection, setSelSection] = useState('');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newSubheading, setNewSubheading] = useState('');
  const [saved, setSaved] = useState(false);
  const [addMode, setAddMode] = useState<'item' | 'subheading'>('item');

  function loadTemplate(equipId: string, secId: string) {
    const t = checklistTemplates.find(
      (t) => t.equipmentTypeId === equipId && t.sectionId === secId
    );
    setItems(t ? [...t.items].sort((a, b) => a.order - b.order) : []);
    setSaved(false);
  }

  function addItem() {
    if (!newLabel.trim()) return;
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: newLabel.trim(),
        order: prev.length,
        isSubheading: false,
      },
    ]);
    setNewLabel('');
    setSaved(false);
  }

  function addSubheading() {
    if (!newSubheading.trim()) return;
    setItems((prev) => [
      ...prev,
      {
        id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: newSubheading.trim(),
        order: prev.length,
        isSubheading: true,
      },
    ]);
    setNewSubheading('');
    setSaved(false);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i })));
    setSaved(false);
  }

  function updateLabel(id: string, label: string) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, label } : x)));
    setSaved(false);
  }

  function moveItem(id: string, dir: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr.map((x, i) => ({ ...x, order: i }));
    });
    setSaved(false);
  }

  function save() {
    if (!selEquip || !selSection) return;
    upsertChecklistTemplate(selEquip, selSection, items);
    setSaved(true);
  }

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Checklist Builder</h3>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="form-label">Equipment Type</label>
          <select
            className="form-input"
            value={selEquip}
            onChange={(e) => {
              setSelEquip(e.target.value);
              if (selSection) loadTemplate(e.target.value, selSection);
            }}
          >
            <option value="">Select...</option>
            {equipmentTypes.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.name} ({eq.code})
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="form-label">Section</label>
          <select
            className="form-input"
            value={selSection}
            onChange={(e) => {
              setSelSection(e.target.value);
              if (selEquip) loadTemplate(selEquip, e.target.value);
            }}
          >
            <option value="">Select...</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selEquip && selSection && (
        <>
          {saved && <div className="banner-success">Checklist template saved successfully!</div>}

          {/* ── Add Mode Toggle ── */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 10,
              background: '#F1EFE8',
              borderRadius: 10,
              padding: 4,
              width: 'fit-content',
            }}
          >
            <button
              onClick={() => setAddMode('item')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: addMode === 'item' ? '#FFFFFF' : 'transparent',
                color: addMode === 'item' ? '#1D4ED8' : '#6B6963',
                boxShadow: addMode === 'item' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              + Check Item
            </button>
            <button
              onClick={() => setAddMode('subheading')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: addMode === 'subheading' ? '#FFFFFF' : 'transparent',
                color: addMode === 'subheading' ? '#1D4ED8' : '#6B6963',
                boxShadow: addMode === 'subheading' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              + Subheading
            </button>
          </div>

          {/* ── Item input ── */}
          {addMode === 'item' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1 }}
                placeholder="New checklist item label..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
              />
              <button className="btn-add" onClick={addItem}>
                Add Item
              </button>
            </div>
          )}

          {/* ── Subheading input ── */}
          {addMode === 'subheading' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1 }}
                placeholder="Subheading text (e.g. ENGINE SYSTEM)..."
                value={newSubheading}
                onChange={(e) => setNewSubheading(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSubheading()}
              />
              <button
                onClick={addSubheading}
                style={{
                  padding: '0 16px',
                  background: '#1A1A18',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  height: 42,
                  fontFamily: 'inherit',
                }}
              >
                Add Heading
              </button>
            </div>
          )}

          {/* ── Hint for subheadings ── */}
          {addMode === 'subheading' && (
            <div
              style={{
                background: '#EFF6FF',
                color: '#1D4ED8',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 12,
                marginBottom: 16,
                border: '0.5px solid #BFDBFE',
              }}
            >
              <strong>Subheadings</strong> appear as bold section headers in the checklist — they are
              not checkable items. Use them to group related checks (e.g. "ENGINE SYSTEM",
              "HYDRAULICS").
            </div>
          )}

          {items.length === 0 ? (
            <div
              style={{
                background: '#F1EFE8',
                borderRadius: 12,
                padding: '20px',
                textAlign: 'center',
                fontSize: 13,
                color: '#9C9A92',
                marginBottom: 16,
              }}
            >
              No items yet. Add checklist items or subheadings above.
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {items.map((item, i) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: item.isSubheading ? '#DBEAFE' : '#F1EFE8',
                    borderRadius: 12,
                    padding: item.isSubheading ? '10px 12px' : '8px 12px',
                    marginBottom: 6,
                    border: item.isSubheading ? '0.5px solid #BFDBFE' : '0.5px solid rgba(0,0,0,0.08)',
                  }}
                >
                  {item.isSubheading ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <path d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                  ) : (
                    <span style={{ fontSize: 11, color: '#9C9A92', minWidth: 20 }}>{i + 1}.</span>
                  )}
                  <input
                    type="text"
                    className="form-input"
                    style={{
                      flex: 1,
                      background: '#FFFFFF',
                      fontWeight: item.isSubheading ? 500 : 400,
                      color: item.isSubheading ? '#1D4ED8' : '#1A1A18',
                    }}
                    value={item.label}
                    onChange={(e) => updateLabel(item.id, e.target.value)}
                  />
                  {item.isSubheading && (
                    <span
                      style={{
                        fontSize: 10,
                        background: '#EFF6FF',
                        color: '#1D4ED8',
                        padding: '2px 6px',
                        borderRadius: 20,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      heading
                    </span>
                  )}
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: '#6B6963', fontSize: 14 }}
                    onClick={() => moveItem(item.id, -1)}
                    disabled={i === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', color: '#6B6963', fontSize: 14 }}
                    onClick={() => moveItem(item.id, 1)}
                    disabled={i === items.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button className="btn-link-red" onClick={() => removeItem(item.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="btn-primary" onClick={save}>
            Save Checklist Template
          </button>
        </>
      )}
    </div>
  );
}

function StructureManager() {
  const {
    departments,
    addDepartment,
    renameDepartment,
    removeDepartment,
    moveDepartmentUp,
    moveDepartmentDown,
    sections,
    addSection,
    renameSection,
    removeSection,
    moveSectionUp,
    moveSectionDown,
    equipmentTypes,
    addEquipmentType,
    renameEquipmentType,
    removeEquipmentType,
    moveEquipmentTypeUp,
    moveEquipmentTypeDown,
    addLog,
  } = useStore();

  const [newDept, setNewDept] = useState('');
  const [newSectionDept, setNewSectionDept] = useState('');
  const [newSection, setNewSection] = useState('');
  const [newEquipName, setNewEquipName] = useState('');
  const [newEquipCode, setNewEquipCode] = useState('');

  const [editingDeptId,  setEditingDeptId]  = useState<string | null>(null);
  const [editingDeptVal, setEditingDeptVal] = useState('');
  const [editingSecId,   setEditingSecId]   = useState<string | null>(null);
  const [editingSecVal,  setEditingSecVal]  = useState('');
  const [editingEqId,    setEditingEqId]    = useState<string | null>(null);
  const [editingEqName,  setEditingEqName]  = useState('');
  const [editingEqCode,  setEditingEqCode]  = useState('');

  const sortedDepts  = [...departments].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const sortedEqTypes = [...equipmentTypes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  function handleAddDept() {
    if (!newDept.trim()) return;
    addDepartment(newDept.trim());
    addLog({ section: 'structure', type: 'department_added', description: `Department added: ${newDept.trim()}` });
    setNewDept('');
  }

  function startEditDept(id: string, name: string) {
    setEditingDeptId(id);
    setEditingDeptVal(name);

    setEditingSecId(null);
    setEditingEqId(null);
  }

  function confirmRenameDept(id: string) {
    if (!editingDeptVal.trim()) return;
    renameDepartment(id, editingDeptVal.trim());
    setEditingDeptId(null);
  }

  function cancelEditDept() {
    setEditingDeptId(null);
  }

  function handleRemoveDept(id: string, name: string) {
    if (!confirm(`Remove department "${name}"? This will also remove its sections.`)) return;
    removeDepartment(id);
    addLog({ section: 'structure', type: 'department_removed', description: `Department removed: ${name}` });
    if (editingDeptId === id) setEditingDeptId(null);
  }

  function handleAddSection() {
    if (!newSection.trim() || !newSectionDept) return;
    addSection(newSectionDept, newSection.trim());
    addLog({ section: 'structure', type: 'section_added', description: `Section added: ${newSection.trim()}` });
    setNewSection('');
  }

  function startEditSec(id: string, name: string) {
    setEditingSecId(id);
    setEditingSecVal(name);
    setEditingDeptId(null);
    setEditingEqId(null);
  }

  function confirmRenameSec(id: string) {
    if (!editingSecVal.trim()) return;
    renameSection(id, editingSecVal.trim());
    setEditingSecId(null);
  }

  function cancelEditSec() {
    setEditingSecId(null);
  }

  function handleRemoveSection(id: string, name: string) {
    if (!confirm(`Remove section "${name}"?`)) return;
    removeSection(id);
    addLog({ section: 'structure', type: 'section_removed', description: `Section removed: ${name}` });
    if (editingSecId === id) setEditingSecId(null);
  }

  function handleAddEquip() {
    if (!newEquipName.trim() || !newEquipCode.trim()) return;
    addEquipmentType(newEquipName.trim(), newEquipCode.trim());
    addLog({ section: 'structure', type: 'equipment_added', description: `Equipment type added: ${newEquipName.trim()} (${newEquipCode.trim().toUpperCase()})` });
    setNewEquipName('');
    setNewEquipCode('');
  }

  function startEditEq(id: string, name: string, code: string) {
    setEditingEqId(id);
    setEditingEqName(name);
    setEditingEqCode(code);
    setEditingDeptId(null);
    setEditingSecId(null);
  }

  function confirmRenameEq(id: string) {
    if (!editingEqName.trim() || !editingEqCode.trim()) return;
    renameEquipmentType(id, editingEqName.trim(), editingEqCode.trim());
    setEditingEqId(null);
  }

  function cancelEditEq() {
    setEditingEqId(null);
  }

  function handleRemoveEquip(id: string, name: string) {
    if (!confirm(`Remove equipment type "${name}"? This will also remove its checklist templates.`)) return;
    removeEquipmentType(id);
    addLog({ section: 'structure', type: 'equipment_removed', description: `Equipment type removed: ${name}` });
    if (editingEqId === id) setEditingEqId(null);
  }

  const editRowStyle: React.CSSProperties = {
    display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
  };
  const saveBtn: React.CSSProperties = {
    padding: '5px 12px', fontSize: 12, background: '#2563EB', color: '#fff',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  const cancelBtn: React.CSSProperties = {
    padding: '5px 10px', fontSize: 12, background: '#F1EFE8', color: '#1A1A18',
    border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div>

      {/* ─── Departments ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Departments</h3>

        {/* Add row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1 }}
            placeholder="Department name..."
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddDept()}
          />
          <button className="btn-add" onClick={handleAddDept}>Add</button>
        </div>

        {departments.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9C9A92' }}>No departments yet.</div>
        ) : (
          sortedDepts.map((d, idx) => (
            <div key={d.id} className="list-row" style={{ alignItems: 'center' }}>
              {editingDeptId === d.id ? (

                <div style={editRowStyle}>
                  <input
                    autoFocus
                    type="text"
                    className="form-input"
                    style={{ flex: 1, minWidth: 160, fontSize: 13 }}
                    value={editingDeptVal}
                    onChange={(e) => setEditingDeptVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')  confirmRenameDept(d.id);
                      if (e.key === 'Escape') cancelEditDept();
                    }}
                  />
                  <button style={saveBtn}   onClick={() => confirmRenameDept(d.id)}>Save</button>
                  <button style={cancelBtn} onClick={cancelEditDept}>Cancel</button>
                </div>
              ) : (

                <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
              )}
              {editingDeptId !== d.id && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    title="Move up"
                    disabled={idx === 0}
                    onClick={() => moveDepartmentUp(d.id)}
                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: 14, padding: '2px 4px' }}
                  >▲</button>
                  <button
                    title="Move down"
                    disabled={idx === sortedDepts.length - 1}
                    onClick={() => moveDepartmentDown(d.id)}
                    style={{ background: 'none', border: 'none', cursor: idx === sortedDepts.length - 1 ? 'default' : 'pointer', opacity: idx === sortedDepts.length - 1 ? 0.3 : 1, fontSize: 14, padding: '2px 4px' }}
                  >▼</button>
                  <button
                    className="btn-link-blue"
                    onClick={() => startEditDept(d.id, d.name)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-link-red"
                    onClick={() => handleRemoveDept(d.id, d.name)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ─── Sections ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Sections</h3>

        {/* Add row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <select
            className="form-input"
            style={{ flex: 1, minWidth: 160 }}
            value={newSectionDept}
            onChange={(e) => setNewSectionDept(e.target.value)}
          >
            <option value="">Select department...</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: 160 }}
            placeholder="Section name..."
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSection()}
          />
          <button className="btn-add" onClick={handleAddSection}>Add</button>
        </div>

        {sections.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9C9A92' }}>No sections yet.</div>
        ) : (
          (() => {

            const sortedSections = [...sections].sort((a, b) => {
              const deptA = departments.find((d) => d.id === a.departmentId);
              const deptB = departments.find((d) => d.id === b.departmentId);
              const deptPosDiff = (deptA?.position ?? 0) - (deptB?.position ?? 0);
              if (deptPosDiff !== 0) return deptPosDiff;
              return (a.position ?? 0) - (b.position ?? 0);
            });
            return sortedSections.map((sec) => {
              const dept = departments.find((d) => d.id === sec.departmentId);
              const siblingsInDept = sortedSections.filter((s) => s.departmentId === sec.departmentId);
              const idxInDept = siblingsInDept.findIndex((s) => s.id === sec.id);
              return (
                <div key={sec.id} className="list-row" style={{ alignItems: 'center' }}>
                  {editingSecId === sec.id ? (

                    <div style={editRowStyle}>
                      <input
                        autoFocus
                        type="text"
                        className="form-input"
                        style={{ flex: 1, minWidth: 160, fontSize: 13 }}
                        value={editingSecVal}
                        onChange={(e) => setEditingSecVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')  confirmRenameSec(sec.id);
                          if (e.key === 'Escape') cancelEditSec();
                        }}
                      />
                      <button style={saveBtn}   onClick={() => confirmRenameSec(sec.id)}>Save</button>
                      <button style={cancelBtn} onClick={cancelEditSec}>Cancel</button>
                    </div>
                  ) : (

                    <span style={{ flex: 1, fontSize: 13 }}>
                      {sec.name}
                      <span style={{ fontSize: 11, color: '#9C9A92', marginLeft: 8 }}>
                        {dept?.name}
                      </span>
                    </span>
                  )}
                  {editingSecId !== sec.id && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        title="Move up within department"
                        disabled={idxInDept === 0}
                        onClick={() => moveSectionUp(sec.id)}
                        style={{ background: 'none', border: 'none', cursor: idxInDept === 0 ? 'default' : 'pointer', opacity: idxInDept === 0 ? 0.3 : 1, fontSize: 14, padding: '2px 4px' }}
                      >▲</button>
                      <button
                        title="Move down within department"
                        disabled={idxInDept === siblingsInDept.length - 1}
                        onClick={() => moveSectionDown(sec.id)}
                        style={{ background: 'none', border: 'none', cursor: idxInDept === siblingsInDept.length - 1 ? 'default' : 'pointer', opacity: idxInDept === siblingsInDept.length - 1 ? 0.3 : 1, fontSize: 14, padding: '2px 4px' }}
                      >▼</button>
                      <button
                        className="btn-link-blue"
                        onClick={() => startEditSec(sec.id, sec.name)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn-link-red"
                        onClick={() => handleRemoveSection(sec.id, sec.name)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            });
          })()
        )}
      </div>

      {/* ─── Equipment Types ─────────────────────────────────────────── */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Equipment Types</h3>

        {/* Add row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 2, minWidth: 140 }}
            placeholder="Equipment name (e.g. Reach Stacker)..."
            value={newEquipName}
            onChange={(e) => setNewEquipName(e.target.value)}
          />
          <input
            type="text"
            className="form-input"
            style={{ flex: 0, width: 80 }}
            placeholder="Code (RS)"
            value={newEquipCode}
            onChange={(e) => setNewEquipCode(e.target.value.toUpperCase())}
            maxLength={4}
          />
          <button className="btn-add" onClick={handleAddEquip}>Add</button>
        </div>

        {equipmentTypes.length === 0 ? (
          <div style={{ fontSize: 13, color: '#9C9A92' }}>No equipment types yet.</div>
        ) : (
          sortedEqTypes.map((eq, idx) => (
            <div key={eq.id} className="list-row" style={{ alignItems: 'center' }}>
              {editingEqId === eq.id ? (

                <div style={editRowStyle}>
                  <input
                    autoFocus
                    type="text"
                    className="form-input"
                    style={{ flex: 2, minWidth: 140, fontSize: 13 }}
                    placeholder="Equipment name..."
                    value={editingEqName}
                    onChange={(e) => setEditingEqName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')  confirmRenameEq(eq.id);
                      if (e.key === 'Escape') cancelEditEq();
                    }}
                  />
                  <input
                    type="text"
                    className="form-input"
                    style={{ width: 72, fontSize: 13 }}
                    placeholder="Code"
                    value={editingEqCode}
                    maxLength={4}
                    onChange={(e) => setEditingEqCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')  confirmRenameEq(eq.id);
                      if (e.key === 'Escape') cancelEditEq();
                    }}
                  />
                  <button style={saveBtn}   onClick={() => confirmRenameEq(eq.id)}>Save</button>
                  <button style={cancelBtn} onClick={cancelEditEq}>Cancel</button>
                </div>
              ) : (

                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span className="pill pill-blue">{eq.code}</span>
                  {eq.name}
                </span>
              )}
              {editingEqId !== eq.id && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    title="Move up"
                    disabled={idx === 0}
                    onClick={() => moveEquipmentTypeUp(eq.id)}
                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, fontSize: 14, padding: '2px 4px' }}
                  >▲</button>
                  <button
                    title="Move down"
                    disabled={idx === sortedEqTypes.length - 1}
                    onClick={() => moveEquipmentTypeDown(eq.id)}
                    style={{ background: 'none', border: 'none', cursor: idx === sortedEqTypes.length - 1 ? 'default' : 'pointer', opacity: idx === sortedEqTypes.length - 1 ? 0.3 : 1, fontSize: 14, padding: '2px 4px' }}
                  >▼</button>
                  <button
                    className="btn-link-blue"
                    onClick={() => startEditEq(eq.id, eq.name, eq.code)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-link-red"
                    onClick={() => handleRemoveEquip(eq.id, eq.name)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AdminUsersManager() {
  const {
    adminUsers,
    currentAdmin,
    registerAdmin,
    addJuniorAdmin,
    updateAdminRole,
    removeAdmin,
  } = useStore();

  const currentIsSuperAdmin = isSuperAdmin(currentAdmin);
  const currentCanManageJuniors = canManageJuniors(currentAdmin);

  type SubTab = 'list' | 'register' | 'passwords';
  const [subTab, setSubTab] = useState<SubTab>('list');

  const [regEmail, setRegEmail] = useState('');
  const [regRole, setRegRole] = useState<AdminRole>('junior');
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<AdminRole>('junior');

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'list', label: 'Accounts' },
    { key: 'register', label: currentIsSuperAdmin ? 'Register Admin' : 'Register Junior' },
    ...(currentIsSuperAdmin ? [{ key: 'passwords' as SubTab, label: 'Reset PWs' }] : []),
  ];

  function rolePillFor(u: AdminUser) {
    if (u.isSuperAdmin) return { bg: '#DBEAFE', color: '#1E40AF', label: 'Super Admin' };
    if (u.role === 'senior') return { bg: '#EDE9FE', color: '#5B21B6', label: 'Senior Admin' };
    return { bg: '#DCFCE7', color: '#166534', label: 'Junior Admin' };
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError('');
    setRegSuccess('');

    const emailTrimmed = regEmail.trim();
    if (!emailTrimmed) {
      setRegError('Email is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setRegError('Please enter a valid email address.');
      return;
    }

    // NOTE: addJuniorAdmin is async — it must be awaited, otherwise `ok` would
    // be a (always-truthy) Promise object and a failed/duplicate registration
    // would incorrectly show as a success.
    let ok: boolean;
    if (currentIsSuperAdmin) {
      ok = registerAdmin(emailTrimmed, regRole);
    } else {

      ok = await addJuniorAdmin(emailTrimmed, '');
    }

    if (ok) {
      setRegSuccess(
        `${currentIsSuperAdmin && regRole === 'senior' ? 'Senior' : 'Junior'} Admin registered. They can now sign in to set their password.`
      );
      setRegEmail('');
      setRegRole('junior');
    } else {
      setRegError('An account with this email already exists.');
    }
  }

  function startEdit(u: AdminUser) {
    setEditId(u.id);
    setEditRole(u.role);
  }

  function saveEdit() {
    if (!editId) return;
    updateAdminRole(editId, editRole);
    setEditId(null);
  }

  function canRemove(u: AdminUser) {
    if (u.isSuperAdmin) return false;
    if (currentIsSuperAdmin) return true;
    if (currentCanManageJuniors && u.role === 'junior') return true;
    return false;
  }

  function canEdit(u: AdminUser) {
    return !u.isSuperAdmin && currentIsSuperAdmin;
  }

  const visibleUsers = currentIsSuperAdmin
    ? adminUsers
    : adminUsers.filter((u) => !u.isSuperAdmin && u.role === 'junior');

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>Admin Accounts</h3>

      {/* Sub-tab bar */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {subTabs.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${subTab === t.key ? 'active' : ''}`}
            onClick={() => { setSubTab(t.key); setRegError(''); setRegSuccess(''); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LIST ── */}
      {subTab === 'list' && (
        <div>
          {visibleUsers.length === 0 ? (
            <div style={{ fontSize: 13, color: '#9C9A92', textAlign: 'center', padding: '20px 0' }}>
              No admin accounts yet.
            </div>
          ) : (
            visibleUsers.map((u) => {
              const pill = rolePillFor(u);
              return (
                <div
                  key={u.id}
                  style={{
                    background: u.isSuperAdmin ? '#EFF6FF' : '#F1EFE8',
                    borderRadius: 12,
                    padding: '12px 14px',
                    marginBottom: 8,
                  }}
                >
                  {editId === u.id ? (
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{u.email}</p>
                      <div style={{ marginBottom: 10 }}>
                        <label className="form-label">Role</label>
                        <select
                          className="form-input"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as AdminRole)}
                        >
                          <option value="junior">Junior Admin</option>
                          <option value="senior">Senior Admin</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn-primary" style={{ flex: 1, padding: '8px' }} onClick={saveEdit}>Save</button>
                        <button className="btn-secondary" style={{ flex: 1, padding: '8px' }} onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{u.email}</span>
                          <span style={{ fontSize: 11, background: pill.bg, color: pill.color, padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
                            {pill.label}
                          </span>
                          {!u.passwordSet && (
                            <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
                              Pending Password
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 11, color: '#9C9A92' }}>Registered {formatDateTime(u.createdAt)}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {canEdit(u) && (
                          <button className="btn-link-blue" onClick={() => startEdit(u)}>Edit Role</button>
                        )}
                        {canRemove(u) && (
                          <button
                            className="btn-link-red"
                            onClick={() => {
                              if (confirm(`Remove admin ${u.email}?`)) removeAdmin(u.id);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── REGISTER ── */}
      {subTab === 'register' && currentCanManageJuniors && (
        <div>
          {/* Info box explaining the flow */}
          <div
            style={{
              background: '#EFF6FF',
              color: '#1D4ED8',
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 20,
              fontSize: 12,
              border: '0.5px solid #BFDBFE',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }}>
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            Register an admin by email. They will be prompted to create their own password on first sign-in.
          </div>

          {regError && <div className="banner-error">{regError}</div>}
          {regSuccess && <div className="banner-success">{regSuccess}</div>}

          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label className="form-label">
                Email Address <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                type="email"
                className="form-input"
                value={regEmail}
                onChange={(e) => { setRegEmail(e.target.value); setRegError(''); setRegSuccess(''); }}
                placeholder="newadmin@company.com"
                autoComplete="off"
              />
            </div>

            {/* Role selector — super admin only; senior admin always creates junior */}
            {currentIsSuperAdmin && (
              <div>
                <label className="form-label">Role</label>
                <select
                  className="form-input"
                  value={regRole}
                  onChange={(e) => setRegRole(e.target.value as AdminRole)}
                >
                  <option value="junior">Junior Admin</option>
                  <option value="senior">Senior Admin</option>
                </select>
              </div>
            )}

            <button type="submit" className="btn-primary">
              Register Admin
            </button>
          </form>
        </div>
      )}

      {/* ── RESET PASSWORDS (Super Admin only) ── */}
      {subTab === 'passwords' && currentIsSuperAdmin && (
        <div>
          <div
            style={{
              background: '#DBEAFE',
              color: '#1E40AF',
              borderRadius: 12,
              padding: '10px 14px',
              fontSize: 12,
              marginBottom: 16,
              border: '0.5px solid #BFDBFE',
            }}
          >
            <strong>🔒 Passwords are hashed.</strong> Individual passwords cannot be viewed — this is by design.
            As Super Admin you can <strong>force-reset</strong> any sub-admin's password here. They will need
            to sign in with the new temporary password and can change it afterwards.
          </div>

          {adminUsers.filter((u) => !u.isSuperAdmin).length === 0 ? (
            <div style={{ fontSize: 13, color: '#9C9A92', textAlign: 'center', padding: '20px 0' }}>
              No sub-admin accounts registered yet.
            </div>
          ) : (
            adminUsers
              .filter((u) => !u.isSuperAdmin)
              .map((u) => {
                const pill = rolePillFor(u);
                return (
                  <AdminResetPasswordRow key={u.id} user={u} pill={pill} />
                );
              })
          )}
        </div>
      )}
    </div>
  );
}

function AdminResetPasswordRow({
  user,
  pill,
}: {
  user: import('../store').AdminUser;
  pill: { bg: string; color: string; label: string };
}) {
  const [open, setOpen] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (newPw.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    if (newPw !== confPw) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      
      
      
      const store = useStore.getState();
      
      useStore.setState((s) => ({
        adminUsers: s.adminUsers.map((u) =>
          u.id === user.id ? { ...u, passwordSet: false } : u
        ),
      }));
      const result = await store.setAdminPassword(user.email, newPw);
      if (result) {
        setOk(true);
        setOpen(false);
        setNewPw('');
        setConfPw('');
        setTimeout(() => setOk(false), 3000);
      } else {
        setErr('Reset failed. Please try again.');
        
        useStore.setState((s) => ({
          adminUsers: s.adminUsers.map((u) =>
            u.id === user.id ? { ...u, passwordSet: true } : u
          ),
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        background: '#F1EFE8',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{user.email}</span>
            <span style={{ fontSize: 11, background: pill.bg, color: pill.color, padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
              {pill.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#9C9A92' }}>Password:</span>
            <span style={{ fontSize: 11, color: '#6B6963', fontFamily: 'monospace' }}>
              {user.passwordSet ? '••••••••  (hashed)' : '⚠ Not yet set'}
            </span>
            {ok && <span style={{ fontSize: 11, color: '#166534' }}>✅ Reset!</span>}
          </div>
        </div>
        <button
          onClick={() => { setOpen((v) => !v); setErr(''); }}
          style={{ fontSize: 12, padding: '5px 12px', background: open ? '#E5E7EB' : '#2563EB', color: open ? '#374151' : '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {open ? 'Cancel' : 'Reset Password'}
        </button>
      </div>

      {open && (
        <form onSubmit={handleReset} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="password"
            placeholder="New password (min 6 chars)"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="form-input"
            style={{ fontSize: 13 }}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confPw}
            onChange={(e) => setConfPw(e.target.value)}
            className="form-input"
            style={{ fontSize: 13 }}
            autoComplete="new-password"
          />
          {err && <p style={{ fontSize: 12, color: '#EF4444' }}>{err}</p>}
          <button
            type="submit"
            disabled={busy}
            style={{ fontSize: 13, padding: '7px 14px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Resetting…' : 'Confirm Reset'}
          </button>
        </form>
      )}
    </div>
  );
}

function FieldConfigManager() {
  const fieldConfigs        = useStore((s) => s.fieldConfigs);
  const equipmentTypes      = useStore((s) => s.equipmentTypes);
  const upsertFieldConfig   = useStore((s) => s.upsertFieldConfig);
  const removeFieldConfig   = useStore((s) => s.removeFieldConfig);
  const reorderFieldConfigs = useStore((s) => s.reorderFieldConfigs);
  const currentAdmin        = useStore((s) => s.currentAdmin);

  // Only super admins may delete fields (built-in or custom)
  const canDelete = isSuperAdmin(currentAdmin);

  
  
  
  const [scopeId, setScopeId] = useState<string>(GLOBAL_EQUIPMENT_ID);

  
  
  const resolvedForScope = resolveFieldConfigs(fieldConfigs, scopeId);

  
  

  
  const [newLabel, setNewLabel] = useState('');
  const [newType,  setNewType]  = useState<FieldType>('text');
  const [newRequired, setNewRequired] = useState(false);

  
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editLabel,    setEditLabel]    = useState('');
  const [editType,     setEditType]     = useState<FieldType>('text');
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions,  setEditOptions]  = useState<string[]>([]);
  const [newOption,    setNewOption]    = useState('');

  
  function startEdit(cfg: FieldConfig) {
    
    
    const scopedVersion = fieldConfigs.find(
      (f) => f.key === cfg.key && f.equipmentTypeId === scopeId
    );
    const toEdit = scopedVersion ?? { ...cfg, equipmentTypeId: scopeId };
    setEditingId(toEdit.id === cfg.id && scopedVersion ? toEdit.id : cfg.id);
    setEditLabel(cfg.label);
    setEditType(cfg.fieldType);
    setEditRequired(cfg.required);
    setEditOptions([...cfg.options]);
    setNewOption('');
  }

  function saveEdit(cfg: FieldConfig) {
    
    
    const isEditingGlobal = cfg.equipmentTypeId === GLOBAL_EQUIPMENT_ID;
    const hasScope        = scopeId !== GLOBAL_EQUIPMENT_ID;

    if (isEditingGlobal && hasScope) {
      
      const overrideId = `${cfg.key}--${scopeId}`;
      upsertFieldConfig({
        id:              overrideId,
        key:             cfg.key,
        label:           editLabel.trim() || cfg.label,
        fieldType:       editType,
        required:        editRequired,
        order:           cfg.order,
        options:         editOptions,
        isBuiltIn:       false,   
        equipmentTypeId: scopeId,
      });
    } else {
      
      upsertFieldConfig({
        ...cfg,
        label:     editLabel.trim() || cfg.label,
        fieldType: editType,
        required:  editRequired,
        options:   editOptions,
      });
    }
    setEditingId(null);
  }

  function addOption() {
    const trimmed = newOption.trim();
    if (!trimmed || editOptions.includes(trimmed)) return;
    setEditOptions((prev) => [...prev, trimmed]);
    setNewOption('');
  }

  function removeOption(opt: string) {
    setEditOptions((prev) => prev.filter((o) => o !== opt));
  }

  function handleAddField() {
    if (!newLabel.trim()) return;
    const key      = 'custom_' + Date.now().toString(36);
    const maxOrder = resolvedForScope.reduce((m, f) => Math.max(m, f.order), -1);
    upsertFieldConfig({
      id:              key,
      key,
      label:           newLabel.trim(),
      fieldType:       newType,
      required:        newRequired,
      order:           maxOrder + 1,
      options:         [],
      isBuiltIn:       false,
      equipmentTypeId: scopeId,  
    });
    setNewLabel('');
    setNewType('text');
    setNewRequired(false);
  }

  function handleRemove(cfg: FieldConfig) {
    // Defence-in-depth: block non-super-admins even if button somehow appears
    if (!canDelete) return;
    const builtInWarning = cfg.isBuiltIn
      ? '\n\n\u26a0\ufe0f This is a built-in field. Deleting it will remove it from ALL checklists permanently.'
      : '';
    if (!confirm(`Remove field "${cfg.label}"?${builtInWarning}`)) return;
    const scopedOverride = fieldConfigs.find(
      (f) => f.key === cfg.key && f.equipmentTypeId === scopeId && scopeId !== GLOBAL_EQUIPMENT_ID
    );
    if (scopedOverride) {
      removeFieldConfig(scopedOverride.id, scopedOverride.isBuiltIn);
    } else {
      removeFieldConfig(cfg.id, cfg.isBuiltIn);
    }
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const ids = resolvedForScope.map((f) => {
      
      const scoped = fieldConfigs.find(
        (fc) => fc.key === f.key && fc.equipmentTypeId === scopeId
      );
      return scoped?.id ?? f.id;
    });
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    reorderFieldConfigs(ids, scopeId);
  }

  function moveDown(idx: number) {
    if (idx === resolvedForScope.length - 1) return;
    const ids = resolvedForScope.map((f) => {
      const scoped = fieldConfigs.find(
        (fc) => fc.key === f.key && fc.equipmentTypeId === scopeId
      );
      return scoped?.id ?? f.id;
    });
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    reorderFieldConfigs(ids, scopeId);
  }

  
  const typePill: Record<FieldType, { label: string; bg: string; color: string }> = {
    text:         { label: 'Text',     bg: '#DCFCE7', color: '#166534' },
    numeric:      { label: 'Numeric',  bg: '#DBEAFE', color: '#1E40AF' },
    dropdown:     { label: 'Dropdown', bg: '#EDE9FE', color: '#5B21B6' },
    fuel_percent: { label: 'Fuel %',   bg: '#FEF3C7', color: '#92400E' },
  };

  const scopeName = scopeId === GLOBAL_EQUIPMENT_ID
    ? 'All Equipment (Global)'
    : (equipmentTypes.find((eq: EquipmentType) => eq.id === scopeId)?.name ?? scopeId);

  
  const hasOverrides = scopeId !== GLOBAL_EQUIPMENT_ID &&
    fieldConfigs.some((f) => f.equipmentTypeId === scopeId);

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Form Field Configuration</h3>
      <p style={{ fontSize: 12, color: '#9C9A92', marginBottom: 8 }}>
        Configure the fields shown in the Basic Details step. Set <strong>Global</strong> fields
        that apply to every equipment type, or select a specific equipment type to create
        overrides — each equipment type can have its own field types and dropdown options.
      </p>


      {}
      <div style={{
        background: '#F1EFE8', borderRadius: 12, padding: '12px 14px',
        marginBottom: 16, border: '0.5px solid rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: '#6B6963', flexShrink: 0 }}>
          Configuring fields for:
        </label>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 180, fontSize: 13 }}
          value={scopeId}
          onChange={(e) => { setScopeId(e.target.value); setEditingId(null); }}
        >
          <option value={GLOBAL_EQUIPMENT_ID}>🌐 All Equipment (Global defaults)</option>
          {equipmentTypes.map((eq: EquipmentType) => (
            <option key={eq.id} value={eq.id}>
              [{eq.code}] {eq.name}
            </option>
          ))}
        </select>
        {hasOverrides && (
          <span style={{
            fontSize: 10, background: '#DBEAFE', color: '#1E40AF',
            padding: '2px 8px', borderRadius: 20, fontWeight: 500, flexShrink: 0,
          }}>
            Has overrides
          </span>
        )}
      </div>

      {}
      {scopeId !== GLOBAL_EQUIPMENT_ID && (
        <div style={{
          fontSize: 12, color: '#6B6963', background: '#EFF6FF',
          borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          border: '0.5px solid #BFDBFE',
        }}>
          <strong>Tip:</strong> Editing a global built-in field here creates a
          <strong> {scopeName}-specific override</strong>. The global field is preserved
          for all other equipment types. Custom fields added here only appear for{' '}
          <strong>{scopeName}</strong>.
        </div>
      )}

      {}
      {resolvedForScope.map((cfg, idx) => {
        
        const isOverridden = scopeId !== GLOBAL_EQUIPMENT_ID &&
          fieldConfigs.some((f) => f.key === cfg.key && f.equipmentTypeId === scopeId);
        const isGlobalField = cfg.equipmentTypeId === GLOBAL_EQUIPMENT_ID;

        return (
          <div
            key={cfg.id}
            style={{
              background: isOverridden ? '#EFF6FF' : cfg.isBuiltIn ? '#F1EFE8' : '#F0FDF4',
              borderRadius: 12, padding: '12px 14px', marginBottom: 8,
              border: `0.5px solid ${isOverridden ? '#BFDBFE' : 'rgba(0,0,0,0.08)'}`,
            }}
          >
            {editingId === cfg.id ? (
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    autoFocus
                    type="text"
                    className="form-input"
                    style={{ flex: 1, minWidth: 140, fontSize: 13 }}
                    value={editLabel}
                    placeholder="Field label"
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                  />
                  <select
                    className="form-input"
                    style={{ width: 120, fontSize: 13 }}
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as FieldType)}
                  >
                    <option value="text">Text</option>
                    <option value="numeric">Numeric</option>
                    <option value="dropdown">Dropdown</option>
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6B6963', cursor: 'pointer' }}>
                    <input type="checkbox" checked={editRequired} onChange={(e) => setEditRequired(e.target.checked)} />
                    Required
                  </label>
                </div>

                {editType === 'dropdown' && (
                  <div>
                    <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 6 }}>Dropdown options:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                      {editOptions.map((opt) => (
                        <span key={opt} style={{
                          background: '#EDE9FE', color: '#5B21B6', borderRadius: 20,
                          padding: '3px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          {opt}
                          <button
                            onClick={() => removeOption(opt)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7C3AED', fontSize: 14, lineHeight: 1, padding: 0 }}
                          >×</button>
                        </span>
                      ))}
                      {editOptions.length === 0 && <span style={{ fontSize: 12, color: '#9C9A92' }}>No options yet</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        className="form-input"
                        style={{ flex: 1, fontSize: 12 }}
                        placeholder="Add option..."
                        value={newOption}
                        onChange={(e) => setNewOption(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addOption()}
                      />
                      <button className="btn-add" onClick={addOption} style={{ fontSize: 12 }}>Add</button>
                    </div>
                  </div>
                )}

                {isGlobalField && scopeId !== GLOBAL_EQUIPMENT_ID && (
                  <p style={{ fontSize: 11, color: '#2563EB', background: '#EFF6FF', padding: '6px 10px', borderRadius: 6 }}>
                    ℹ️ Saving will create a <strong>{scopeName}-specific</strong> override.
                    The global default is preserved for all other equipment types.
                  </p>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={{ padding: '5px 12px', fontSize: 12, background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={() => saveEdit(cfg)}
                  >Save</button>
                  <button
                    style={{ padding: '5px 10px', fontSize: 12, background: '#F1EFE8', color: '#1A1A18', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={() => setEditingId(null)}
                  >Cancel</button>
                </div>
              </div>
            ) : (
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{cfg.label}</span>
                    <span style={{
                      fontSize: 10, background: typePill[cfg.fieldType].bg,
                      color: typePill[cfg.fieldType].color, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                    }}>{typePill[cfg.fieldType].label}</span>
                    {cfg.required && (
                      <span style={{ fontSize: 10, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 20 }}>Required</span>
                    )}
                    {cfg.isBuiltIn && !isOverridden && (
                      <span style={{ fontSize: 10, color: '#9C9A92' }}>Built-in</span>
                    )}
                    {isOverridden && (
                      <span style={{ fontSize: 10, background: '#DBEAFE', color: '#1E40AF', padding: '2px 8px', borderRadius: 20 }}>Override</span>
                    )}
                    {isGlobalField && !isOverridden && scopeId !== GLOBAL_EQUIPMENT_ID && (
                      <span style={{ fontSize: 10, color: '#9C9A92' }}>Global default</span>
                    )}
                  </div>
                  {cfg.fieldType === 'dropdown' && cfg.options.length > 0 && (
                    <p style={{ fontSize: 11, color: '#9C9A92', marginTop: 3 }}>
                      Options: {cfg.options.join(', ')}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    style={{ background: 'none', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, opacity: idx === 0 ? 0.3 : 1 }}
                  >↑</button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === resolvedForScope.length - 1}
                    style={{ background: 'none', border: '0.5px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, opacity: idx === resolvedForScope.length - 1 ? 0.3 : 1 }}
                  >↓</button>
                  <button className="btn-link-blue" onClick={() => startEdit(cfg)}>Edit</button>
                  {canDelete && (
                    <button className="btn-link-red" onClick={() => handleRemove(cfg)}>Remove</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {}
      <div style={{
        marginTop: 16, padding: '12px 14px', background: '#F1EFE8',
        borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.08)',
      }}>
        <p style={{ fontSize: 12, fontWeight: 500, marginBottom: 10, color: '#6B6963' }}>
          Add custom field
          {scopeId !== GLOBAL_EQUIPMENT_ID && (
            <span style={{ fontSize: 11, color: '#2563EB', marginLeft: 6 }}>
              — for {scopeName} only
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1, minWidth: 160, fontSize: 13 }}
            placeholder="Field label..."
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddField()}
          />
          <select
            className="form-input"
            style={{ width: 120, fontSize: 13 }}
            value={newType}
            onChange={(e) => setNewType(e.target.value as FieldType)}
          >
            <option value="text">Text</option>
            <option value="numeric">Numeric</option>
            <option value="dropdown">Dropdown</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6B6963', cursor: 'pointer', flexShrink: 0 }}>
            <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
            Required
          </label>
          <button className="btn-add" onClick={handleAddField}>Add Field</button>
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

function SuperAdminLoginLog({ logs }: { logs: ActivityLog[] }) {
  const [showAll, setShowAll] = React.useState(false);

  
  const loginLogs = React.useMemo(
    () => logs.filter((l) => l.type === 'admin_login').sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ),
    [logs]
  );

  const visible = showAll ? loginLogs : loginLogs.slice(0, PAGE_SIZE);
  const hasMore = loginLogs.length > PAGE_SIZE;

  function formatLoginTime(iso: string): { date: string; time: string } {
    if (!iso) return { date: '—', time: '—' };
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.10)', marginBottom: 20 }} />

      {}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {}
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: '#EFF6FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A18', margin: 0 }}>Super Admin Login History</p>
            <p style={{ fontSize: 11, color: '#9C9A92', margin: 0, marginTop: 1 }}>
              Every time the super admin account signs in
            </p>
          </div>
        </div>
        {}
        <div style={{
          background: loginLogs.length === 0 ? '#F1EFE8' : '#EFF6FF',
          color: loginLogs.length === 0 ? '#6B6963' : '#1D4ED8',
          borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
        }}>
          {loginLogs.length} {loginLogs.length === 1 ? 'session' : 'sessions'}
        </div>
      </div>

      {loginLogs.length === 0 ? (
        <div style={{
          background: '#F1EFE8', borderRadius: 10, padding: '16px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9C9A92" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 12, color: '#6B6963' }}>
            No login sessions recorded yet. Sessions are logged from this point forward.
          </span>
        </div>
      ) : (
        <>
          {}
          <div id="login-log-desktop" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F1EFE8', borderBottom: '0.5px solid rgba(0,0,0,0.12)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#6B6963', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', width: 36 }}>#</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#6B6963', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Date</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#6B6963', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Time</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#6B6963', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>IP Address</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: '#6B6963', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Account</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((log, idx) => {
                  const { date, time } = formatLoginTime(log.timestamp);
                  const isFirst = idx === 0;
                  return (
                    <tr key={log.id} style={{
                      borderBottom: '0.5px solid rgba(0,0,0,0.07)',
                      background: isFirst ? '#F0FDF4' : 'transparent',
                    }}>
                      <td style={{ padding: '9px 12px', color: '#9C9A92', fontSize: 11 }}>
                        {idx + 1}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#1A1A18', fontWeight: isFirst ? 500 : 400 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isFirst && (
                            <span style={{
                              background: '#DCFCE7', color: '#166534', fontSize: 9, fontWeight: 700,
                              padding: '1px 5px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.3px',
                            }}>Latest</span>
                          )}
                          {date}
                        </div>
                      </td>
                      <td style={{ padding: '9px 12px', color: '#1A1A18', fontFamily: 'monospace', fontSize: 12 }}>
                        {time}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {log.ip ? (
                          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#1A1A18',
                            background: '#F1EFE8', padding: '2px 7px', borderRadius: 6 }}>
                            {log.ip}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#9C9A92', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ background: '#DBEAFE', color: '#1E40AF', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
                          {log.actor ?? 'super admin'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {}
          <div id="login-log-mobile" style={{ display: 'none' }}>
            {visible.map((log, idx) => {
              const { date, time } = formatLoginTime(log.timestamp);
              const isFirst = idx === 0;
              return (
                <div key={log.id} style={{
                  background: isFirst ? '#F0FDF4' : '#F9F8F5',
                  border: `0.5px solid ${isFirst ? '#BBF7D0' : 'rgba(0,0,0,0.09)'}`,
                  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isFirst && (
                        <span style={{
                          background: '#DCFCE7', color: '#166534', fontSize: 9, fontWeight: 700,
                          padding: '1px 5px', borderRadius: 10, textTransform: 'uppercase',
                        }}>Latest</span>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#1A1A18' }}>{date}</span>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#6B6963' }}>{time}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ background: '#DBEAFE', color: '#1E40AF', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
                      {log.actor ?? 'super admin'}
                    </span>
                    {log.ip ? (
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6B6963',
                        background: '#F1EFE8', padding: '2px 7px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                        {log.ip}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#9C9A92', fontStyle: 'italic' }}>IP unavailable</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {}
          {hasMore && (
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{
                  background: 'none', border: '0.5px solid rgba(0,0,0,0.15)',
                  borderRadius: 8, padding: '6px 16px', fontSize: 12, color: '#6B6963',
                  cursor: 'pointer', fontWeight: 500,
                }}
              >
                {showAll
                  ? `Show less ▲`
                  : `Show all ${loginLogs.length} sessions ▼`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActiveUsersWidget() {
  const activityLogs = useStore((s) => s.activityLogs);
  const [liveCount, setLiveCount] = React.useState<number>(0);
  const [_stopPresence, setStopPresence] = React.useState<(() => void) | null>(null);

  React.useEffect(() => {
    const stop = startPresenceTracking((count) => setLiveCount(count));
    setStopPresence(() => stop);
    return () => stop();
  }, []);

  const dailyData = React.useMemo(() => getActiveUsersByDay(activityLogs, 7), [activityLogs]);

  const maxCount = Math.max(...dailyData.map((d) => d.count), 1);

  function fmtDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = dailyData.find((d) => d.date === today)?.count ?? 0;

  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A1A18', margin: '0 0 14px' }}>
        Active Users
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div
          style={{
            flex: 1,
            minWidth: 120,
            background: '#EFF6FF',
            border: '0.5px solid #BFDBFE',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 500, color: '#1D4ED8', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Live now
          </p>
          <p style={{ fontSize: 28, fontWeight: 600, color: '#1E40AF', margin: 0, lineHeight: 1 }}>
            {liveCount}
          </p>
          <p style={{ fontSize: 11, color: '#3B82F6', margin: '4px 0 0' }}>
            {liveCount === 1 ? 'user on the app' : 'users on the app'}
          </p>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 120,
            background: '#F0FDF4',
            border: '0.5px solid #BBF7D0',
            borderRadius: 10,
            padding: '14px 16px',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 500, color: '#15803D', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Today
          </p>
          <p style={{ fontSize: 28, fontWeight: 600, color: '#166534', margin: 0, lineHeight: 1 }}>
            {todayCount}
          </p>
          <p style={{ fontSize: 11, color: '#16A34A', margin: '4px 0 0' }}>
            unique {todayCount === 1 ? 'user' : 'users'} active
          </p>
        </div>
      </div>

      <p style={{ fontSize: 12, fontWeight: 500, color: '#6B6963', margin: '0 0 10px' }}>
        Unique users active per day (last 7 days)
      </p>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
        {dailyData.map((d) => {
          const isToday = d.date === today;
          const heightPct = d.count === 0 ? 4 : Math.max(12, (d.count / maxCount) * 80);
          return (
            <div
              key={d.date}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
              title={`${fmtDate(d.date)}: ${d.count} user${d.count !== 1 ? 's' : ''}`}
            >
              <span style={{ fontSize: 10, color: '#6B6963', minWidth: 16, textAlign: 'center' }}>
                {d.count > 0 ? d.count : ''}
              </span>
              <div
                style={{
                  width: '100%',
                  height: heightPct,
                  background: isToday ? '#3B82F6' : d.count === 0 ? '#E5E7EB' : '#93C5FD',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 0.3s ease',
                }}
              />
              <span style={{ fontSize: 9, color: isToday ? '#1D4ED8' : '#9CA3AF', fontWeight: isToday ? 600 : 400 }}>
                {new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: '#9C9A92', margin: '10px 0 0' }}>
        Daily counts are based on unique actors recorded in the activity log.
      </p>
    </div>
  );
}

function UploadZone({
  label,
  hint,
  currentUrl,
  onUpload,
  onRemove,
}: {
  label: string;
  hint: string;
  currentUrl: string | null;
  onUpload: (dataUrl: string) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved]         = useState(false);
  const [uploading, setUploading] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be under 2 MB. Please choose a smaller file.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    setSaved(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      onUpload(ev.target?.result as string);
      
      setTimeout(() => {
        setUploading(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }, 1500);
    };
    reader.onerror = () => {
      setUploading(false);
      alert('Failed to read image file. Please try again.');
    };
    reader.readAsDataURL(file);
    
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <label className="form-label" style={{ marginBottom: 4 }}>{label}</label>
      <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 12 }}>{hint}</p>

      {uploading && (
        <div style={{ background: '#EFF6FF', color: '#1D4ED8', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #1D4ED8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Uploading to cloud storage…
        </div>
      )}
      {saved && !uploading && <div className="banner-success" style={{ marginBottom: 8 }}>✅ Logo saved and synced to all devices!</div>}

      {currentUrl ? (
        <div>
          <div className="logo-preview-box">
            <img src={currentUrl} alt={label} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label
              style={{
                flex: 1,
                padding: '10px 20px',
                background: '#FFFFFF',
                color: '#1A1A18',
                border: '0.5px solid rgba(0,0,0,0.20)',
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'background 0.15s',
                display: 'block',
              }}
            >
              Replace Logo
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                ref={fileRef}
                onChange={handleFile}
              />
            </label>
            <button className="btn-danger" style={{ flex: 1 }} onClick={onRemove}>
              Remove Logo
            </button>
          </div>
        </div>
      ) : (
        <label className="upload-zone">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9C9A92" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <p style={{ fontSize: 14, color: '#6B6963', marginBottom: 4 }}>Click to upload logo</p>
          <p style={{ fontSize: 12, color: '#9C9A92' }}>PNG, JPG, SVG recommended</p>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            ref={fileRef}
            onChange={handleFile}
          />
        </label>
      )}
    </div>
  );
}

function ChangePasswordForm({ adminId }: { adminId: string }) {
  const { changeSuperAdminPassword } = useStore();
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);
    if (!curPw) { setPwError('Current password is required.'); return; }
    if (newPw.length < 6) { setPwError('New password must be at least 6 characters.'); return; }
    if (newPw !== confPw) { setPwError('New passwords do not match.'); return; }
    const ok = await changeSuperAdminPassword(adminId, curPw, newPw);
    if (!ok) {
      setPwError('Current password is incorrect.');
    } else {
      setPwSuccess(true);
      setCurPw(''); setNewPw(''); setConfPw('');
      setTimeout(() => setPwSuccess(false), 3000);
    }
  }

  const eyeBtn = (
    <button
      type="button"
      onClick={() => setShowPw((v) => !v)}
      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9C9A92', padding: 0 }}
      tabIndex={-1}
    >
      {showPw ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );

  return (
    <div>
      <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.10)', marginBottom: 20, marginTop: 4 }} />
      <label className="form-label" style={{ marginBottom: 4 }}>Change Your Password</label>
      <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 12 }}>
        Update your Super Administrator login password.
      </p>

      {pwError && <div className="banner-error" style={{ marginBottom: 12 }}>{pwError}</div>}
      {pwSuccess && <div className="banner-success" style={{ marginBottom: 12 }}>Password changed successfully.</div>}

      <form onSubmit={handleChangePw} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label className="form-label">Current Password <span style={{ color: '#EF4444' }}>*</span></label>
          <div style={{ position: 'relative' }}>
            <input type={showPw ? 'text' : 'password'} className="form-input" value={curPw} onChange={(e) => { setCurPw(e.target.value); setPwError(''); }} placeholder="••••••••" style={{ paddingRight: 40 }} autoComplete="current-password" />
            {eyeBtn}
          </div>
        </div>
        <div>
          <label className="form-label">New Password <span style={{ color: '#EF4444' }}>*</span></label>
          <div style={{ position: 'relative' }}>
            <input type={showPw ? 'text' : 'password'} className="form-input" value={newPw} onChange={(e) => { setNewPw(e.target.value); setPwError(''); }} placeholder="At least 6 characters" style={{ paddingRight: 40 }} autoComplete="new-password" />
            {eyeBtn}
          </div>
        </div>
        <div>
          <label className="form-label">Confirm New Password <span style={{ color: '#EF4444' }}>*</span></label>
          <input type={showPw ? 'text' : 'password'} className="form-input" value={confPw} onChange={(e) => { setConfPw(e.target.value); setPwError(''); }} placeholder="Re-enter new password" autoComplete="new-password" />
        </div>
        <button type="submit" className="btn-primary" style={{ marginTop: 4 }}>
          Update Password
        </button>
      </form>
    </div>
  );
}

function SettingsManager() {
  const {
    settings,
    setNavLogo,
    setHomeLogo,
    setChecklistLogo,
    setPasscodeLogo,
    setAppPasscode,
    setPasscodeEnabled,
    setQcRequired,
    setFuelRequired,
    setFooterText,
    setRecordsVisibility,
    setShowFillButton,
    setActivityLogVisibility,
    setFuelMonitoringVisibility,
    currentAdmin,
    activityLogs,
    fieldConfigs,
  } = useStore();

  const fuelRequired = fieldConfigs.find(
    (f: FieldConfig) => f.key === 'fuelLevel' && f.isBuiltIn
  )?.required ?? false;

  const [footerDraft, setFooterDraft] = React.useState<string>(
    settings.footerText ?? 'Designed by workshop inventory'
  );
  const [footerSaved, setFooterSaved] = React.useState(false);

  const [passcodeDraft, setPasscodeDraft] = React.useState(settings.appPasscode ?? '1234');
  const [passcodeSaved, setPasscodeSaved] = React.useState(false);
  const [passcodeError, setPasscodeError] = React.useState('');

  React.useEffect(() => {
    setPasscodeDraft(settings.appPasscode ?? '1234');
  }, [settings.appPasscode]);

  function handleSaveFooter() {
    const trimmed = footerDraft.trim();
    setFooterText(trimmed || 'Designed by workshop inventory');
    setFooterDraft(trimmed || 'Designed by workshop inventory');
    setFooterSaved(true);
    setTimeout(() => setFooterSaved(false), 2500);
  }

  function handleResetFooter() {
    const def = 'Designed by workshop inventory';
    setFooterText(def);
    setFooterDraft(def);
    setFooterSaved(true);
    setTimeout(() => setFooterSaved(false), 2500);
  }

  function handleSavePasscode() {
    const normalized = passcodeDraft.replace(/\D/g, '').slice(0, 4);
    if (normalized.length !== 4) {
      setPasscodeError('Passcode must be exactly 4 digits.');
      setPasscodeSaved(false);
      return;
    }
    setAppPasscode(normalized);
    setPasscodeDraft(normalized);
    setPasscodeError('');
    setPasscodeSaved(true);
    setTimeout(() => setPasscodeSaved(false), 2500);
  }

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>App Settings</h3>

      {}
      <div
        style={{
          background: '#F1EFE8',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 20,
          fontSize: 12,
          color: '#6B6963',
        }}
      >
        <strong style={{ color: '#1A1A18' }}>Logo Placement Guide</strong>
        <div style={{ marginTop: 4 }}>
          Four independent logos: <strong>Navigation Bar</strong> (top-left header),{' '}
          <strong>Homepage Title</strong> (beside site name), <strong>Checklist / Report Logo</strong>{' '}
          (shown on every record detail view and PDF download), and{' '}
          <strong>Passcode Screen Logo</strong> (shown on the app lock screen). Upload them separately below.
        </div>
      </div>

      <UploadZone
        label="1. Navigation Bar Logo"
        hint="Displayed in the sticky top-left header across all pages (32×32 px)."
        currentUrl={settings.navLogoUrl}
        onUpload={setNavLogo}
        onRemove={() => setNavLogo(null)}
      />

      <UploadZone
        label="2. Homepage Title Logo"
        hint='Displayed beside "Daily Checking" on the homepage hero section.'
        currentUrl={settings.homeLogoUrl}
        onUpload={setHomeLogo}
        onRemove={() => setHomeLogo(null)}
      />

      {/* ── Checklist / Report Logo ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
          border: '1px solid #BFDBFE',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 16,
          fontSize: 12,
          color: '#1E40AF',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          <strong style={{ color: '#1E3A8A' }}>Checklist / Report Logo</strong> — This logo will appear
          as a branded header on every <strong>Record Detail view</strong> (when admins open a submission)
          and on every <strong>PDF download</strong>. Upload your company logo here to brand all reports.
        </span>
      </div>

      <UploadZone
        label="3. Checklist / Report Logo"
        hint="Appears as a branded header on record detail views and on all PDF downloads. Recommended: horizontal logo on a transparent or white background."
        currentUrl={settings.checklistLogoUrl}
        onUpload={setChecklistLogo}
        onRemove={() => setChecklistLogo(null)}
      />

      {/* Preview of how it looks on the report */}
      {settings.checklistLogoUrl && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 8 }}>
            Preview — how the logo appears on record cards &amp; PDF reports:
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              background: 'linear-gradient(135deg, #1E3A8A 0%, #1D4ED8 100%)',
              borderRadius: 10,
              padding: '12px 18px',
            }}
          >
            <img
              src={settings.checklistLogoUrl}
              alt="Checklist logo preview"
              style={{ height: 36, maxWidth: 120, objectFit: 'contain', filter: 'brightness(0) invert(1)', flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div style={{ flex: 1, borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '0.03em' }}>
                DAILY CHECKING REPORT
              </p>
              <p style={{ fontSize: 10, color: 'rgba(186,230,253,0.9)', margin: '2px 0 0', fontFamily: 'monospace' }}>
                Ref: DC-XXXX-YYYY
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── App Passcode Lock ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)',
          border: '1px solid #FECACA',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 16,
          fontSize: 12,
          color: '#991B1B',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>
          <strong style={{ color: '#7F1D1D' }}>App Passcode Lock</strong> — When enabled, everyone must enter
          a 4 digit passcode on a lock screen before the app loads. Super admins only can toggle this on or off
          and change the passcode.
        </span>
      </div>

      <UploadZone
        label="4. Passcode Screen Logo"
        hint="Displayed on the first security screen before users enter the app. Falls back to your other logos if left empty."
        currentUrl={settings.passcodeLogoUrl}
        onUpload={setPasscodeLogo}
        onRemove={() => setPasscodeLogo(null)}
      />

      <div style={{ marginBottom: 24 }}>
        <label className="form-label" style={{ marginBottom: 8 }}>App Passcode Lock</label>
        <div
          className="toggle-row"
          onClick={() => setPasscodeEnabled(!settings.passcodeEnabled)}
        >
          <span>
            {settings.passcodeEnabled
              ? 'Enabled — a passcode is required to open the app'
              : 'Disabled — anyone can open the app without a passcode'}
          </span>
          <div className={`toggle-track ${settings.passcodeEnabled ? 'on' : ''}`}>
            <div className="toggle-knob" />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label className="form-label" style={{ marginBottom: 4 }}>4 Digit Passcode</label>
        <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 12 }}>
          This is the passcode users must enter when the App Passcode Lock above is enabled. Default is 1234.
        </p>

        {passcodeSaved && (
          <div className="banner-success" style={{ marginBottom: 12 }}>
            Passcode updated successfully.
          </div>
        )}
        {passcodeError && (
          <div className="banner-error" style={{ marginBottom: 12 }}>
            {passcodeError}
          </div>
        )}

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className="form-input"
          value={passcodeDraft}
          onChange={(e) => {
            setPasscodeDraft(e.target.value.replace(/\D/g, '').slice(0, 4));
            setPasscodeError('');
            setPasscodeSaved(false);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSavePasscode(); }}
          placeholder="1234"
          maxLength={4}
          style={{ marginBottom: 10 }}
        />

        <button
          className="btn-primary"
          style={{ width: '100%' }}
          onClick={handleSavePasscode}
          disabled={passcodeDraft === settings.appPasscode}
        >
          Save Passcode
        </button>
      </div>

      {}
      <div style={{ marginBottom: 24 }}>
        <label className="form-label" style={{ marginBottom: 8 }}>Form Fields</label>
        <div
          className="toggle-row"
          onClick={() => setQcRequired(!settings.qcVerifierRequired)}
        >
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>QC Verifier's Name — Required</p>
            <p style={{ fontSize: 11, color: '#9C9A92', marginTop: 2 }}>
              When on, technicians must fill in the QC verifier field before submitting.
            </p>
          </div>
          <div className={`toggle-track ${settings.qcVerifierRequired ? 'on' : ''}`}>
            <div className="toggle-knob" />
          </div>
        </div>
        {isSuperAdmin(currentAdmin) && (
          <div
            className="toggle-row"
            onClick={() => setFuelRequired(!fuelRequired)}
            style={{ cursor: 'pointer', marginTop: 10 }}
          >
            <div>
              <p style={{ fontSize: 13, fontWeight: 500 }}>Fuel Level - Required</p>
              <p style={{ fontSize: 11, color: '#9C9A92', marginTop: 2 }}>
                When on, technicians must complete the fuel level question before submitting.
                Visible to super admins only.
              </p>
            </div>
            <div className={`toggle-track ${fuelRequired ? 'on' : ''}`}>
              <div className="toggle-knob" />
            </div>
          </div>
        )}
      </div>

      {/* Fill All OK Button Visibility Toggle */}
      <div style={{ marginBottom: 24 }}>
        <label className="form-label" style={{ marginBottom: 8 }}>Checklist Options</label>
        <div
          className="toggle-row"
          onClick={() => setShowFillButton(!settings.showFillButton)}
          style={{ cursor: 'pointer' }}
        >
          <div>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Show "Fill All OK" Button for Everyone</p>
            <p style={{ fontSize: 11, color: '#9C9A92', marginTop: 2 }}>
              When on, all users see a one-tap button to mark every checklist item as OK.
              When off, only super admins see this button.
            </p>
          </div>
          <div className={`toggle-track ${settings.showFillButton ? 'on' : ''}`}>
            <div className="toggle-knob" />
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: settings.showFillButton ? '#F0FDF4' : '#F1EFE8',
            fontSize: 11,
            color: settings.showFillButton ? '#166534' : '#6B6963',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke={settings.showFillButton ? '#16A34A' : '#9C9A92'}
            strokeWidth="2" style={{ flexShrink: 0 }}>
            {settings.showFillButton
              ? <path d="M20 6 9 17l-5-5"/>
              : <><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></>
            }
          </svg>
          {settings.showFillButton
            ? 'Enabled — "Fill All OK" is visible to all users'
            : 'Disabled — "Fill All OK" is only visible to super admins'}
        </div>
      </div>

      {/* Records Visibility Control */}
      <div style={{ marginBottom: 24 }}>
        <label className="form-label" style={{ marginBottom: 8 }}>Records Section Visibility</label>
        <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 10 }}>
          Controls who can see the Records section. When set to Admin Only, technicians
          cannot view or navigate to the Records page.
        </p>
        <select
          className="form-input"
          value={settings.recordsVisibility ?? 'general'}
          onChange={(e) => setRecordsVisibility(e.target.value as RecordsVisibility)}
          style={{ marginBottom: 4 }}
        >
          <option value="general">General — Everyone can view Records</option>
          <option value="admin_only">Admin Only — Technicians are blocked</option>
        </select>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: (settings.recordsVisibility ?? 'general') === 'admin_only' ? '#FEF2F2' : '#F0FDF4',
            fontSize: 11,
            color: (settings.recordsVisibility ?? 'general') === 'admin_only' ? '#991B1B' : '#166534',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke={(settings.recordsVisibility ?? 'general') === 'admin_only' ? '#DC2626' : '#16A34A'}
            strokeWidth="2" style={{ flexShrink: 0 }}>
            {(settings.recordsVisibility ?? 'general') === 'admin_only'
              ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
              : <path d="M20 6 9 17l-5-5"/>
            }
          </svg>
          {(settings.recordsVisibility ?? 'general') === 'admin_only'
            ? 'Restricted — only admins can see Records'
            : 'Open — all users can see Records'}
        </div>
      </div>

      {/* Activity Log Visibility Control — Super Admin only */}
      {isSuperAdmin(currentAdmin) && (
        <div style={{ marginBottom: 24 }}>
          <label className="form-label" style={{ marginBottom: 8 }}>
            Activity Log Visibility
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 600,
              background: '#FEF3C7', color: '#92400E',
              padding: '2px 7px', borderRadius: 10, verticalAlign: 'middle',
            }}>Super Admin</span>
          </label>
          <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 10 }}>
            Controls who can see the Activity Log tab. When set to Admin Only,
            technicians cannot view or navigate to the Log page.
          </p>
          <select
            className="form-input"
            value={settings.activityLogVisibility ?? 'all'}
            onChange={(e) => setActivityLogVisibility(e.target.value as ActivityLogVisibility)}
            style={{ marginBottom: 4 }}
          >
            <option value="all">Everyone — All users can view the Activity Log</option>
            <option value="admin_only">Admin Only — Technicians are blocked</option>
          </select>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 6,
              padding: '6px 10px',
              borderRadius: 8,
              background: (settings.activityLogVisibility ?? 'all') === 'admin_only' ? '#FEF2F2' : '#F0FDF4',
              fontSize: 11,
              color: (settings.activityLogVisibility ?? 'all') === 'admin_only' ? '#991B1B' : '#166534',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke={(settings.activityLogVisibility ?? 'all') === 'admin_only' ? '#DC2626' : '#16A34A'}
              strokeWidth="2" style={{ flexShrink: 0 }}>
              {(settings.activityLogVisibility ?? 'all') === 'admin_only'
                ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                : <path d="M20 6 9 17l-5-5"/>
              }
            </svg>
            {(settings.activityLogVisibility ?? 'all') === 'admin_only'
              ? 'Restricted — only admins can see the Activity Log'
              : 'Open — all users can see the Activity Log'}
          </div>
        </div>
      )}

      {isSuperAdmin(currentAdmin) && (
        <div style={{ marginBottom: 24 }}>
          <label className="form-label" style={{ marginBottom: 8 }}>
            Fuel Monitoring Visibility
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 600,
              background: '#FEF3C7', color: '#92400E',
              padding: '2px 7px', borderRadius: 10, verticalAlign: 'middle',
            }}>Super Admin</span>
          </label>
          <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 10 }}>
            Controls who can see the Fuel Monitoring page. When set to Everyone,
            technicians can view low fuel and undetermined fuel records.
          </p>
          <select
            className="form-input"
            value={settings.fuelMonitoringVisibility ?? 'admin_only'}
            onChange={(e) => setFuelMonitoringVisibility(e.target.value as FuelMonitoringVisibility)}
            style={{ marginBottom: 4 }}
          >
            <option value="admin_only">Admin Only - Technicians are blocked</option>
            <option value="all">Everyone - All users can view Fuel Monitoring</option>
          </select>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 6,
              padding: '6px 10px',
              borderRadius: 8,
              background: (settings.fuelMonitoringVisibility ?? 'admin_only') === 'admin_only' ? '#FEF2F2' : '#F0FDF4',
              fontSize: 11,
              color: (settings.fuelMonitoringVisibility ?? 'admin_only') === 'admin_only' ? '#991B1B' : '#166534',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke={(settings.fuelMonitoringVisibility ?? 'admin_only') === 'admin_only' ? '#DC2626' : '#16A34A'}
              strokeWidth="2" style={{ flexShrink: 0 }}>
              {(settings.fuelMonitoringVisibility ?? 'admin_only') === 'admin_only'
                ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                : <path d="M20 6 9 17l-5-5"/>
              }
            </svg>
            {(settings.fuelMonitoringVisibility ?? 'admin_only') === 'admin_only'
              ? 'Restricted - only admins can see Fuel Monitoring'
              : 'Open - all users can see Fuel Monitoring'}
          </div>
        </div>
      )}

      {/* Footer Text */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.10)', marginBottom: 20 }} />
        <label className="form-label" style={{ marginBottom: 4 }}>Footer Text</label>
        <p style={{ fontSize: 11, color: '#9C9A92', marginBottom: 12 }}>
          This text appears at the bottom of every page. Only the super administrator can edit it.
        </p>

        {footerSaved && (
          <div className="banner-success" style={{ marginBottom: 12 }}>
            Footer text updated successfully.
          </div>
        )}

        <div
          style={{
            background: '#F1EFE8',
            borderRadius: 10,
            padding: '8px 12px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C9A92" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{ fontSize: 11, color: '#9C9A92' }}>
            Preview:{' '}
            <span style={{ color: '#1A1A18', fontStyle: 'italic' }}>
              {footerDraft.trim() || 'Designed by workshop inventory'}
            </span>
          </span>
        </div>

        <input
          type="text"
          className="form-input"
          value={footerDraft}
          onChange={(e) => { setFooterDraft(e.target.value); setFooterSaved(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveFooter(); }}
          placeholder="Designed by workshop inventory"
          maxLength={120}
          style={{ marginBottom: 10 }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            onClick={handleSaveFooter}
            disabled={footerDraft === settings.footerText}
          >
            Save Footer Text
          </button>
          <button
            className="btn-secondary"
            style={{ flex: 'none', padding: '10px 16px' }}
            onClick={handleResetFooter}
            title="Restore default footer text"
          >
            Reset to Default
          </button>
        </div>
      </div>

      {/* ── Active Users ── */}
      <ActiveUsersWidget />

      {/* ── Super Admin Login History ── */}
      <SuperAdminLoginLog logs={activityLogs} />

      {/* ── Change Password (super admin) ── */}
      {currentAdmin && <ChangePasswordForm adminId={currentAdmin.id} />}
    </div>
  );
}

function EquipmentMappingManager() {
  const departments          = useStore((s) => s.departments);
  const sections             = useStore((s) => s.sections);
  const equipmentTypes       = useStore((s) => s.equipmentTypes);
  const equipmentTypeMappings = useStore((s) => s.equipmentTypeMappings);
  const setEquipmentTypeMappings = useStore((s) => s.setEquipmentTypeMappings);

  const [selectedDeptId, setSelectedDeptId] = React.useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState(false);

  const filteredSections = React.useMemo(
    () => sections.filter((s) => s.departmentId === selectedDeptId),
    [sections, selectedDeptId]
  );

  const currentMappedIds = React.useMemo(
    () => getMappedEquipmentTypeIds(equipmentTypeMappings, selectedDeptId, selectedSectionId) ?? [],
    [equipmentTypeMappings, selectedDeptId, selectedSectionId]
  );

  const [draftIds, setDraftIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    setDraftIds(currentMappedIds);

  }, [selectedDeptId, selectedSectionId, equipmentTypeMappings]);

  function toggleEquipmentType(id: string) {
    setDraftIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!selectedDeptId || !selectedSectionId) return;
    setSaving(true);
    try {
      await setEquipmentTypeMappings(selectedDeptId, selectedSectionId, draftIds);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  const hasDeptSection = !!selectedDeptId && !!selectedSectionId;
  const hasChanges = JSON.stringify([...draftIds].sort()) !== JSON.stringify([...currentMappedIds].sort());

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Equipment Type Mapping</h3>
      <p style={{ fontSize: 12, color: '#6B6963', marginBottom: 20 }}>
        Control which equipment types appear for each Department + Section combination.
        When no mapping is set, technicians see all equipment types.
      </p>

      {/* Department selector */}
      <div style={{ marginBottom: 14 }}>
        <label className="form-label" style={{ marginBottom: 6 }}>Department</label>
        <select
          className="form-input"
          value={selectedDeptId}
          onChange={(e) => { setSelectedDeptId(e.target.value); setSelectedSectionId(''); }}
        >
          <option value="">— Select a department —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Section selector */}
      <div style={{ marginBottom: 20 }}>
        <label className="form-label" style={{ marginBottom: 6 }}>Section</label>
        <select
          className="form-input"
          value={selectedSectionId}
          onChange={(e) => setSelectedSectionId(e.target.value)}
          disabled={!selectedDeptId}
        >
          <option value="">— Select a section —</option>
          {filteredSections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {selectedDeptId && filteredSections.length === 0 && (
          <p style={{ fontSize: 11, color: '#9C9A92', marginTop: 4 }}>
            No sections for this department. Add sections in the Structure tab.
          </p>
        )}
      </div>

      {/* Equipment type checklist */}
      {hasDeptSection && (
        <div style={{ marginBottom: 20 }}>
          <label className="form-label" style={{ marginBottom: 8 }}>
            Allowed Equipment Types
          </label>

          {currentMappedIds.length === 0 && draftIds.length === 0 && (
            <div style={{
              padding: '10px 12px', background: '#FFFBEB', borderRadius: 8,
              fontSize: 12, color: '#92400E', marginBottom: 12,
            }}>
              ⚠️ No mapping set — technicians currently see <strong>all</strong> equipment types for this combination.
              Check the types you want to restrict to.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {equipmentTypes.map((eq) => {
              const checked = draftIds.includes(eq.id);
              return (
                <label
                  key={eq.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10,
                    border: checked ? '1.5px solid #2563EB' : '0.5px solid rgba(0,0,0,0.15)',
                    background: checked ? '#EFF6FF' : '#FFFFFF',
                    cursor: 'pointer', fontSize: 14, fontWeight: checked ? 500 : 400,
                    transition: 'background 0.12s, border-color 0.12s',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEquipmentType(eq.id)}
                    style={{ width: 16, height: 16, accentColor: '#2563EB', flexShrink: 0 }}
                  />
                  <span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, background: '#F1EFE8', padding: '2px 6px', borderRadius: 4, marginRight: 8 }}>
                      {eq.code}
                    </span>
                    {eq.name}
                  </span>
                </label>
              );
            })}
          </div>

          {equipmentTypes.length === 0 && (
            <p style={{ fontSize: 12, color: '#9C9A92' }}>
              No equipment types configured. Add them in the Structure tab.
            </p>
          )}

          {savedMsg && (
            <div className="banner-success" style={{ marginTop: 12 }}>
              Mapping saved — changes will appear immediately for all users.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving…' : 'Save Mapping'}
            </button>
            {draftIds.length > 0 && (
              <button
                className="btn-secondary"
                style={{ flex: 'none', padding: '10px 16px' }}
                onClick={() => setDraftIds([])}
                title="Clear all selections (shows all equipment types)"
              >
                Clear All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary table of all existing mappings */}
      {equipmentTypeMappings.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.10)', marginBottom: 16 }} />
          <h4 style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: '#6B6963' }}>
            All Active Mappings
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {departments.map((dept) => {
              const deptSections = sections.filter((s) => s.departmentId === dept.id);
              return deptSections.map((sec) => {
                const mapped = getMappedEquipmentTypeIds(equipmentTypeMappings, dept.id, sec.id);
                if (!mapped || mapped.length === 0) return null;
                const names = mapped
                  .map((id) => equipmentTypes.find((e) => e.id === id)?.name ?? '?')
                  .join(', ');
                return (
                  <div
                    key={`${dept.id}-${sec.id}`}
                    style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: '#F1EFE8', fontSize: 12, color: '#1A1A18',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{dept.name} / {sec.name}</span>
                    {' → '}
                    <span style={{ color: '#2563EB' }}>{names}</span>
                  </div>
                );
              });
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type TabKey = 'checklist' | 'structure' | 'mapping' | 'fields' | 'admins' | 'settings';

export default function AdminPanel() {
  const { currentAdmin, logout } = useStore();

  const superAdmin = isSuperAdmin(currentAdmin);
  const seniorOrSuper = canManageJuniors(currentAdmin);
  const hasAdminTabAccess = canAccessAdminTab(currentAdmin);

  const allTabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'checklist', label: 'Checklist Builder', show: superAdmin },
    { key: 'structure',  label: 'Structure',        show: superAdmin },
    { key: 'mapping',    label: 'Equip. Mapping',   show: superAdmin },
    { key: 'fields',     label: 'Form Fields',      show: superAdmin },
    { key: 'admins',     label: 'Admin Accounts',   show: hasAdminTabAccess },
    { key: 'settings',   label: 'Settings',         show: superAdmin },
  ];

  const visibleTabs = allTabs.filter((t) => t.show);

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (superAdmin) return 'checklist';
    if (seniorOrSuper) return 'admins';
    return 'admins';
  });

  if (!currentAdmin) return <LoginScreen />;

  if (visibleTabs.length === 0) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px' }}>
        <AdminHeader currentAdmin={currentAdmin} onLogout={logout} />
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#DCFCE7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
            You're signed in as Junior Admin
          </h3>
          <p style={{ fontSize: 13, color: '#6B6963', marginBottom: 16 }}>
            Junior Admins can delete submitted records from the{' '}
            <strong>Records</strong> section. You don't have access to configuration panels.
          </p>
          <div
            style={{
              background: '#F1EFE8',
              borderRadius: 12,
              padding: '12px 14px',
              textAlign: 'left',
              fontSize: 12,
              color: '#6B6963',
            }}
          >
            <div style={{ marginBottom: 4 }}>
              <span className="perm-pill-yes" style={{ marginRight: 8 }}>✓</span>Delete submitted records
            </div>
            <div>
              <span className="perm-pill-no" style={{ marginRight: 8 }}>✗</span>
              Checklist builder, structure, logo, admin accounts
            </div>
          </div>
        </div>
      </div>
    );
  }

  const safeTab = visibleTabs.find((t) => t.key === activeTab)
    ? activeTab
    : visibleTabs[0].key;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px' }}>
      <AdminHeader currentAdmin={currentAdmin} onLogout={logout} />

      <div className="tab-bar">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${safeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {safeTab === 'checklist' && superAdmin && <ChecklistBuilder />}
        {safeTab === 'structure' && superAdmin && <StructureManager />}
        {safeTab === 'mapping'   && superAdmin && <EquipmentMappingManager />}
        {safeTab === 'fields'    && superAdmin && <FieldConfigManager />}
        {safeTab === 'admins' && hasAdminTabAccess && <AdminUsersManager />}
        {safeTab === 'settings' && superAdmin && <SettingsManager />}
      </div>
    </div>
  );
}
