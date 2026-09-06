/**
 * FieldConfigManager.tsx
 *
 * Standalone Super Admin component for managing dynamic form fields.
 * All edits (label, type, required, options) update the Zustand store
 * IMMEDIATELY on every change — no Save/Cancel cycle per field.
 *
 * Relies entirely on store.ts for state:
 *   - fieldConfigs          : FieldConfig[]
 *   - upsertFieldConfig     : (config: FieldConfig) => void
 *   - removeFieldConfig     : (id: string) => void
 *   - reorderFieldConfigs   : (orderedIds: string[]) => void
 */


import { useStore, FieldConfig, FieldType, GLOBAL_EQUIPMENT_ID } from '../store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uid = () =>
  'custom_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ─── Sub-component: single option row ────────────────────────────────────────

interface OptionRowProps {
  index: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}

function OptionRow({ index, value, onChange, onRemove }: OptionRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: '#9C9A92',
          minWidth: 20,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {index + 1}.
      </span>
      <input
        type="text"
        className="form-input"
        style={{ flex: 1, fontSize: 13 }}
        placeholder={`Option ${index + 1}…`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="btn-link-red"
        style={{ fontSize: 12, flexShrink: 0 }}
        onClick={onRemove}
        title="Remove this option"
      >
        Remove
      </button>
    </div>
  );
}

// ─── Sub-component: dropdown options editor ───────────────────────────────────

interface DropdownEditorProps {
  cfg: FieldConfig;
  onAddOption: () => void;
  onUpdateOption: (index: number, value: string) => void;
  onRemoveOption: (index: number) => void;
}

function DropdownEditor({
  cfg,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}: DropdownEditorProps) {
  const opts = cfg.options ?? [];

  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '0.5px solid rgba(0,0,0,0.10)',
        paddingLeft: 12,
        paddingRight: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 500, color: '#6B6963', margin: 0 }}>
          Dropdown options
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              background: '#EDE9FE',
              color: '#5B21B6',
              padding: '2px 8px',
              borderRadius: 20,
            }}
          >
            {opts.length} option{opts.length !== 1 ? 's' : ''}
          </span>
        </p>
        <button
          className="btn-add"
          style={{ fontSize: 12, padding: '5px 12px' }}
          onClick={onAddOption}
        >
          + Add Option
        </button>
      </div>

      {opts.length === 0 ? (
        <div
          style={{
            background: 'rgba(0,0,0,0.04)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            color: '#9C9A92',
            fontStyle: 'italic',
            marginBottom: 4,
          }}
        >
          No options yet. Click "+ Add Option" to add choices for technicians.
        </div>
      ) : (
        opts.map((opt, i) => (
          <OptionRow
            key={i}
            index={i}
            value={opt}
            onChange={(v) => onUpdateOption(i, v)}
            onRemove={() => onRemoveOption(i)}
          />
        ))
      )}
    </div>
  );
}

// ─── Sub-component: single field row ─────────────────────────────────────────

