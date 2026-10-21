import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  FolderOpen,
  Link2,
  LoaderCircle,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Viewer from './components/Viewer';
import RatioPlanner from './components/RatioPlanner';
import PairWorkspace from './components/PairWorkspace';
import type { PulleyPair } from './cad/ratio';
import type { Appearance } from './appearance';
import {
  DEFAULTS,
  PROFILES,
  SCREWS,
  clampError,
  dimensions,
  filename,
  lighteningStatus,
  profileLabel,
  readInitial,
  parseBuild,
  buildData,
  shareHash,
  validate,
} from './cad/parameters';
import type { Parameters, Profile } from './cad/parameters';
import type { PulleyResult } from './cad/model';
type NumberKey = Exclude<
  keyof Parameters,
  'profile' | 'flanges' | 'd_shaft' | 'lightening' | 'clamp' | 'clamp_screw'
>;
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function Logo() {
  return (
    <span className="wordmark">
      <svg aria-hidden="true" viewBox="0 0 32 32" width="31" height="31">
        <circle
          cx="16"
          cy="16"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeDasharray="3.3 1.94"
        />
        <circle cx="16" cy="16" r="3.7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>
        pulley<span>lab</span>
      </span>
    </span>
  );
}
function mm(n: number) {
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : '—';
}
function BoreDiagram({
  dShaft,
  diameter,
  flat,
}: {
  dShaft: boolean;
  diameter: number;
  flat: number;
}) {
  const showD = dShaft && diameter > 0 && flat > 0 && flat < diameter;
  const cx = 46;
  const cy = 46;
  const R = 26;
  const left = cx - R;
  const right = cx + R;
  const flatX = showD ? left + (flat / diameter) * 2 * R : right;
  const dx = flatX - cx;
  const dy = Math.sqrt(Math.max(0, R * R - dx * dx));
  const label = showD
    ? `D-shaft, diameter ${mm(diameter)} millimeters, flat ${mm(flat)} millimeters`
    : `Circular bore, diameter ${mm(diameter)} millimeters`;
  return (
    <svg className="bore-diagram" viewBox="0 0 168 100" role="img" aria-label={label}>
      {showD ? (
        <path
          d={`M ${flatX} ${cy - dy} A ${R} ${R} 0 1 0 ${flatX} ${cy + dy} L ${flatX} ${cy - dy}`}
        />
      ) : (
        <circle cx={cx} cy={cy} r={diameter > 0 ? R : 3} />
      )}
      <line className="dim" x1={left} y1={8} x2={right} y2={8} />
      <line className="dim" x1={left} y1={5} x2={left} y2={12} />
      <line className="dim" x1={right} y1={5} x2={right} y2={12} />
      <line className="dim" x1={left} y1={12} x2={left} y2={cy - R} />
      <line className="dim" x1={right} y1={12} x2={right} y2={showD ? cy - dy : cy - R} />
      {showD && (
        <>
          <line className="dim" x1={left} y1={92} x2={flatX} y2={92} />
          <line className="dim" x1={left} y1={88} x2={left} y2={96} />
          <line className="dim" x1={flatX} y1={88} x2={flatX} y2={96} />
        </>
      )}
      <text x="102" y={showD ? 38 : 46}>
        Diameter
      </text>
      <text x="102" y={showD ? 52 : 62}>
        {mm(diameter)} mm
      </text>
      {showD && (
        <>
          <text x="102" y="72">
            Flat
          </text>
          <text x="102" y="86">
            {mm(flat)} mm
          </text>
        </>
      )}
    </svg>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal glass"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [initial] = useState(readInitial),
    [p, setP] = useState<Parameters>(initial.parameters),
    [appearance, setAppearance] = useState<Appearance>(initial.appearance),
    [pair, setPair] = useState<PulleyPair | null>(
      initial.driven
        ? {
            drive: initial.parameters,
            driven: initial.driven,
            ratio: initial.driven.teeth / initial.parameters.teeth,
            error: 0,
            centerDistance: initial.centerDistance,
          }
        : null,
    ),
    [pairBusy, setPairBusy] = useState(false),
    [result, setResult] = useState<PulleyResult | null>(null),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState('Loading CAD engine'),
    [error, setError] = useState(initial.message ?? ''),
    [toast, setToast] = useState(''),
    [modal, setModal] = useState<'help' | 'share' | null>(null),
    [advanced, setAdvanced] = useState(false);
  const form = useRef<HTMLFormElement>(null),
    file = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    run = useRef(0);
  const dirty = !result || JSON.stringify(p) !== JSON.stringify(result.parameters),
    canDownload = !!result && !dirty && !busy,
    d = dimensions(p),
    webStatus = lighteningStatus(p),
    collarStatus = clampError(p);
  const set = (key: keyof Parameters, value: number | string) => {
    setP((old) => ({ ...old, [key]: value }));
    setError('');
  };
  const setDShaft = (on: boolean) => {
    setP((old) => {
      if (!on) return { ...old, d_shaft: false };
      const d_diameter =
        Number.isFinite(old.bore) && old.bore > 0 ? old.bore : old.d_diameter || DEFAULTS.d_diameter;
      const d_flat =
        old.d_flat > 0 && old.d_flat < d_diameter
          ? old.d_flat
          : Number((d_diameter > 1 ? d_diameter - 1 : d_diameter / 2).toFixed(4));
      return { ...old, d_shaft: true, d_diameter, d_flat };
    });
    setError('');
  };
  function cancel() {
    run.current++;
    worker.current?.terminate();
    worker.current = null;
    clearTimeout(timeout.current);
    setBusy(false);
    setStage('Cancelled');
  }
  function generate(event?: FormEvent) {
    event?.preventDefault();
    if (busy || pairBusy || !form.current?.reportValidity()) return;
    let settings: Parameters;
    try {
      settings = validate(p);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setPair(null);
    cancel();
    const id = ++run.current;
    setBusy(true);
    setError('');
    setStage('Loading CAD engine');
    const w = new Worker(new URL('./cad/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    const finish = () => {
      w.terminate();
      if (worker.current === w) worker.current = null;
      clearTimeout(timeout.current);
      setBusy(false);
    };
    w.onmessage = (e) => {
      if (id !== run.current) return;
      const data = e.data;
      if (data.type === 'progress') setStage(data.stage);
      if (data.type === 'result') {
        setResult(data.result);
        try {
          localStorage.setItem('pulleylab:settings:v1', JSON.stringify(settings));
        } catch {}
        finish();
      }
      if (data.type === 'error') {
        setError(data.error);
        finish();
      }
    };
    w.onerror = () => {
      if (id !== run.current) return;
      setError('The CAD engine could not load. Check your connection and try again.');
      finish();
    };
    timeout.current = setTimeout(() => {
      if (id === run.current) {
        finish();
        setError(
          'This build is taking too long on this device. Try fewer teeth or a simpler pulley.',
        );
      }
    }, 90000);
    w.postMessage(settings);
  }
  useEffect(() => {
    const openSharedBuild = () => {
      if (location.hash.startsWith('#p=')) location.reload();
    };
    window.addEventListener('hashchange', openSharedBuild);
    return () => window.removeEventListener('hashchange', openSharedBuild);
  }, []);
  useEffect(() => {
    if (!initial.driven) generate();
    return () => {
      worker.current?.terminate();
      clearTimeout(timeout.current);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('pulleylab:appearance:v1', JSON.stringify(appearance));
    } catch {}
  }, [appearance]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const field = (
    key: NumberKey,
    label: string,
    options: { min?: number; max?: number; step?: number; hint?: string; unit?: boolean } = {},
  ) => (
    <label className="field" key={key}>
      <span>
        {label}
        {options.hint && (
          <span className="field-info" title={options.hint}>
            <CircleHelp size={13} />
          </span>
        )}
      </span>
      <div className="input-shell">
        <input
          type="number"
          name={key}
          aria-label={label}
          value={Number.isFinite(p[key]) ? p[key] : ''}
          onChange={(e) => set(key, e.target.value === '' ? NaN : Number(e.target.value))}
          min={options.min ?? 0}
          max={options.max}
          step={options.step ?? 'any'}
          required
        />
        <span>{options.unit === false ? 'teeth' : 'mm'}</span>
      </div>
    </label>
  );
  const exportFile = (type: 'step' | 'stl') => {
    if (canDownload) {
      saveFile(result[type], filename(result.parameters, type));
      setToast(`${type.toUpperCase()} downloaded`);
    }
  };
  const saveSettings = () => {
    try {
      const valid = validate(p);
      saveFile(
        new Blob(
          [
            JSON.stringify(
              buildData(valid, appearance, pair?.driven, pair?.centerDistance),
              null,
              2,
            ) + '\n',
          ],
          { type: 'application/json' },
        ),
        filename(valid, 'json'),
      );
      setToast('Settings saved');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const loadSettings = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 16384) throw Error('Choose a settings file smaller than 16 KB.');
      const settings = parseBuild(JSON.parse(await f.text()));
      setP(settings.parameters);
      setAppearance(settings.appearance);
      setPair(
        settings.driven
          ? {
              drive: settings.parameters,
              driven: settings.driven,
              ratio: settings.driven.teeth / settings.parameters.teeth,
              error: 0,
              centerDistance: settings.centerDistance,
            }
          : null,
      );
      setError('');
      setToast('Settings loaded. Generate to update your pulley.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  const share = async () => {
    try {
      validate(p);
      if (pair && JSON.stringify(p) !== JSON.stringify(pair.drive))
        throw Error('Generate an updated pair before sharing, or switch to a single pulley.');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    try {
      const url =
        location.origin +
        location.pathname +
        shareHash(p, appearance, pair?.driven, pair?.centerDistance);
      if (!navigator.clipboard) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setToast('Link copied — dimensions and finish included');
    } catch {
      setModal('share');
    }
  };
  const reset = () => {
    setPair(null);
    setP({ ...DEFAULTS });
    setError('');
    setToast('8M starter settings restored');
  };
  return (
    <>
      <div className="world-background" aria-hidden="true">
        <div className="particle-field" />
        <div className="light-field" />
        <div className="background-scrim" />
      </div>
      <header className="site-header">
        <a href={location.pathname} className="brand-link" aria-label="PulleyLab home">
          <Logo />
        </a>
        <nav className="toolbar-nav" aria-label="Main navigation">
          <a href="#workspace" className="nav-active">
            Generator
          </a>
          <button type="button" onClick={() => setModal('help')}>
            How it works
          </button>
          <Link to="/htd-profiles">Profiles</Link>
          <Link to="/d-shaft">D-shaft</Link>
          <Link to="/download">Download</Link>
        </nav>
        <div className="toolbar-actions">
          <button className="button glass share-button" type="button" onClick={share}>
            <Link2 size={15} />
            <span>Share build</span>
          </button>
          <button type="button" onClick={saveSettings}>
            <Download size={13} />
            Save
          </button>
          <button type="button" onClick={() => file.current?.click()}>
            <FolderOpen size={13} />
            Load
          </button>
          <button type="button" onClick={reset}>
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </header>
      <form id="ratio-requirements" hidden onSubmit={(e) => e.preventDefault()} />
      <main id="workspace">
        <div className="page-intro">
          <h1>Timing pulley generator</h1>
          <p>
            Design an HTD or GT timing pulley, preview the solid, and download STEP or STL. It runs
            in the browser.
          </p>
        </div>
        <div className="workspace-grid">
          <aside className="controls-panel glass">
            <div className="panel-title">
              <div>
                <Settings2 size={18} />
                <h2>Build your pulley</h2>
              </div>
              <div
                className="live-od"
                aria-live="polite"
                title={`Tooth-tip OD. ${p.flanges !== 'none' && Number.isFinite(d.flange) ? `Flange OD: ${d.flange.toFixed(2)} mm.` : ''}`}
              >
                <span>OD · tooth tips</span>
                <output aria-label="Live pulley outside diameter">
                  {Number.isFinite(d.outside) ? d.outside.toFixed(2) : '—'} <small>mm</small>
                </output>
              </div>
            </div>
            <form ref={form} onSubmit={generate}>
              <div className="control-fields">
                <section className="control-section">
                  <div className="section-label">
                    <span>01</span>
                    <h3>Tooth profile</h3>
                  </div>
                  <div className="select-shell">
                    <select
                      aria-label="Belt profile"
                      value={p.profile}
                      onChange={(e) => set('profile', e.target.value as Profile)}
                    >
                      <optgroup label="HTD">
                        {(Object.keys(PROFILES) as Profile[])
                          .filter((id) => PROFILES[id].family === 'HTD')
                          .map((id) => (
                            <option key={id} value={id}>
                              HTD {id}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="GT">
                        {(Object.keys(PROFILES) as Profile[])
                          .filter((id) => PROFILES[id].family === 'GT')
                          .map((id) => (
                            <option key={id} value={id}>
                              {id} · {PROFILES[id].pitch} mm
                            </option>
                          ))}
                      </optgroup>
                    </select>
                    <ChevronDown size={15} />
                  </div>
                  <div className="bore-block">
                    <div>
                      <div className="input-row">
                        {field('teeth', 'Tooth count', { min: 12, max: 240, step: 1, unit: false })}
                        {p.d_shaft
                          ? field('d_diameter', 'D diameter', {
                              hint: 'Full round diameter of the D-shaft, in millimeters.',
                            })
                          : field('bore', 'Bore diameter', { hint: 'Set to zero for a solid center.' })}
                      </div>
                      <div className="profile-tabs bore-mode" role="group" aria-label="Bore shape">
                        <button
                          type="button"
                          className={p.d_shaft ? '' : 'selected'}
                          aria-pressed={!p.d_shaft}
                          onClick={() => setDShaft(false)}
                        >
                          Round bore
                        </button>
                        <button
                          type="button"
                          className={p.d_shaft ? 'selected' : ''}
                          aria-pressed={p.d_shaft}
                          onClick={() => setDShaft(true)}
                        >
                          D-shaft
                        </button>
                      </div>
                      {p.d_shaft &&
                        field('d_flat', 'Flat', {
                          hint: 'Distance from the flat face to the opposite point on the circle.',
                        })}
                    </div>
                    <BoreDiagram
                      dShaft={p.d_shaft}
                      diameter={p.d_shaft ? p.d_diameter : p.bore}
                      flat={p.d_flat}
                    />
                  </div>
                  {p.d_shaft && (
                    <p className="field-hint">
                      Greater than 0 and less than the diameter. An 8 mm D-shaft with a 7 mm flat is
                      a full 8 mm circle with one flat. The flat faces +X.
                    </p>
                  )}
                </section>
                <section className="control-section">
                  <div className="section-label">
                    <span>02</span>
                    <h3>Belt & clearance</h3>
                  </div>
                  <div className="input-row">
                    {field('belt_width', 'Belt width', { min: 0.5, max: 200 })}
                    {field('clearance', 'Extra space', {
                      max: 10,
                      hint: 'Total extra space across the face; not per side.',
                    })}
                  </div>
                </section>
                <section className="control-section">
                  <div className="section-label">
                    <span>03</span>
                    <h3>Flanges</h3>
                  </div>
                  <div className="select-shell">
                    <select
                      aria-label="Flange arrangement"
                      value={p.flanges}
                      onChange={(e) => set('flanges', e.target.value)}
                    >
                      <option value="both">Both sides</option>
                      <option value="bottom">Bottom only</option>
                      <option value="none">No flanges</option>
                    </select>
                    <ChevronDown size={15} />
                  </div>
                  {p.flanges !== 'none' && (
                    <div className="input-row">
                      {field('flange_thickness', 'Thickness', { min: 0.2, max: 15 })}
                      {field('flange_overhang', 'Overhang', {
                        min: 0.2,
                        max: 20,
                        hint: 'Radial distance beyond the tooth tips.',
                      })}
                    </div>
                  )}
                </section>
                <div className={`advanced-controls ${advanced ? 'is-expanded' : ''}`}>
                  <section className="advanced-section">
                    <button
                      type="button"
                      className="advanced-toggle"
                      aria-expanded={advanced}
                      aria-controls="advanced-options"
                      onClick={() => setAdvanced(!advanced)}
                    >
                      <span>
                        <SlidersHorizontal size={15} />
                        Hub, lightening & clamp
                      </span>
                      <ChevronRight size={15} className={advanced ? 'expanded' : ''} />
                    </button>
                    {advanced && (
                      <div id="advanced-options" className="advanced-fields">
                        {p.flanges !== 'none' && field('chamfer', 'Flange chamfer', { max: 5 })}
                        <div className="input-row">
                          {field('hub_diameter', 'Hub diameter')}
                          {field('hub_length', 'Hub length', { max: 100 })}
                        </div>
                        <p className="field-hint">
                          A hub extends from the bottom. Leave length at 0 to omit it.
                        </p>
                        <div className="select-shell">
                          <select
                            aria-label="Lightening"
                            value={p.lightening}
                            onChange={(e) => set('lightening', e.target.value)}
                          >
                            <option value="off">Solid web</option>
                            <option value="shell">Shell</option>
                            <option value="fins">Fins</option>
                          </select>
                          <ChevronDown size={15} />
                        </div>
                        {p.lightening !== 'off' && (
                          <>
                            {field('wall', 'Minimum wall', {
                              min: 0.2,
                              max: 40,
                              hint: 'Material left at the bore and under the tooth roots.',
                            })}
                            <p className="field-hint">
                              {webStatus ||
                                (p.lightening === 'shell'
                                  ? 'An annular pocket from the faces, leaving this wall at the bore and under the teeth.'
                                  : 'Four radial ribs. The pockets between them stop at this wall.')}
                            </p>
                          </>
                        )}
                        <div className="profile-tabs bore-mode" role="group" aria-label="Clamp">
                          <button
                            type="button"
                            className={p.clamp ? '' : 'selected'}
                            aria-pressed={!p.clamp}
                            onClick={() => {
                              setP((old) => ({ ...old, clamp: false }));
                              setError('');
                            }}
                          >
                            No clamp
                          </button>
                          <button
                            type="button"
                            className={p.clamp ? 'selected' : ''}
                            aria-pressed={p.clamp}
                            onClick={() => {
                              setP((old) => ({ ...old, clamp: true }));
                              setError('');
                            }}
                          >
                            Clamp
                          </button>
                        </div>
                        {p.clamp && (
                          <>
                            <div className="input-row">
                              {field('clamp_height', 'Clamp height', { min: 0.2, max: 80 })}
                              {field('clamp_thickness', 'Clamp wall', { min: 0.2, max: 40 })}
                            </div>
                            <div className="select-shell">
                              <select
                                aria-label="Clamp screw"
                                value={p.clamp_screw}
                                onChange={(e) => set('clamp_screw', e.target.value)}
                              >
                                {(Object.keys(SCREWS) as (keyof typeof SCREWS)[]).map((size) => (
                                  <option key={size} value={size}>
                                    {size} · {SCREWS[size].major} mm × {SCREWS[size].pitch} mm
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={15} />
                            </div>
                            <p className="field-hint">
                              {collarStatus ||
                                'A collar on the hub side with one radial metric thread. The screw clamps on the shaft. If a hub is also set, one collar uses the larger diameter and the longer length.'}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                  <RatioPlanner
                    parameters={p}
                    busy={busy || pairBusy}
                    onGenerate={(selected) => {
                      setP(selected.drive);
                      setPair(selected);
                      setError('');
                    }}
                  />
                </div>
                {error && (
                  <p role="alert" className="error-message">
                    <CircleHelp size={15} />
                    {error}
                  </p>
                )}
              </div>
              <div className="generate-area">
                <button className="generate-button" type="submit" disabled={busy || pairBusy}>
                  {busy ? <LoaderCircle size={17} className="spin" /> : <BoxIcon />}
                  <span>
                    {pairBusy
                      ? 'Generating pair…'
                      : busy
                        ? 'Generating pulley…'
                        : 'Generate pulley'}
                  </span>
                  {!busy && <ArrowUpRight size={17} />}
                </button>
                {(busy || pairBusy) && (
                  <button
                    className="cancel-button"
                    type="button"
                    onClick={() => {
                      cancel();
                      setPair(null);
                      setPairBusy(false);
                    }}
                  >
                    Cancel generation
                  </button>
                )}
              </div>
              <input
                ref={file}
                type="file"
                hidden
                accept="application/json,.json"
                onChange={(e) => loadSettings(e.target.files?.[0])}
              />
            </form>
          </aside>
          <section className="model-workspace" aria-label="Pulley preview and downloads">
            {pair ? (
              <PairWorkspace
                pair={pair}
                appearance={appearance}
                onAppearanceChange={setAppearance}
                onBusyChange={setPairBusy}
                onBack={() => setPair(null)}
                dirty={JSON.stringify(p) !== JSON.stringify(pair.drive)}
              />
            ) : (
              <>
                <Viewer
                  mesh={result?.mesh ?? null}
                  appearance={appearance}
                  onAppearanceChange={setAppearance}
                  busy={busy}
                  stage={stage}
                  dirty={!!result && dirty}
                  label={
                    result
                      ? `${profileLabel(result.parameters.profile)} · ${result.parameters.teeth} teeth`
                      : `${profileLabel(p.profile)} · ${p.teeth || '—'} teeth`
                  }
                />
                <div className="dimension-grid">
                  {[
                    { label: 'Pitch diameter', value: d.pitch },
                    { label: 'Outside diameter', value: d.outside },
                    { label: 'Face width', value: d.face },
                    { label: 'Overall width', value: d.total },
                  ].map((x) => (
                    <div key={x.label}>
                      <span>{x.label}</span>
                      <strong>
                        {Number.isFinite(x.value) ? x.value.toFixed(2) : '—'}
                        <small>mm</small>
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="export-section">
                  <div className="export-heading">
                    <span className="export-icon">
                      <ArrowDownToLine size={21} strokeWidth={1.4} />
                    </span>
                    <p>
                      {busy
                        ? 'Building the solid…'
                        : dirty && result
                          ? 'Settings changed. Generate to update the model.'
                          : result
                            ? `Generated in ${result.seconds.toFixed(1)}s`
                            : 'Generate a pulley, then download STEP or STL.'}
                    </p>
                  </div>
                  <div className="export-buttons">
                    <button
                      className="download-button"
                      disabled={!canDownload}
                      onClick={() => exportFile('step')}
                    >
                      <Download size={17} />
                      Download STEP
                    </button>
                    <button
                      className="button glass stl-button"
                      disabled={!canDownload}
                      onClick={() => exportFile('stl')}
                    >
                      STL
                      <Download size={14} />
                    </button>
                  </div>
                  <div className="file-label">
                    <span>FILE NAME</span>
                    <code title={filename(p, 'step')}>{filename(p, 'step')}</code>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
        <div className="workspace-notes">
          <span>
            <ShieldCheck size={14} />
            Your build stays in your browser.
          </span>
          <button onClick={() => setModal('help')}>
            <CircleHelp size={14} />
            Profiles, fit & importing into Fusion <ArrowUpRight size={12} />
          </button>
        </div>
      </main>
      <footer>
        <a href="/NOTICE.txt" target="_blank" rel="noreferrer">
          Source & licenses
        </a>
      </footer>
      {toast && (
        <div className="toast glass" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === 'help' && (
        <Modal title="How it works" onClose={() => setModal(null)}>
          <ol className="help-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Define your pulley.</h3>
                <p>
                  Choose the profile printed on your belt, then set the tooth count, belt width, and
                  bore. For a D-shaft, switch the bore to D-shaft and set the diameter and the flat.
                  Extra space adds clearance across the whole face. Shell or fin lightening and the
                  clamp are under Hub, lightening & clamp.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Generate and inspect.</h3>
                <p>
                  Rotate the actual solid, check its dimensions, and choose STEP for CAD or STL for
                  printing. Preview finishes don’t affect the exported geometry.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Bring it into Fusion.</h3>
                <p>
                  Choose File → Open → Open from my computer. The STEP imports as a solid body. Save
                  the settings here to regenerate a different size.
                </p>
              </div>
            </li>
          </ol>
          <div className="help-note">
            <h3>Check the fit before the final part.</h3>
            <p>
              HTD profiles use a circular-arc tooth. GT2, GT3, and GT5 use a modified curvilinear
              tooth. An HTD belt and a GT belt are not interchangeable. Physical belt fit hasn’t
              been verified here. Print a short test piece first.
            </p>
            <p>
              The exported file contains the geometry, not a Fusion feature history. You can add
              keyways, set-screw holes, or other shaft features in Fusion.
            </p>
          </div>
          <button className="download-button" onClick={() => setModal(null)}>
            Back to building
          </button>
        </Modal>
      )}
      {modal === 'share' && (
        <Modal title="Share this build" onClose={() => setModal(null)}>
          <p>Copy this link to open PulleyLab with these dimensions and preview finish.</p>
          <textarea
            className="share-url"
            readOnly
            value={
              location.origin +
              location.pathname +
              shareHash(p, appearance, pair?.driven, pair?.centerDistance)
            }
            onFocus={(e) => e.target.select()}
          />
        </Modal>
      )}
      <Analytics />
    </>
  );
}
function BoxIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5l8 4.5 8-4.5 M12 12v9" />
    </svg>
  );
}
