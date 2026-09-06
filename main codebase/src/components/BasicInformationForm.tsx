/**
 * BasicInformationForm.tsx
 *
 * Renders the dynamic "Basic Details" fields for a specific equipment type.
 * Uses resolveFieldConfigs() to merge global defaults + equipment-specific
 * overrides so each equipment type can have its own field configuration.
 *
 * DATA SAFETY GUARANTEE:
 *   `values` is owned by the parent's useState and is NEVER reset here.
 *   When fieldConfigs updates in the store (admin change on another device),
 *   this component re-renders with new field config but the parent's values
 *   object is untouched — partial user input is always preserved.
 *
 * USAGE:
 *   <BasicInformationForm
 *     equipmentTypeId={sel.equipmentTypeId}
 *     values={details}
 *     errors={errors}
 *     onChange={(key, value) => setDetails(d => ({ ...d, [key]: value }))}
 *     onClearError={(key) => setErrors(e => ({ ...e, [key]: '' }))}
 *     qcVerifierRequired={settings.qcVerifierRequired}
 *   />
 */

import { useStore, FieldConfig, resolveFieldConfigs } from '../store';
import { FUEL_UNDETERMINED_REASONS } from '../lib/fuelAnalysis';

// ─── Props ────────────────────────────────────────────────────────────────────

