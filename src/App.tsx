import { useEffect, useRef, useState } from 'react';
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
import Viewer from './components/Viewer';
import {
  DEFAULTS,
  PROFILES,
  dimensions,
  filename,
  readInitial,
  shareHash,
  validate,
} from './cad/parameters';
import type { Parameters, Profile } from './cad/parameters';
import type { PulleyResult } from './cad/model';
type NumberKey = Exclude<keyof Parameters, 'profile' | 'flanges'>;
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
    d = dimensions(p);
  const set = (key: keyof Parameters, value: number | string) => {
    setP((old) => ({ ...old, [key]: value }));
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
    if (busy || !form.current?.reportValidity()) return;
    let settings: Parameters;
    try {
      settings = validate(p);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
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
    generate();
    return () => {
      worker.current?.terminate();
      clearTimeout(timeout.current);
    };
  }, []);
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
        new Blob([JSON.stringify(valid, null, 2) + '\n'], { type: 'application/json' }),
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
      const settings = validate(JSON.parse(await f.text()));
      setP(settings);
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
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    try {
      const url = location.origin + location.pathname + shareHash(p);
      if (!navigator.clipboard) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setToast('Link copied — opens with your dimensions');
    } catch {
      setModal('share');
    }
  };
  const reset = () => {
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
        <nav className="nav-pill glass" aria-label="Main navigation">
          <a href="#workspace" className="nav-active">
            Generator
          </a>
          <button onClick={() => setModal('help')}>How it works</button>
          <a href="https://www.josephkaisner.com" target="_blank" rel="noreferrer">
            By Joseph <ArrowUpRight size={13} />
          </a>
        </nav>
        <button className="button glass share-button" onClick={share}>
          <Link2 size={15} />
          <span>Share build</span>
        </button>
      </header>
      <main id="workspace">
        <section className="page-intro">
          <div>
            <div className="eyebrow intro-eyebrow">
              <span /> A LITTLE LESS CAD. A LITTLE MORE MAKING.
            </div>
            <h1>
              Make it <span>fit.</span>
            </h1>
            <p>Your dimensions. Your pulley. Ready for whatever you’re building.</p>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <span>
              Generated on your device.
              <br />
              <strong>No account needed.</strong>
            </span>
          </div>
        </section>
        <div className="workspace-grid">
          <aside className="controls-panel glass">
            <div className="panel-title">
              <div>
                <Settings2 size={18} />
                <h2>Build your pulley</h2>
              </div>
              <span className="units-badge">mm</span>
            </div>
            <form ref={form} onSubmit={generate}>
              <section className="control-section">
                <div className="section-label">
                  <span>01</span>
                  <h3>Tooth profile</h3>
                </div>
                <div className="profile-tabs" role="group" aria-label="HTD belt pitch">
                  {Object.keys(PROFILES).map((profile) => (
                    <button
                      type="button"
                      key={profile}
                      className={p.profile === profile ? 'selected' : ''}
                      aria-pressed={p.profile === profile}
                      onClick={() => set('profile', profile as Profile)}
                    >
                      <span>HTD</span>
                      {profile}
                    </button>
                  ))}
                </div>
                <div className="input-row">
                  {field('teeth', 'Tooth count', { min: 12, max: 240, step: 1, unit: false })}
                  {field('bore', 'Bore diameter', { hint: 'Set to zero for a solid center.' })}
                </div>
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
                    Chamfer & hub
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
                  </div>
                )}
              </section>
              {error && (
                <p role="alert" className="error-message">
                  <CircleHelp size={15} />
                  {error}
                </p>
              )}
              <div className="generate-area">
                <button className="generate-button" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle size={17} className="spin" /> : <BoxIcon />}
                  <span>{busy ? 'Generating pulley…' : 'Generate pulley'}</span>
                  {!busy && <ArrowUpRight size={17} />}
                </button>
                {busy && (
                  <button className="cancel-button" type="button" onClick={cancel}>
                    Cancel generation
                  </button>
                )}
                <div className="settings-actions">
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
          <section className="model-panel glass" aria-label="Pulley preview and downloads">
            <Viewer
              mesh={result?.mesh ?? null}
              busy={busy}
              stage={stage}
              dirty={!!result && dirty}
              label={
                result
                  ? `HTD ${result.parameters.profile} · ${result.parameters.teeth} teeth`
                  : `HTD ${p.profile} · ${p.teeth || '—'} teeth`
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
                <div>
                  <h2>From your screen to your workbench.</h2>
                  <p>
                    {busy
                      ? 'Building the solid on your device…'
                      : dirty && result
                        ? 'Your settings changed. Generate to update the model.'
                        : result
                          ? `One solid · Millimeters · Generated in ${result.seconds.toFixed(1)}s`
                          : 'A solid STEP file, ready to open in Fusion.'}
                  </p>
                </div>
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
        <span>
          Built by{' '}
          <a href="https://www.josephkaisner.com" target="_blank" rel="noreferrer">
            Joseph Kaisner <ArrowUpRight size={12} />
          </a>
        </span>
        <span>For people who make things.</span>
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
        <Modal title="A part you can actually use." onClose={() => setModal(null)}>
          <ol className="help-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Define your pulley.</h3>
                <p>
                  Choose the HTD pitch printed on your belt, then set the tooth count, belt width,
                  and bore. Extra space adds clearance across the whole face.
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
              These nominal HTD 3M, 5M, and 8M profiles use the FreeCAD Gears circular-arc
              construction. Physical belt fit hasn’t been verified here. Print a short test piece
              first. HTD and GT belt profiles are different; 14M and 20M aren’t included.
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
          <p>Copy this link to open PulleyLab with these dimensions.</p>
          <textarea
            className="share-url"
            readOnly
            value={location.origin + location.pathname + shareHash(p)}
            onFocus={(e) => e.target.select()}
          />
        </Modal>
      )}
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
