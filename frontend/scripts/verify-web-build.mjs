import fs from 'node:fs';
import path from 'node:path';

const distDirectory = path.resolve(process.argv[2] ?? 'dist');
const indexPath = path.join(distDirectory, 'index.html');
const versionPath = path.join(distDirectory, 'version.json');

const buildInfo = readJson(versionPath);
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const metadata = readBuildMetadata(indexHtml);

assertBuildInfo(buildInfo, 'version.json');
assertBuildInfo(metadata, 'index.html metadata');

if (buildInfo.buildId !== metadata.buildId || buildInfo.commit !== metadata.commit || buildInfo.builtAt !== metadata.builtAt) {
  throw new Error('version.json and index.html metadata do not describe the same build');
}

for (const assetPath of extractLocalAssets(indexHtml)) {
  const filePath = path.join(distDirectory, assetPath.slice(1));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`index.html references a missing build asset: ${assetPath}`);
  }
}

for (const assetPath of extractJavaScriptAssets(distDirectory)) {
  const filePath = path.join(distDirectory, assetPath.slice(1));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`web JavaScript references a missing route chunk: ${assetPath}`);
  }
}

console.log(`Verified web build ${buildInfo.buildId} (${buildInfo.commit}).`);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readBuildMetadata(html) {
  const readMeta = (name) => {
    const pattern = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i');
    return pattern.exec(html)?.[1];
  };

  return {
    buildId: readMeta('funbox-build-id'),
    commit: readMeta('funbox-build-commit'),
    builtAt: readMeta('funbox-build-time'),
  };
}

function assertBuildInfo(value, source) {
  if (
    !value ||
    typeof value.buildId !== 'string' ||
    !value.buildId ||
    typeof value.commit !== 'string' ||
    !value.commit ||
    typeof value.builtAt !== 'string' ||
    !Number.isFinite(Date.parse(value.builtAt))
  ) {
    throw new Error(`${source} does not contain valid build metadata`);
  }
}

function extractLocalAssets(html) {
  const assets = new Set();
  const pattern = /(?:src|href)="([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    const value = match[1];
    if (!value.startsWith('/') || value.startsWith('//')) {
      continue;
    }

    const pathname = value.split(/[?#]/, 1)[0];
    if (pathname && pathname !== '/') {
      assets.add(pathname);
    }
  }

  return assets;
}

function extractJavaScriptAssets(distRoot) {
  const assets = new Set();
  const scriptDirectory = path.join(distRoot, '_expo/static/js/web');

  if (!fs.existsSync(scriptDirectory)) {
    return assets;
  }

  for (const entry of fs.readdirSync(scriptDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      continue;
    }

    const source = fs.readFileSync(path.join(scriptDirectory, entry.name), 'utf8');
    for (const match of source.matchAll(/\/_expo\/static\/[^"'\s\\`)]+/g)) {
      const pathname = match[0].split(/[?#]/, 1)[0];
      if (pathname.endsWith('.js')) {
        assets.add(pathname);
      }
    }
  }

  return assets;
}
