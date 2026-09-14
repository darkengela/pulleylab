import { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { DEFAULT_RATIO, findPairs } from '../cad/ratio';
import type { PulleyPair, RatioRequirements } from '../cad/ratio';
import { dimensions } from '../cad/parameters';
import type { Parameters } from '../cad/parameters';
export default function RatioPlanner({
  parameters,
  busy,
  onGenerate,
}: {
  parameters: Parameters;
  busy: boolean;
  onGenerate: (pair: PulleyPair) => void;
}) {
  const [q, setQ] = useState({ ...DEFAULT_RATIO, drivenBore: parameters.bore }),
    [selection, setSelection] = useState('');
  const search = useMemo(() => {
    try {
      return { ...findPairs(parameters, q), error: '' };
    } catch (e) {
      return { pairs: [], total: 0, error: (e as Error).message };
    }
  }, [parameters, q]);
  const key = (pair: PulleyPair) => `${pair.drive.teeth}-${pair.driven.teeth}`;
  const selected = search.pairs.find((pair) => key(pair) === selection) ?? search.pairs[0];
  const field = (name: keyof RatioRequirements, label: string, unit: string, optional = false) => (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <input
          type="number"
          form="ratio-requirements"
          aria-label={label}
          step="any"
          value={Number.isFinite(q[name]) ? (optional && q[name] === 0 ? '' : q[name]) : ''}
          placeholder={optional ? 'Any' : undefined}
          onChange={(e) =>
            setQ((old) => ({
              ...old,
              [name]: e.target.value === '' ? (optional ? 0 : NaN) : Number(e.target.value),
            }))
          }
        />
        <span>{unit}</span>
      </div>
    </label>
  );
  return (
    <details className="advanced-section ratio-planner">
      <summary>
        Drive ratio planner <span>Advanced</span>
      </summary>
      <div className="ratio-content">
        <p className="field-hint">
          Uses HTD {parameters.profile}, your {parameters.belt_width || '—'} mm belt width, drive
          bore, flanges, and hub above.
        </p>
        <div className="input-row">
          {field('target', 'Target ratio', ': 1')}
          {field('tolerance', 'Ratio tolerance', '%')}
        </div>
        <p className="ratio-explainer">
          Driven teeth ÷ drive teeth. A 3:1 ratio gives one driven revolution for three drive
          revolutions.
        </p>
        <h4>Drive pulley range</h4>
        <div className="input-row">
          {field('driveMin', 'Drive minimum teeth', 'T')}
          {field('driveMax', 'Drive maximum teeth', 'T')}
        </div>
        <h4>Driven pulley range</h4>
        <div className="input-row">
          {field('drivenMin', 'Driven minimum teeth', 'T')}
          {field('drivenMax', 'Driven maximum teeth', 'T')}
        </div>
        {field('drivenBore', 'Driven shaft bore', 'mm')}
        <details className="ratio-limits">
          <summary>Size & belt constraints</summary>
          <div className="input-row">
            {field('driveMaxOD', 'Drive maximum OD', 'mm', true)}
            {field('drivenMaxOD', 'Driven maximum OD', 'mm', true)}
          </div>
          <p className="field-hint">OD limits include flanges. Blank means no limit.</p>
          {field('beltLength', 'Belt pitch length', 'mm', true)}
          <div className="input-row">
            {field('centerMin', 'Minimum shaft spacing', 'mm', true)}
            {field('centerMax', 'Maximum shaft spacing', 'mm', true)}
          </div>
          <p className="field-hint">
            With a belt length, pairs must fit the spacing range, clear each other, and engage at
            least six teeth on the smaller pulley.
          </p>
        </details>
        {search.error ? (
          <p className="planner-message" role="status">
            {search.error}
          </p>
        ) : (
          <>
            <p className="ratio-count">
              {search.total} matching {search.total === 1 ? 'pair' : 'pairs'}
              {search.total > 60 ? ' · best 60 shown' : ''}
            </p>
            {selected ? (
              <>
                <select
                  className="pair-options"
                  size={4}
                  aria-label="Pulley configuration"
                  value={key(selected)}
                  onChange={(e) => setSelection(e.target.value)}
                >
                  {search.pairs.map((pair) => (
                    <option key={key(pair)} value={key(pair)}>
                      {pair.drive.teeth}T → {pair.driven.teeth}T · {Number(pair.ratio.toFixed(4))}:1
                      · {pair.error < 1e-7 ? 'exact' : pair.error.toFixed(2) + '% off'}
                    </option>
                  ))}
                </select>
                <div className="ratio-dimensions">
                  <span>
                    Drive OD<strong>{dimensions(selected.drive).outside.toFixed(2)} mm</strong>
                  </span>
                  <span>
                    Driven OD<strong>{dimensions(selected.driven).outside.toFixed(2)} mm</strong>
                  </span>
                </div>
                {selected.centerDistance !== undefined && (
                  <p className="field-hint">
                    Shaft spacing: <strong>{selected.centerDistance.toFixed(2)} mm</strong> ·{' '}
                    {selected.engagedTeeth?.toFixed(1)} teeth engaged.
                  </p>
                )}
                <button
                  type="button"
                  className="generate-button pair-generate"
                  disabled={busy}
                  onClick={() => onGenerate(selected)}
                >
                  Generate both pulleys <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <p className="planner-message">
                No pairs fit. Widen the tooth ranges or tolerance, or check bores and size limits.
              </p>
            )}
          </>
        )}
        <p className="field-hint">
          Pairs are ranked by ratio accuracy, then size. Check belt availability, load ratings, and
          allowance for tension adjustment.
        </p>
      </div>
    </details>
  );
}
