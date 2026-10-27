/* eslint-disable no-empty -- expected errors and readiness probes */
// Evaluated inside a real browser. All inputs are frozen, synthetic fixtures.
export async function coreScenario({ scenario, fixture, apiUrl }) {
  const api = await import(/* @vite-ignore */ apiUrl);
  const bytes = (name) => Uint8Array.from(atob(fixture[name]), (c) => c.charCodeAt(0));
  const sha = async (b) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  const blob = (name, type) => new Blob([bytes(name)], { type });
  const red = blob('red.png', 'image/png'),
    blue = blob('blue.png', 'image/png'),
    green = blob('green.png', 'image/png');
  const ttf = blob('sample.ttf', 'font/ttf'),
    otf = blob('sample.otf', 'font/otf');
  const hashes = await Promise.all([red, blue, green, ttf, otf].map(sha));
  const [r, b, g, f, o] = hashes;
  const doc = structuredClone(fixture.document);
  const templates = structuredClone(fixture.templates.slice(0, 2));
  const fonts = [
    { id: 'font-ttf', name: 'sample.ttf', sha256: f, mimeType: 'font/ttf' },
    { id: 'font-otf', name: 'sample.otf', sha256: o, mimeType: 'font/otf' },
  ];
  const input = {
    current: { document: doc, preview: red },
    templates,
    resources: [
      { id: 'resource-red', name: '빨강 원본', sha256: r, folders: ['내 폴더'] },
      { id: 'resource-green', name: '미사용 자원', sha256: g },
    ],
    fonts,
    files: new Map([
      [r, red],
      [g, green],
      [f, ttf],
      [o, otf],
    ]),
  };
  const asset = (id, hash, body) => ({
    id,
    sha256: hash,
    mimeType: 'image/png',
    byteLength: body.size,
    pixelWidth: 8,
    pixelHeight: 8,
  });
  const attach = (d, id, hash, body) => {
    d.assets.push(asset(id, hash, body));
    d.panels[0].background.imageAssetId = id;
  };
  if (scenario === '101') input.templates = structuredClone(fixture.templates);
  if (scenario === 'shared') {
    attach(doc, 'image-red', r, red);
    attach(templates[0].document, 'image-red', r, red);
    attach(templates[1].document, 'image-blue', b, blue);
    input.files.set(b, blue);
  }
  if (scenario === 'names') {
    templates[0].name = templates[1].name = '../같은 이름';
    input.resources[0].name = '../../한글 파일.png';
  }
  const state = () =>
    JSON.stringify({
      doc: input.current.document,
      templates: input.templates,
      resources: input.resources,
      fonts: input.fonts,
    });
  if (scenario === 'invalid-font') {
    const before = JSON.stringify(await api.listPersonalFonts());
    let rejected = false;
    try {
      await api.importPersonalFont(
        new File([bytes('invalid.ttf')], 'invalid.ttf', { type: 'font/ttf' }),
      );
    } catch {
      rejected = true;
    }
    return { rejected, unchanged: before === JSON.stringify(await api.listPersonalFonts()) };
  }
  if (scenario === 'missing') {
    attach(doc, 'image-red', r, red);
    const before = state();
    input.files.delete(r);
    let missing = false,
      corrupt = false;
    try {
      await api.createArchive(input);
    } catch {
      missing = true;
    }
    input.files.set(r, blue);
    try {
      await api.createArchive(input);
    } catch {
      corrupt = true;
    }
    return { missing, corrupt, unchanged: before === state() };
  }
  if (scenario === 'limits') {
    api.validateArchiveSize([100000000]);
    let over = false,
      negative = false,
      largeFont = false;
    try {
      api.validateArchiveSize([100000000, 1]);
    } catch {
      over = true;
    }
    try {
      api.validateArchiveSize([-1]);
    } catch {
      negative = true;
    }
    const padded = new Uint8Array(10000000);
    padded.set(bytes('sample.ttf'));
    await api.importPersonalFont(new File([padded], 'boundary.ttf', { type: 'font/ttf' }));
    try {
      await api.importPersonalFont(
        new File([padded, new Uint8Array(1)], 'over.ttf', { type: 'font/ttf' }),
      );
    } catch {
      largeFont = true;
    }
    input.resources = [];
    input.fonts = [];
    input.files = new Map();
    for (let i = 0; i < 11; i++) {
      const body = new Uint8Array(9100000);
      body.set(bytes('red.png'));
      body[body.length - 1] = i;
      const image = new Blob([body], { type: 'image/png' }),
        hash = await sha(image);
      input.resources.push({ id: `large-${i}`, name: `large-${i}.png`, sha256: hash });
      input.files.set(hash, image);
    }
    let archive = false;
    try {
      await api.createArchive(input);
    } catch (error) {
      archive = /100|용량|크기|limit|size/i.test(error.message);
    }
    return { over, negative, largeFont, archive };
  }
  const before = state();
  const result = await api.createArchive(input);
  const buffer = new Uint8Array(await result.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 8192)
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  return { base64: btoa(binary), unchanged: before === state(), hashes };
}
