import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only these fixed repository paths are read or written. There is no delete step.
const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'apps', 'demo', 'dist');
const output = path.join(root, '.vercel', 'output');
const staticRoot = path.join(output, 'static');
const notices = path.join(root, 'THIRD-PARTY-NOTICES.md');

function assertInsideRoot(candidate) {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Repository path boundary rejected: ${candidate}`);
  }
}

async function inspect(candidate) {
  assertInsideRoot(candidate);
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${candidate}`);
  if ((await realpath(candidate)) !== candidate) {
    throw new Error(`Resolved path differs from the fixed repository path: ${candidate}`);
  }
  return info;
}

async function optionalInfo(candidate) {
  try {
    return await inspect(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function gatherFiles(directory, result = []) {
  const info = await inspect(directory);
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${directory}`);
  for (const name of (await readdir(directory)).sort()) {
    const candidate = path.join(directory, name);
    const entry = await inspect(candidate);
    if (entry.isDirectory()) await gatherFiles(candidate, result);
    else if (entry.isFile()) {
      if (/\.map$/i.test(name)) throw new Error(`Source map must not be published: ${candidate}`);
      result.push(candidate);
    } else throw new Error(`Only regular files and directories are allowed: ${candidate}`);
  }
  return result;
}

try {
  for (const candidate of [path.join(root, 'apps'), path.join(root, 'apps', 'demo')]) {
    if (!(await inspect(candidate)).isDirectory())
      throw new Error(`Expected directory: ${candidate}`);
  }
  const files = await gatherFiles(dist);
  if (!files.includes(path.join(dist, 'index.html')))
    throw new Error('Build is missing dist/index.html. Run npm run build first.');
  if (files.includes(path.join(dist, 'THIRD-PARTY-NOTICES.txt'))) {
    throw new Error('The build already contains the reserved THIRD-PARTY-NOTICES.txt path.');
  }
  if (!(await inspect(notices)).isFile())
    throw new Error('THIRD-PARTY-NOTICES.md must be a regular file.');
  const vercel = path.join(root, '.vercel');
  const vercelInfo = await optionalInfo(vercel);
  if (vercelInfo && !vercelInfo.isDirectory()) throw new Error('.vercel must be a directory.');
  if (await optionalInfo(output)) {
    throw new Error(
      '.vercel/output already exists. Preserve the previous release evidence and manually clear only that verified directory before preparing another release.',
    );
  }

  if (!vercelInfo) await mkdir(vercel);
  await inspect(vercel);
  await mkdir(output);
  await inspect(output);
  await mkdir(staticRoot);
  for (const source of files) {
    const destination = path.join(staticRoot, path.relative(dist, source));
    assertInsideRoot(destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
  await copyFile(
    notices,
    path.join(staticRoot, 'THIRD-PARTY-NOTICES.txt'),
    constants.COPYFILE_EXCL,
  );
  await writeFile(
    path.join(output, 'config.json'),
    `${JSON.stringify({ version: 3, routes: [{ src: '/(.*)', headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }, continue: true }, { handle: 'filesystem' }] }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  console.log(
    `Prepared .vercel/output: ${files.length + 1} static files plus config.json. No upload was performed.`,
  );
} catch (error) {
  console.error(`Release preparation failed: ${error.message}`);
  process.exitCode = 1;
}
