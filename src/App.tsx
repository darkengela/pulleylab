import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FolderOpen,
  Link2,
  LoaderCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { track } from '@vercel/analytics';
import Viewer from './components/Viewer';
import RatioPlanner from './components/RatioPlanner';
import PairWorkspace from './components/PairWorkspace';
import type { PulleyPair } from './cad/ratio';
import type { Appearance } from './appearance';
import {
  DEFAULTS,
  PROFILES,
  SCREWS,
  dimensions,
  filename,
  lighteningStatus,
  profileLabel,
  shaftFeatureError,
  readInitial,
  parseBuild,
  buildData,
  shareHash,
  validate,
} from './cad/parameters';
import type { Parameters, Profile, ScrewSize } from './cad/parameters';
import type { PulleyResult } from './cad/model';
import { claimSession, recoverPurchase, startCheckout, verifyDownload } from './paywall/client';
type NumberKey = Exclude<
  keyof Parameters,
  | 'profile'
  | 'flanges'
  | 'd_shaft'
  | 'lightening'
  | 'set_screw'
  | 'set_screw_size'
  | 'split_clamp'
  | 'split_clamp_screw'
>;
type Notice = { id: number; text: string };
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
function ErrorToast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.showPopover();
    return () => {
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [notice.id]);
  return (
    <div ref={ref} className="error-toast" role="alert" popover="manual">
      <p>{notice.text}</p>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
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
    [errorNotice, setErrorNotice] = useState<Notice | null>(
      initial.message ? { id: 1, text: initial.message } : null,
    ),
    [toast, setToast] = useState(''),
    [modal, setModal] = useState<'help' | 'share' | 'checkout' | 'recover' | null>(null),
    [checkoutDesign, setCheckoutDesign] = useState<Parameters | null>(null),
    [checkoutNote, setCheckoutNote] = useState(''),
    [checkoutBusy, setCheckoutBusy] = useState(false),
    [recoverEmail, setRecoverEmail] = useState(''),
    [recoverProof, setRecoverProof] = useState(''),
    [plannerOpen, setPlannerOpen] = useState(false),
    [task, setTask] = useState<null | 'details' | 'retainer' | 'clamp'>(null),
    [sheetBox, setSheetBox] = useState({ left: 12, top: 68, width: 392 });
  const form = useRef<HTMLFormElement>(null),
    file = useRef<HTMLInputElement>(null),
    detailsTab = useRef<HTMLButtonElement>(null),
    retainerTab = useRef<HTMLButtonElement>(null),
    clampTab = useRef<HTMLButtonElement>(null),
    ratioTab = useRef<HTMLButtonElement>(null),
    sheet = useRef<HTMLDivElement>(null),
    worker = useRef<Worker | null>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    run = useRef(0),
    errorSeq = useRef(1);
  const dirty = !result || JSON.stringify(p) !== JSON.stringify(result.parameters),
    canDownload = !!result && !dirty && !busy,
    d = dimensions(p),
    blocking = shaftFeatureError(p) || lighteningStatus(p);
  const showError = (text: string) => setErrorNotice({ id: ++errorSeq.current, text });
  const set = (key: keyof Parameters, value: number | string) => {
    setP((old) => ({ ...old, [key]: value }));
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
      showError((e as Error).message);
      return;
    }
    setPair(null);
    cancel();
    const id = ++run.current;
    setBusy(true);
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
        track('preview_ready');
        try {
          localStorage.setItem('pulleylab:settings:v1', JSON.stringify(settings));
        } catch {}
        finish();
      }
      if (data.type === 'error') {
        showError(data.error);
        finish();
      }
    };
    w.onerror = () => {
      if (id !== run.current) return;
      showError('The CAD engine could not load. Check your connection and try again.');
      finish();
    };
    timeout.current = setTimeout(() => {
      if (id === run.current) {
        finish();
        showError('This build is taking too long on this device. Try fewer teeth or a simpler pulley.');
      }
    }, 90000);
    w.postMessage(settings);
  }
  useEffect(() => {
    const bar = form.current;
    if (!bar) return;
    const apply = () => {
      document.documentElement.style.setProperty(
        '--chrome-top',
        `${Math.ceil(bar.getBoundingClientRect().height) + 22}px`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!task && !plannerOpen) return;
    const close = () => {
      setTask(null);
      setPlannerOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (form.current?.contains(target) || sheet.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [task, plannerOpen]);
  useLayoutEffect(() => {
    const button =
      task === 'details'
        ? detailsTab.current
        : task === 'retainer'
          ? retainerTab.current
          : task === 'clamp'
            ? clampTab.current
            : plannerOpen
              ? ratioTab.current
              : null;
    if (!button) return;
    const place = () => {
      const rect = button.getBoundingClientRect();
      const barBottom = form.current?.getBoundingClientRect().bottom ?? rect.bottom;
      const margin = 12;
      const width = Math.min(plannerOpen && !task ? 440 : 392, window.innerWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - margin - width));
      const top = barBottom + 8;
      setSheetBox((old) =>
        old.left === left && old.top === top && old.width === width ? old : { left, top, width },
      );
    };
    place();
    const bar = form.current;
    bar?.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      bar?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [task, plannerOpen]);
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
  useEffect(() => {
    if (!errorNotice) return;
    const id = errorNotice.id;
    const t = setTimeout(() => setErrorNotice((current) => (current?.id === id ? null : current)), 10000);
    return () => clearTimeout(t);
  }, [errorNotice]);
  useEffect(() => {
    if (!blocking) return;
    setErrorNotice((current) => (current?.text === blocking ? current : { id: ++errorSeq.current, text: blocking }));
  }, [blocking]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get('checkout');
    const sessionId = params.get('session_id');
    if (!checkout) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (checkout === 'canceled') {
      setToast('Checkout canceled. This design stays locked.');
      return;
    }
    if (checkout !== 'success' || !sessionId) return;
    let stop = false;
    (async () => {
      for (let attempt = 0; attempt < 5 && !stop; attempt++) {
        if (await claimSession(sessionId)) {
          setToast('Payment received. You can download this design.');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!stop) setToast('Payment is not confirmed yet. Downloads stay locked.');
    })();
    return () => {
      stop = true;
    };
  }, []);
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
          form="build"
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
  const openCheckout = (design: Parameters, note = '') => {
    setCheckoutDesign(design);
    setCheckoutNote(note);
    setModal('checkout');
  };
  const authorize = async (designs: Parameters[], note = '') => {
    track('export_click');
    for (const design of designs) {
      const verdict = await verifyDownload(design);
      if (verdict === 'offline') {
        showError('Could not verify this purchase. The download stays locked.');
        return false;
      }
      if (verdict === 'expired') {
        showError('This download link expired. Recover the purchase with the checkout email.');
        setModal('recover');
        return false;
      }
      if (verdict !== 'allowed') {
        openCheckout(design, note);
        return false;
      }
    }
    return true;
  };
  const exportFile = async (type: 'step' | 'stl') => {
    if (!canDownload || !result) return;
    if (!(await authorize([result.parameters]))) return;
    saveFile(result[type], filename(result.parameters, type));
    track('download_completed');
    setToast(`${type.toUpperCase()} downloaded`);
  };
  const continueCheckout = async () => {
    if (!checkoutDesign || checkoutBusy) return;
    setCheckoutBusy(true);
    try {
      track('checkout_started');
      location.assign(await startCheckout(checkoutDesign));
    } catch (e) {
      showError((e as Error).message);
      setCheckoutBusy(false);
    }
  };
  const submitRecovery = async () => {
    const proof = recoverProof.trim();
    try {
      const result = await recoverPurchase(
        recoverEmail,
        proof.startsWith('cs_') ? { sessionId: proof } : proof ? { code: proof } : {},
      );
      if (result.grants?.length) {
        setModal(null);
        setToast('Purchase restored. You can download the unlocked design.');
        return;
      }
      showError(result.error || 'That purchase could not be verified.');
    } catch (e) {
      showError((e as Error).message);
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
      showError((e as Error).message);
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
      setErrorNotice(null);
      setToast('Settings loaded. Generate to update your pulley.');
    } catch (e) {
      showError((e as Error).message);
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
      showError((e as Error).message);
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
    setErrorNotice(null);
    setToast('8M starter settings restored');
  };
  const screwSelect = (label: string, key: 'set_screw_size' | 'split_clamp_screw') => (
    <label className="field">
      <span>{label}</span>
      <div className="select-shell">
        <select form="build" aria-label={label} value={p[key]} onChange={(e) => set(key, e.target.value)}>
          {(Object.keys(SCREWS) as ScrewSize[]).map((size) => (
            <option key={size} value={size}>
              {size} · {SCREWS[size].major} mm × {SCREWS[size].pitch} mm
            </option>
          ))}
        </select>
        <ChevronDown size={15} />
      </div>
    </label>
  );
  const openTask = (next: 'details' | 'retainer' | 'clamp') => {
    setPlannerOpen(false);
    setTask((current) => (current === next ? null : next));
  };
  const detailStatus = `${Number.isFinite(p.teeth) ? p.teeth : '—'}T · ${
    Number.isFinite(p.belt_width) ? `${mm(p.belt_width)} mm` : '—'
  }`;
  return (
    <>
      <div className="world-background" aria-hidden="true">
        <div className="particle-field" />
        <div className="light-field" />
        <div className="background-scrim" />
      </div>
      <form id="ratio-requirements" hidden onSubmit={(e) => e.preventDefault()} />
      <form ref={form} id="build" className="tool-bar glass" onSubmit={generate}>
        <a href={location.pathname} className="brand-link" aria-label="PulleyLab home">
          <Logo />
        </a>
        <div className="select-shell tool-profile">
          <select
            aria-label="Pulley type"
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
        <div className="task-tabs" role="group" aria-label="Pulley settings">
          <button
            ref={detailsTab}
            type="button"
            className="task-tab"
            aria-expanded={task === 'details'}
            aria-controls={task === 'details' ? 'task-panel' : undefined}
            onClick={() => openTask('details')}
          >
            Details
            <small>{detailStatus}</small>
          </button>
          <button
            ref={retainerTab}
            type="button"
            className="task-tab"
            aria-expanded={task === 'retainer'}
            aria-controls={task === 'retainer' ? 'task-panel' : undefined}
            onClick={() => openTask('retainer')}
          >
            Retainer
            <small>{p.d_shaft ? 'D-shaft' : 'Round'}</small>
          </button>
          <button
            ref={clampTab}
            type="button"
            className="task-tab"
            aria-expanded={task === 'clamp'}
            aria-controls={task === 'clamp' ? 'task-panel' : undefined}
            onClick={() => openTask('clamp')}
          >
            Clamp
            <small>{p.split_clamp ? 'On' : 'Off'}</small>
          </button>
        </div>
        <div
          className="live-od"
          aria-live="polite"
          title={`Tooth-tip OD. ${p.flanges !== 'none' && Number.isFinite(d.flange) ? `Flange OD: ${d.flange.toFixed(2)} mm.` : ''}`}
        >
          <span>OD</span>
          <output aria-label="Live pulley outside diameter">
            {Number.isFinite(d.outside) ? d.outside.toFixed(2) : '—'} <small>mm</small>
          </output>
        </div>
        <button
          ref={ratioTab}
          type="button"
          className="tool-popover-button"
          aria-expanded={plannerOpen}
          aria-controls={plannerOpen ? 'task-panel' : undefined}
          onClick={() => {
            setTask(null);
            setPlannerOpen((open) => !open);
          }}
        >
          Drive ratio
        </button>
        <div className="tool-generate">
          <button className="generate-button" type="submit" disabled={busy || pairBusy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <BoxIcon />}
            <span>{pairBusy ? 'Generating pair…' : busy ? 'Generating…' : 'Generate'}</span>
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
              Cancel
            </button>
          )}
        </div>
        <div className="tool-icons">
          <button className="icon-button" type="button" onClick={share} aria-label="Share build" title="Share">
            <Link2 size={16} />
          </button>
          <button className="icon-button" type="button" onClick={saveSettings} aria-label="Save" title="Save">
            <Download size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => file.current?.click()}
            aria-label="Load"
            title="Load"
          >
            <FolderOpen size={16} />
          </button>
          <button className="icon-button" type="button" onClick={reset} aria-label="Reset" title="Reset">
            <RotateCcw size={16} />
          </button>
        </div>
        <input
          ref={file}
          type="file"
          hidden
          accept="application/json,.json"
          onChange={(e) => loadSettings(e.target.files?.[0])}
        />
      </form>
      {(task || plannerOpen) && (
        <div
          ref={sheet}
          id="task-panel"
          className="task-panel glass"
          role="region"
          aria-labelledby="task-panel-title"
          style={{
            left: sheetBox.left,
            top: sheetBox.top,
            width: sheetBox.width,
            maxHeight: `min(60vh, calc(100dvh - ${Math.ceil(sheetBox.top + 12)}px))`,
          }}
        >
          <h2 id="task-panel-title" className="task-panel-heading">
            {task === 'details'
              ? 'Details'
              : task === 'retainer'
                ? 'Retainer'
                : task === 'clamp'
                  ? 'Clamp'
                  : 'Drive ratio'}
          </h2>
          {task === 'details' && (
            <div className="panel-grid">
              {field('teeth', 'Teeth', { min: 12, max: 240, step: 1, unit: false })}
              {field('belt_width', 'Belt width', { min: 0.5, max: 200 })}
              {field('clearance', 'Clearance', {
                max: 10,
                hint: 'Total extra space across the face; not per side.',
              })}
              <label className="field">
                <span>Flanges</span>
                <div className="select-shell">
                  <select
                    form="build"
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
              </label>
              {p.flanges !== 'none' &&
                field('flange_thickness', 'Thickness', { min: 0.2, max: 15 })}
              {p.flanges !== 'none' &&
                field('flange_overhang', 'Overhang', {
                  min: 0.2,
                  max: 20,
                  hint: 'Radial distance beyond the tooth tips.',
                })}
              {p.flanges !== 'none' && field('chamfer', 'Chamfer', { max: 5 })}
              {field('hub_diameter', 'Hub diameter')}
              {field('hub_length', 'Hub length', {
                max: 100,
                hint: 'Extends from the bottom. Leave at 0 to omit the hub.',
              })}
              <label className="field">
                <span>Lightening</span>
                <div className="select-shell">
                  <select
                    form="build"
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
              </label>
              {p.lightening !== 'off' &&
                field('wall', 'Minimum wall', {
                  min: 0.2,
                  max: 40,
                  hint: 'Material left at the bore and under the tooth roots.',
                })}
            </div>
          )}
          {task === 'retainer' && (
            <div className="panel-grid">
              <div className="profile-tabs bore-mode panel-span" role="group" aria-label="Bore shape">
                <button
                  type="button"
                  className={p.d_shaft ? '' : 'selected'}
                  aria-pressed={!p.d_shaft}
                  onClick={() => setDShaft(false)}
                >
                  Round
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
              {p.d_shaft
                ? field('d_diameter', 'Diameter', {
                    hint: 'Full round diameter of the D-shaft, in millimeters.',
                  })
                : field('bore', 'Bore', { hint: 'Set to zero for a solid center.' })}
              {p.d_shaft &&
                field('d_flat', 'Flat', {
                  hint: 'Distance from the flat face to the opposite point on the circle.',
                })}
              <div className="panel-span">
                <BoreDiagram
                  dShaft={p.d_shaft}
                  diameter={p.d_shaft ? p.d_diameter : p.bore}
                  flat={p.d_flat}
                />
              </div>
              <div className="profile-tabs bore-mode panel-span" role="group" aria-label="Set screw">
                <button
                  type="button"
                  className={p.set_screw ? '' : 'selected'}
                  aria-pressed={!p.set_screw}
                  onClick={() => setP((old) => ({ ...old, set_screw: false }))}
                >
                  Off
                </button>
                <button
                  type="button"
                  className={p.set_screw ? 'selected' : ''}
                  aria-pressed={p.set_screw}
                  onClick={() => setP((old) => ({ ...old, set_screw: true }))}
                >
                  Set screw
                </button>
              </div>
              {p.set_screw && field('set_screw_height', 'Height', { min: 0.2, max: 80 })}
              {p.set_screw && field('set_screw_wall', 'Wall', { min: 0.2, max: 40 })}
              {p.set_screw && screwSelect('Size', 'set_screw_size')}
            </div>
          )}
          {task === 'clamp' && (
            <div className="panel-grid">
              <div className="profile-tabs bore-mode panel-span" role="group" aria-label="Split clamp">
                <button
                  type="button"
                  className={p.split_clamp ? '' : 'selected'}
                  aria-pressed={!p.split_clamp}
                  onClick={() => setP((old) => ({ ...old, split_clamp: false }))}
                >
                  Off
                </button>
                <button
                  type="button"
                  className={p.split_clamp ? 'selected' : ''}
                  aria-pressed={p.split_clamp}
                  onClick={() => setP((old) => ({ ...old, split_clamp: true }))}
                >
                  Split clamp
                </button>
              </div>
              {p.split_clamp && field('split_clamp_length', 'Length', { min: 0.2, max: 80 })}
              {p.split_clamp && field('split_clamp_wall', 'Wall', { min: 0.2, max: 40 })}
              {p.split_clamp && screwSelect('Screw', 'split_clamp_screw')}
            </div>
          )}
          {plannerOpen && !task && (
            <RatioPlanner
              open
              parameters={p}
              busy={busy || pairBusy}
              onGenerate={(selected) => {
                setP(selected.drive);
                setPair(selected);
                setPlannerOpen(false);
              }}
            />
          )}
        </div>
      )}
      <main id="workspace">
        <section className="model-workspace" aria-label="Pulley preview and downloads">
          {pair ? (
            <PairWorkspace
              pair={pair}
              appearance={appearance}
              onAppearanceChange={setAppearance}
              onBusyChange={setPairBusy}
              onBack={() => setPair(null)}
              dirty={JSON.stringify(p) !== JSON.stringify(pair.drive)}
              onError={showError}
              beforeDownload={() =>
                authorize(
                  [pair.drive, pair.driven],
                  'A pair is two designs. $5 unlocks one profile and tooth count.',
                )
              }
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
              <div className="export-dock glass">
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
                  <button type="button" className="recover-link" onClick={() => setModal('recover')}>
                    Recover a purchase
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <button type="button" onClick={() => setModal('help')}>
          How it works
        </button>
        <Link to="/htd-profiles">Profiles</Link>
        <Link to="/d-shaft">D-shaft</Link>
        <Link to="/download">Download</Link>
        <a href="/NOTICE.txt" target="_blank" rel="noreferrer">
          Source & licenses
        </a>
      </footer>
      {errorNotice && (
        <ErrorToast
          key={errorNotice.id}
          notice={errorNotice}
          onDismiss={() => setErrorNotice(null)}
        />
      )}
      {toast && (
        <div className="toast glass" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === 'checkout' && checkoutDesign && (
        <Modal title="Unlock this design" onClose={() => setModal(null)}>
          <p className="pay-price">$5</p>
          <p>
            One profile and tooth count ({profileLabel(checkoutDesign.profile)}, {checkoutDesign.teeth}{' '}
            teeth), including STEP and STL. Download it again anytime. For 7 days you can change the
            bore, D-shaft flat, and clearance on this design.
          </p>
          {checkoutNote && <p>{checkoutNote}</p>}
          <button
            className="download-button"
            type="button"
            disabled={checkoutBusy}
            onClick={continueCheckout}
          >
            {checkoutBusy ? 'Opening checkout…' : 'Continue to checkout'}
          </button>
        </Modal>
      )}
      {modal === 'recover' && (
        <Modal title="Recover a purchase" onClose={() => setModal(null)}>
          <p>
            Enter the email Stripe collected. Add the Checkout session id (cs_…) or a recovery code.
            An email by itself does not unlock a design.
          </p>
          <label className="field">
            <span>Email</span>
            <div className="input-shell">
              <input
                type="email"
                aria-label="Checkout email"
                value={recoverEmail}
                onChange={(e) => setRecoverEmail(e.target.value)}
                required
              />
            </div>
          </label>
          <label className="field">
            <span>Session id or code</span>
            <div className="input-shell">
              <input
                aria-label="Checkout session id or recovery code"
                value={recoverProof}
                onChange={(e) => setRecoverProof(e.target.value)}
              />
            </div>
          </label>
          <button className="download-button" type="button" onClick={submitRecovery}>
            Verify purchase
          </button>
        </Modal>
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
                  Extra space adds clearance across the whole face. Chamfer, hub, and lightening sit
                  with the type details. The retainer holds the D-shaft and set screw. The clamp is
                  the split collar.
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
