import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { track } from '@vercel/analytics';
import { zipSync, strToU8 } from 'fflate';
import type { ShapeMesh } from 'replicad';
import Viewer from './Viewer';
import type { Appearance } from '../appearance';
import type { PulleyResult } from '../cad/model';
import type { PulleyPair } from '../cad/ratio';
import { boreLabel, buildData, dimensions, filename, profileLabel } from '../cad/parameters';
import { fileForDownload } from '../paywall/client';
export function pairFilename(pair: PulleyPair) {
  return (
    filename(pair.drive)
      .replace(
        `${pair.drive.teeth}Teeth`,
        `${pair.drive.teeth}T-Drive_${pair.driven.teeth}T-Driven_${Number(pair.ratio.toFixed(4))}to1`,
      )
      .replace(
        boreLabel(pair.drive),
        `${boreLabel(pair.drive, 'Drive')}_${boreLabel(pair.driven, 'Driven')}`,
      ) + '_PAIR.zip'
  );
}
function combinedMesh(drive: PulleyResult, driven: PulleyResult, center: number): ShapeMesh {
  const vertices: number[] = [];
  for (const [mesh, offset] of [
    [drive.mesh, -center / 2],
    [driven.mesh, center / 2],
  ] as const)
    for (let i = 0; i < mesh.vertices.length; i += 3)
      vertices.push(mesh.vertices[i] + offset, mesh.vertices[i + 1], mesh.vertices[i + 2]);
  return {
    vertices,
    normals: [...drive.mesh.normals, ...driven.mesh.normals],
    triangles: [
      ...drive.mesh.triangles,
      ...driven.mesh.triangles.map((i) => i + drive.mesh.vertices.length / 3),
    ],
    faceGroups: [],
  };
}
export default function PairWorkspace({
  pair,
  appearance,
  onAppearanceChange,
  onBusyChange,
  onBack,
  dirty,
  onError,
  beforeDownload,
}: {
  pair: PulleyPair;
  appearance: Appearance;
  onAppearanceChange: (p: Appearance) => void;
  onBusyChange: (busy: boolean) => void;
  onBack: () => void;
  dirty: boolean;
  onError: (message: string) => void;
  beforeDownload: () => Promise<boolean>;
}) {
  const [result, setResult] = useState<{ drive: PulleyResult; driven: PulleyResult } | null>(null),
    [stage, setStage] = useState('Loading CAD engine'),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [active, setActive] = useState<'both' | 'drive' | 'driven'>('both'),
    [packing, setPacking] = useState(false);
  useEffect(() => {
    setResult(null);
    setError('');
    onBusyChange(true);
    const worker = new Worker(new URL('../cad/worker.ts', import.meta.url), { type: 'module' });
    const stop = () => {
      clearTimeout(timer);
      worker.terminate();
      onBusyChange(false);
    };
    const timer = setTimeout(() => {
      stop();
      const message = 'This pair is taking too long. Try fewer teeth or simpler features.';
      setError(message);
      onError(message);
    }, 180000);
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') setStage(e.data.stage);
      if (e.data.type === 'pair-result') {
        setResult({ drive: e.data.drive, driven: e.data.driven });
        track('preview_ready');
        stop();
      }
      if (e.data.type === 'error') {
        setError(e.data.error);
        onError(e.data.error);
        stop();
      }
    };
    worker.onerror = () => {
      const message = 'The CAD engine could not load. Check your connection and retry.';
      setError(message);
      onError(message);
      stop();
    };
    worker.postMessage({ type: 'pair', drive: pair.drive, driven: pair.driven });
    return stop;
  }, [pair, attempt, onBusyChange]);
  const center =
    pair.centerDistance ??
    (dimensions(pair.drive).flange + dimensions(pair.driven).flange) / 2 +
      Math.max(12, dimensions(pair.driven).flange * 0.15);
  const mesh = useMemo(
    () =>
      result
        ? active === 'both'
          ? combinedMesh(result.drive, result.driven, center)
          : result[active].mesh
        : null,
    [result, active, center],
  );
  const busy = !result && !error;
  const download = async () => {
    if (!result || dirty) return;
    if (!(await beforeDownload())) return;
    setPacking(true);
    try {
      const files: Record<string, Uint8Array> = {};
      for (const role of ['drive', 'driven'] as const)
        for (const extension of ['step', 'stl'] as const) {
          const file = await fileForDownload(
            result[role].parameters,
            extension,
            result[role][extension],
          );
          files[role.toUpperCase() + '_' + filename(result[role].parameters, extension)] =
            new Uint8Array(await file.arrayBuffer());
        }
      files['pulleylabs_pair_settings.json'] = strToU8(
        JSON.stringify(
          buildData(pair.drive, appearance, pair.driven, pair.centerDistance),
          null,
          2,
        ),
      );
      files['README.txt'] = strToU8(
        `PulleyLab — drive / driven pulley pair\n\nDrive: ${pair.drive.teeth} teeth\nDriven: ${pair.driven.teeth} teeth\nRatio (driven / drive): ${pair.ratio}\n${pair.centerDistance ? `Nominal shaft spacing: ${pair.centerDistance.toFixed(4)} mm\n` : ''}Each STEP is an independent solid in millimeters, centered on its own shaft.\nPreview spacing is illustrative unless a belt pitch length was specified.\nThe JSON restores both pulleys and their preview finish. Preview colors do not change the exported geometry.\n`,
      );
      const blob = new Blob([zipSync(files, { level: 1 }) as BlobPart], {
          type: 'application/zip',
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = pairFilename(pair);
      a.click();
      track('download_completed');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      onError('Could not package the files. Try downloading again.');
    } finally {
      setPacking(false);
    }
  };
  return (
    <>
      <Viewer
        mesh={mesh}
        appearance={appearance}
        onAppearanceChange={onAppearanceChange}
        busy={busy}
        stage={stage}
        dirty={dirty}
        label={`${profileLabel(pair.drive.profile)} · ${pair.drive.teeth}T drive / ${pair.driven.teeth}T driven`}
        selection={
          <div className="pair-view-tabs" aria-label="Pair preview">
            {(['both', 'drive', 'driven'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={active === value}
                onClick={() => setActive(value)}
              >
                {value === 'both' ? 'Both pulleys' : value === 'drive' ? 'Drive' : 'Driven'}
              </button>
            ))}
            <button type="button" onClick={onBack}>
              Single pulley ↗
            </button>
          </div>
        }
      />
      <div className="export-dock glass">
      <div className="dimension-grid pair-metrics">
        {[
          { label: 'Actual ratio', value: `${Number(pair.ratio.toFixed(4))}:1` },
          { label: 'Drive OD', value: dimensions(pair.drive).outside.toFixed(2) + ' mm' },
          { label: 'Driven OD', value: dimensions(pair.driven).outside.toFixed(2) + ' mm' },
          {
            label: pair.centerDistance ? 'Shaft spacing' : 'Belt width',
            value: pair.centerDistance
              ? pair.centerDistance.toFixed(2) + ' mm'
              : pair.drive.belt_width + ' mm',
          },
        ].map((d) => (
          <div key={d.label}>
            <span>{d.label}</span>
            <strong>{d.value}</strong>
          </div>
        ))}
      </div>
      <div className="export-section">
        <div className="export-heading">
          <div>
            <p>
              {error
                ? 'Pair generation failed.'
                : dirty
                  ? 'Settings changed. Select and generate an updated pair.'
                  : busy
                    ? stage
                    : pair.centerDistance
                      ? 'Nominal spacing shown · allow for belt tension adjustment'
                      : 'Two independent solids · preview spacing is illustrative'}
            </p>
            {error && !result && (
              <button type="button" className="retry-pair" onClick={() => setAttempt((v) => v + 1)}>
                Retry pair
              </button>
            )}
          </div>
        </div>
        <div className="export-buttons">
          <button
            type="button"
            className="download-button"
            disabled={!result || dirty || packing}
            onClick={download}
          >
            <Download size={17} />
            {packing ? 'Packing files…' : 'Download pair ZIP'}
          </button>
        </div>
        <div className="file-label">
          <span>2 STEP + 2 STL + SETTINGS</span>
          <code>{pairFilename(pair)}</code>
        </div>
      </div>
      </div>
    </>
  );
}
