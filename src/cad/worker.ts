import initOpenCascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import { generateFiles } from './model';
const ready = initOpenCascade({ locateFile: () => wasmUrl }).then((oc) => setOC(oc));
self.onmessage = async (event: MessageEvent) => {
  try {
    self.postMessage({ type: 'progress', stage: 'Loading CAD engine' });
    await ready;
    self.postMessage({ type: 'progress', stage: 'Building your solid' });
    const result = generateFiles(event.data);
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error:
        error instanceof Error
          ? error.message
          : 'The CAD engine could not build this pulley. Try simpler dimensions.',
    });
  }
};