interface BasicInformationFormProps {
  /** The equipment type currently selected by the technician.
   *  Used to look up equipment-specific field config overrides. */
  equipmentTypeId: string;
  /** Current form values keyed by FieldConfig.key. Never reset by this component. */
  values: Record<string, string>;
  /** Validation errors keyed by FieldConfig.key. */
  errors: Record<string, string>;
  /** Parent state updater — called on every field change. */
  onChange: (key: string, value: string) => void;
  /** Clear a validation error once the user starts correcting it. */
  onClearError: (key: string) => void;
  /** Whether the QC verifier field is required (from AppSettings). */
  qcVerifierRequired?: boolean;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

function clampFuel(v: string): string {
  const cleaned = v.replace(/\D/g, '');
  if (!cleaned) return '';
  return String(Math.min(100, Math.max(0, parseInt(cleaned, 10))));
}

interface FuelCompoundProps {
  isRequired: boolean;
  canDetermine: 'yes' | 'no' | '';
  fuelLevel: string;
  reason: string;
  errors: { canDetermine: string; fuelLevel: string; reason: string };
  onChangeDetermine: (v: 'yes' | 'no') => void;
  onChangeLevel: (v: string) => void;
  onChangeReason: (v: string) => void;
  onClearErrors: () => void;
}

function FuelCompoundField({
  isRequired,
  canDetermine,
  fuelLevel,
  reason,
  errors,
  onChangeDetermine,
  onChangeLevel,
  onChangeReason,
  onClearErrors,
}: FuelCompoundProps) {
  const mark = isRequired
    ? <span style={{ color: '#EF4444' }}> *</span>
    : <span style={{ fontSize: 11, color: '#9C9A92' }}> (optional)</span>;

  const numericVal = fuelLevel !== '' ? parseInt(fuelLevel, 10) : null;
  const isLow      = numericVal !== null && numericVal < 20;
  const isCritical = numericVal !== null && numericVal < 10;
  const barColor   = isCritical ? '#EF4444' : isLow ? '#F59E0B' : '#22C55E';

  return (
    <div>
      <label className="form-label">Can fuel level be determined?{mark}</label>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {(['yes', 'no'] as const).map((opt) => (
          <label
            key={opt}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: canDetermine === opt ? '#1A1A18' : '#6B6963',
              padding: '8px 14px',
              borderRadius: 8,
              border: `1.5px solid ${canDetermine === opt ? '#1A1A18' : 'rgba(0,0,0,0.15)'}`,
              background: canDetermine === opt ? '#F3F2EC' : '#FAFAF8',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              type="radio"
              name="fuelCanDetermine"
              value={opt}
              checked={canDetermine === opt}
              onChange={() => { onChangeDetermine(opt); onClearErrors(); }}
              style={{ accentColor: '#1A1A18', width: 14, height: 14 }}
            />
            {opt === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>

      {errors.canDetermine && <p className="field-error">{errors.canDetermine}</p>}

      {canDetermine === 'yes' && (
        <div style={{ marginTop: 2 }}>
          <label className="form-label">
            Fuel Level (%)
            {isRequired && <span style={{ color: '#EF4444' }}> *</span>}
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`form-input ${errors.fuelLevel ? 'error-field' : ''}`}
              placeholder="0 - 100"
              value={fuelLevel}
              style={{ paddingRight: 40 }}
              onChange={(e) => { onChangeLevel(clampFuel(e.target.value)); onClearErrors(); }}
            />
            <span style={{
              position: 'absolute', right: 12, fontSize: 14,
              fontWeight: 500, color: '#6B6963', pointerEvents: 'none',
            }}>%</span>
          </div>

          {numericVal !== null && (
            <div style={{ marginTop: 6 }}>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${numericVal}%`,
                  background: barColor,
                  borderRadius: 4,
                  transition: 'width 0.2s ease, background 0.2s ease',
                }} />
              </div>
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 500, color: barColor }}>
                {isCritical
                  ? 'Critical - Fuel very low. Refuelling required.'
                  : isLow
                  ? 'Low fuel - this will appear in Fuel Monitoring alerts.'
                  : 'Fuel level OK'}
              </div>
            </div>
          )}

          {errors.fuelLevel && <p className="field-error">{errors.fuelLevel}</p>}
        </div>
      )}

      {canDetermine === 'no' && (
        <div style={{ marginTop: 2 }}>
          <label className="form-label">
            Reason
            {isRequired && <span style={{ color: '#EF4444' }}> *</span>}
          </label>
          <select
            className={`form-input ${errors.reason ? 'error-field' : ''}`}
            value={reason}
            onChange={(e) => { onChangeReason(e.target.value); onClearErrors(); }}
          >
            <option value="">Select a reason</option>
            {FUEL_UNDETERMINED_REASONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {errors.reason && <p className="field-error">{errors.reason}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Single field renderer ────────────────────────────────────────────────────

interface FieldProps {
  cfg:          FieldConfig;
  value:        string;
  error:        string;
  isRequired:   boolean;
  onChange:     (val: string) => void;
  onClearError: () => void;
}

function DynamicField({ cfg, value, error, isRequired, onChange, onClearError }: FieldProps) {
  const mark = isRequired
    ? <span style={{ color: '#EF4444' }}> *</span>
    : <span style={{ fontSize: 11, color: '#9C9A92' }}> (optional)</span>;

  if (cfg.fieldType === 'dropdown') {
    return (
      <div>
        <label className="form-label">{cfg.label}{mark}</label>
        <select
          className={`form-input ${error ? 'error-field' : ''}`}
          value={value}
          onChange={(e) => { onChange(e.target.value); onClearError(); }}
        >
          <option value="">Select...</option>
          {cfg.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }

  if (cfg.fieldType === 'numeric') {
    return (
      <div>
        <label className="form-label">{cfg.label}{mark}</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className={`form-input ${error ? 'error-field' : ''}`}
          placeholder="Numbers only"
          value={value}
          onChange={(e) => { onChange(digitsOnly(e.target.value)); onClearError(); }}
        />
        {error && <p className="field-error">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="form-label">{cfg.label}{mark}</label>
      <input
        type="text"
        className={`form-input ${error ? 'error-field' : ''}`}
        placeholder={`Enter ${cfg.label.toLowerCase()}`}
        value={value}
        onChange={(e) => { onChange(e.target.value); onClearError(); }}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BasicInformationForm({
  equipmentTypeId,
  values,
  errors,
  onChange,
  onClearError,
  qcVerifierRequired = false,
}: BasicInformationFormProps) {
  // Subscribe to the full flat list — resolveFieldConfigs handles the merge.
  // When the admin changes a config on another device:
  //   Realtime fires → App.tsx calls mergeRemoteFieldConfigs → store updates
  //   → this component re-renders with merged configs for this equipment type
  //   → `values` in the parent is untouched → user input preserved.
  const allConfigs = useStore((s) => s.fieldConfigs);

  // Resolve: globals + any equipment-specific overrides, sorted by order
  const resolved = resolveFieldConfigs(allConfigs, equipmentTypeId);

  return (
    <>
      {resolved.map((cfg: FieldConfig) => {
        // QC verifier is handled separately below (controlled by settings toggle)
        if (cfg.key === 'qcVerifierName') return null;

        if (cfg.fieldType === 'fuel_percent') {
          return (
            <FuelCompoundField
              key={cfg.id}
              isRequired={cfg.required}
              canDetermine={(values.fuelCanDetermine as 'yes' | 'no' | '') ?? ''}
              fuelLevel={(values.fuelLevel as string) ?? ''}
              reason={(values.fuelUndeterminedReason as string) ?? ''}
              errors={{
                canDetermine: errors.fuelCanDetermine ?? '',
                fuelLevel: errors.fuelLevel ?? '',
                reason: errors.fuelUndeterminedReason ?? '',
              }}
              onChangeDetermine={(v) => {
                onChange('fuelCanDetermine', v);
                if (v === 'yes') onChange('fuelUndeterminedReason', '');
                if (v === 'no') onChange('fuelLevel', '');
              }}
              onChangeLevel={(v) => onChange('fuelLevel', v)}
              onChangeReason={(v) => onChange('fuelUndeterminedReason', v)}
              onClearErrors={() => {
                onClearError('fuelCanDetermine');
                onClearError('fuelLevel');
                onClearError('fuelUndeterminedReason');
              }}
            />
          );
        }

        return (
          <DynamicField
            key={cfg.id}
            cfg={cfg}
            value={(values[cfg.key] as string) ?? ''}
            error={errors[cfg.key] ?? ''}
            isRequired={cfg.required}
            onChange={(v) => onChange(cfg.key, v)}
            onClearError={() => onClearError(cfg.key)}
          />
        );
      })}

      {/* QC Verifier — always shown, required controlled by settings toggle */}
      <div>
        <label className="form-label">
          QC Verifier's Name{' '}
          {qcVerifierRequired
            ? <span style={{ color: '#EF4444' }}>*</span>
            : <span style={{ fontSize: 11, color: '#9C9A92' }}>(optional)</span>
          }
        </label>
        <input
          type="text"
          className={`form-input ${errors.qcVerifierName ? 'error-field' : ''}`}
          placeholder="Enter QC verifier name"
          value={(values.qcVerifierName as string) ?? ''}
          onChange={(e) => { onChange('qcVerifierName', e.target.value); onClearError('qcVerifierName'); }}
        />
        {errors.qcVerifierName && <p className="field-error">{errors.qcVerifierName}</p>}
      </div>
    </>
  );
}