interface FieldRowProps {
  cfg: FieldConfig;
  index: number;
  total: number;
  onUpdate: (patch: Partial<FieldConfig>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function FieldRow({
  cfg,
  index,
  total,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: FieldRowProps) {
  // ── Ensure options array exists when displaying a dropdown field ──────────
  const opts = cfg.options ?? [];

  // ── Type change: seed one empty option when switching to dropdown ─────────
  function handleTypeChange(newType: FieldType) {
    const patch: Partial<FieldConfig> = { fieldType: newType };
    if (newType === 'dropdown' && opts.length === 0) {
      patch.options = [''];
    }
    onUpdate(patch);
  }

  // ── Option helpers — each touches the options array only ──────────────────
  function addOption() {
    onUpdate({ options: [...opts, ''] });
  }

  function updateOption(i: number, value: string) {
    const next = [...opts];
    next[i] = value;
    onUpdate({ options: next });
  }

  function removeOption(i: number) {
    onUpdate({ options: opts.filter((_, idx) => idx !== i) });
  }

  // ── Type display labels ───────────────────────────────────────────────────
  const typeLabels: Record<FieldType, string> = {
    text: 'Text',
    numeric: 'Number',
    dropdown: 'Dropdown',
    fuel_percent: 'Fuel %',
  };

  const typePill: Record<FieldType, { bg: string; color: string }> = {
    text:         { bg: '#DCFCE7', color: '#166534' },
    numeric:      { bg: '#DBEAFE', color: '#1E40AF' },
    dropdown:     { bg: '#EDE9FE', color: '#5B21B6' },
    fuel_percent: { bg: '#FEF3C7', color: '#92400E' },
  };

  const pill = typePill[cfg.fieldType];

  return (
    <div
      style={{
        background: cfg.isBuiltIn ? '#F1EFE8' : '#EFF6FF',
        borderRadius: 12,
        padding: '14px',
        marginBottom: 10,
        border: '0.5px solid rgba(0,0,0,0.08)',
      }}
    >
      {/* ── Top row: controls + actions ───────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {/* ── Reorder buttons ─────────────────────────────────────────────── */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}
        >
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            style={{
              background: 'none',
              border: '0.5px solid rgba(0,0,0,0.15)',
              borderRadius: 4,
              padding: '2px 7px',
              cursor: index === 0 ? 'default' : 'pointer',
              fontSize: 11,
              opacity: index === 0 ? 0.25 : 0.8,
              lineHeight: 1.4,
              fontFamily: 'inherit',
            }}
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            style={{
              background: 'none',
              border: '0.5px solid rgba(0,0,0,0.15)',
              borderRadius: 4,
              padding: '2px 7px',
              cursor: index === total - 1 ? 'default' : 'pointer',
              fontSize: 11,
              opacity: index === total - 1 ? 0.25 : 0.8,
              lineHeight: 1.4,
              fontFamily: 'inherit',
            }}
          >
            ↓
          </button>
        </div>

        {/* ── Label input ─────────────────────────────────────────────────── */}
        <input
          type="text"
          className="form-input"
          style={{ flex: 1, minWidth: 140, fontSize: 13 }}
          value={cfg.label}
          placeholder="Field label"
          onChange={(e) => onUpdate({ label: e.target.value })}
        />

        {/* ── Type select ─────────────────────────────────────────────────── */}
        <select
          className="form-input"
          style={{ width: 124, fontSize: 13, flexShrink: 0 }}
          value={cfg.fieldType}
          onChange={(e) => handleTypeChange(e.target.value as FieldType)}
        >
          <option value="text">Text</option>
          <option value="numeric">Number</option>
          <option value="dropdown">Dropdown</option>
        </select>

        {/* ── Required checkbox ───────────────────────────────────────────── */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12,
            color: '#6B6963',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={cfg.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
          />
          Required
        </label>

        {/* ── Type pill + built-in badge ───────────────────────────────────── */}
        <span
          style={{
            fontSize: 10,
            background: pill.bg,
            color: pill.color,
            padding: '2px 8px',
            borderRadius: 20,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {typeLabels[cfg.fieldType]}
        </span>

        {cfg.isBuiltIn && (
          <span
            style={{
              fontSize: 10,
              color: '#9C9A92',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Built-in
          </span>
        )}

        {/* ── Delete button ────────────────────────────────────────────────── */}
        {!cfg.isBuiltIn && (
          <button
            className="btn-link-red"
            style={{ fontSize: 12, flexShrink: 0 }}
            onClick={onDelete}
            title={`Delete field "${cfg.label}"`}
          >
            Delete
          </button>
        )}
      </div>

      {/* ── Dropdown options editor — only visible when type === dropdown ─── */}
      {cfg.fieldType === 'dropdown' && (
        <DropdownEditor
          cfg={cfg}
          onAddOption={addOption}
          onUpdateOption={updateOption}
          onRemoveOption={removeOption}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FieldConfigManager() {
  const fieldConfigs       = useStore((s) => s.fieldConfigs);
  const upsertFieldConfig  = useStore((s) => s.upsertFieldConfig);
  const removeFieldConfig  = useStore((s) => s.removeFieldConfig);
  const reorderFieldConfigs = useStore((s) => s.reorderFieldConfigs);

  // Sort by order for stable display
  const sorted = [...fieldConfigs].sort((a, b) => a.order - b.order);

  // ── Generic field updater — merges patch and immediately upserts ──────────
  function updateField(cfg: FieldConfig, patch: Partial<FieldConfig>) {
    upsertFieldConfig({ ...cfg, ...patch });
  }

  // ── Reorder ───────────────────────────────────────────────────────────────
  function moveField(idx: number, dir: -1 | 1) {
    const ids = sorted.map((f) => f.id);
    const next = idx + dir;
    if (next < 0 || next >= ids.length) return;
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorderFieldConfigs(ids, GLOBAL_EQUIPMENT_ID);
  }

  // ── Add new custom field ──────────────────────────────────────────────────
  function handleAddField() {
    const maxOrder = fieldConfigs.reduce((m, f) => Math.max(m, f.order), -1);
    const id = uid();
    upsertFieldConfig({
      id,
      key: id,
      label: 'New Field',
      fieldType: 'text',
      required: false,
      order: maxOrder + 1,
      options: [],
      isBuiltIn: false,
      equipmentTypeId: GLOBAL_EQUIPMENT_ID,
    });
  }

  // ── Delete with confirmation ──────────────────────────────────────────────
  function handleDelete(cfg: FieldConfig) {
    if (cfg.isBuiltIn) return; // guard — built-ins cannot be deleted
    if (confirm(`Delete field "${cfg.label}"? This cannot be undone.`)) {
      removeFieldConfig(cfg.id);
    }
  }

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
        Form Field Configuration
      </h3>
      <p style={{ fontSize: 12, color: '#9C9A92', marginBottom: 6 }}>
        Configure the fields shown in the{' '}
        <strong style={{ color: '#1A1A18' }}>Basic Details</strong> step when
        technicians fill out a checklist. All changes apply immediately.
      </p>

      {/* ── Info banner ───────────────────────────────────────────────────── */}
      <div
        style={{
          background: '#EFF6FF',
          color: '#1D4ED8',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 12,
          marginBottom: 20,
          border: '0.5px solid #BFDBFE',
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2563EB"
          strokeWidth="2"
          style={{ flexShrink: 0, marginTop: 1 }}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          <strong>Built-in fields</strong> can be reconfigured (label, type, required,
          options) but cannot be deleted. <strong>Custom fields</strong> you add here can
          be deleted at any time. Technician forms reflect all changes instantly.
        </span>
      </div>

      {/* ── Field list ────────────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div
          style={{
            background: '#F1EFE8',
            borderRadius: 12,
            padding: '24px',
            textAlign: 'center',
            fontSize: 13,
            color: '#9C9A92',
            marginBottom: 16,
          }}
        >
          No fields configured yet. Click <strong>Add Field</strong> below to get started.
        </div>
      ) : (
        sorted.map((cfg, idx) => (
          <FieldRow
            key={cfg.id}
            cfg={cfg}
            index={idx}
            total={sorted.length}
            onUpdate={(patch) => updateField(cfg, patch)}
            onDelete={() => handleDelete(cfg)}
            onMoveUp={() => moveField(idx, -1)}
            onMoveDown={() => moveField(idx, 1)}
          />
        ))
      )}

      {/* ── Add Field button ──────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 16,
          borderTop: '0.5px solid rgba(0,0,0,0.10)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button
          className="btn-primary"
          onClick={handleAddField}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Field
        </button>
        <span style={{ fontSize: 12, color: '#9C9A92' }}>
          New fields start as <em>Text</em> type, not required. Click the type selector
          to change to Number or Dropdown.
        </span>
      </div>
    </div>
  );
}