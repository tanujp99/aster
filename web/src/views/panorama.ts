import { h, fmtBytes, progressBar } from '../ui/dom';
import { pickPhotos, imagesOnly, sortByName, saveBlob, stamp, chooseOutputFolder, canPickFolder, outputFolderName } from '../lib/files';
import { helperHealth, helperStitch } from '../lib/helper';
import { browserPanorama } from '../engine/run';
import { openInViewer } from './viewer';

export function panoramaView(): HTMLElement {
  let files: File[] = [];
  let helperOk = false;

  const list = h('div', { class: 'thumbs' });
  const count = h('span', { class: 'muted' }, 'No photos yet');
  const prog = progressBar();
  const status = h('p', { class: 'status' });
  const result = h('div', { class: 'result' });

  const engineSel = h('select', { id: 'engine' },
    h('option', { value: 'browser' }, 'This browser'),
    h('option', { value: 'helper' }, 'Local helper (full resolution)'),
  ) as HTMLSelectElement;
  const sizeSel = h('select', { id: 'size' },
    h('option', { value: '40' }, 'Up to 40 MP'),
    h('option', { value: '80', selected: true }, 'Up to 80 MP'),
    h('option', { value: '160' }, 'Up to 160 MP (needs lots of RAM)'),
  ) as HTMLSelectElement;
  const quality = h('input', { type: 'range', min: 80, max: 100, value: 95, id: 'q' }) as HTMLInputElement;
  const qLabel = h('span', { class: 'mono' }, '95');
  quality.oninput = () => (qLabel.textContent = quality.value);
  const outLabel = h('span', { class: 'mono' }, outputFolderName() ?? 'Downloads');

  const setFiles = (fs: File[]) => {
    files = sortByName(imagesOnly(fs));
    list.replaceChildren(...files.map((f, i) => {
      const img = h('img', { alt: f.name, loading: 'lazy' }) as HTMLImageElement;
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      return h('figure', {}, img, h('figcaption', {}, `${i + 1}`));
    }));
    const total = files.reduce((s, f) => s + f.size, 0);
    count.textContent = files.length ? `${files.length} photos · ${fmtBytes(total)} · in name order` : 'No photos yet';
    go.disabled = files.length < 2;
  };

  const drop = h('div', { class: 'drop' },
    h('p', {}, h('strong', {}, 'Drop your overlapping photos here')),
    h('p', { class: 'muted' }, 'Shot left-to-right or right-to-left, ~30% overlap. They stay on this device.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => setFiles(await pickPhotos()) }, 'Choose photos'),
      h('button', { class: 'btn ghost', onclick: async () => setFiles(await pickPhotos({ folder: true })) }, 'Choose a folder'),
    ),
  );
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    setFiles(Array.from(e.dataTransfer?.files ?? []));
  });

  const go = h('button', { class: 'btn primary', disabled: true, onclick: () => run() }, 'Stitch panorama') as HTMLButtonElement;

  async function run() {
    go.disabled = true;
    result.replaceChildren();
    status.textContent = '';
    const t0 = performance.now();
    try {
      let blob: Blob, w = 0, hgt = 0, note = '';
      if (engineSel.value === 'helper') {
        prog.set('Sending photos to the local helper', 0.02);
        blob = await helperStitch(files, files.map((f) => f.name), 'panorama', (job) => {
          const last = job.log[job.log.length - 1] ?? job.status;
          prog.set(`Helper: ${last.replace(/^\d\d:\d\d:\d\d /, '')}`, job.status === 'done' ? 1 : 0.5);
        }, undefined, Number(quality.value));
        note = 'Hugin, full resolution';
      } else {
        const r = await browserPanorama(files, { maxMegapixels: Number(sizeSel.value) }, Number(quality.value) / 100,
          (s, f) => prog.set(s, f));
        blob = r.blob; w = r.width; hgt = r.height;
        note = `${r.info.sweepDeg.toFixed(0)}° sweep · lens ${r.info.hfovDeg.toFixed(1)}° · ${(r.info.scale * 100).toFixed(0)}% of native`;
      }
      const name = `panorama_${stamp()}.jpg`;
      const where = await saveBlob(blob, name);
      prog.hide();
      const secs = ((performance.now() - t0) / 1000).toFixed(0);
      const url = URL.createObjectURL(blob);
      const img = h('img', { src: url, alt: 'Stitched panorama' });
      img.onload = () => {
        w ||= (img as HTMLImageElement).naturalWidth; hgt ||= (img as HTMLImageElement).naturalHeight;
        meta.textContent = `${w.toLocaleString()} × ${hgt.toLocaleString()} px · ${fmtBytes(blob.size)} · ${note} · ${secs}s`;
      };
      const meta = h('p', { class: 'muted' });
      result.replaceChildren(
        h('div', { class: 'pano-strip' }, img), meta,
        h('p', {}, 'Saved to ', h('span', { class: 'mono' }, where)),
        h('button', { class: 'btn', onclick: () => openInViewer(blob, name) }, 'Open in viewer'),
      );
    } catch (e) {
      prog.hide();
      status.textContent = e instanceof Error ? e.message : String(e);
      status.classList.add('error');
    } finally {
      go.disabled = files.length < 2;
    }
  }

  helperHealth().then((s) => {
    helperOk = !!s?.ok;
    (engineSel.options[1] as HTMLOptionElement).disabled = !helperOk;
    if (helperOk) engineSel.value = 'helper';
    sizeRow.hidden = engineSel.value !== 'browser';
  });
  const sizeRow = h('label', {}, 'Output size', sizeSel);
  engineSel.onchange = () => (sizeRow.hidden = engineSel.value !== 'browser');

  return h('section', { class: 'view' },
    h('header', { class: 'view-head' },
      h('h1', {}, 'Panorama'),
      h('p', { class: 'lead' }, 'Stitch a handheld sweep into one wide image. Alignment, horizon levelling, exposure matching and seam blending run locally.'),
    ),
    drop,
    h('div', { class: 'bar' }, count),
    list,
    h('div', { class: 'controls' },
      h('label', {}, 'Engine', engineSel),
      sizeRow,
      h('label', {}, 'JPEG quality ', qLabel, quality),
      h('label', {}, 'Save to ', outLabel,
        canPickFolder()
          ? h('button', { class: 'btn ghost small', onclick: async () => { outLabel.textContent = (await chooseOutputFolder()) ?? 'Downloads'; } }, 'Choose folder')
          : null),
      go,
    ),
    prog.el, status, result,
  );
}
