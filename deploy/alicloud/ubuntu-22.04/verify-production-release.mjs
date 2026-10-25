const [baseUrlArgument, expectedCommit, attemptsArgument = '1', delayArgument = '0'] = process.argv.slice(2);

if (!baseUrlArgument || !expectedCommit) {
  throw new Error('Usage: verify-production-release.mjs BASE_URL EXPECTED_COMMIT [ATTEMPTS] [DELAY_MS]');
}

const baseUrl = baseUrlArgument.replace(/\/+$/, '');
const attempts = positiveInteger(attemptsArgument, 'ATTEMPTS');
const delayMs = nonNegativeInteger(delayArgument, 'DELAY_MS');
let lastError = null;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    await verifyRelease();
    console.log(`Verified production release ${expectedCommit} at ${baseUrl}.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < attempts) {
      console.error(`Production release verification failed (${attempt}/${attempts}); retrying in ${delayMs}ms.`);
      await delay(delayMs);
    }
  }
}

throw new Error(
  `Production release verification failed after ${attempts} attempt(s): ${
    lastError instanceof Error ? lastError.message : String(lastError)
  }`,
);

async function verifyRelease() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const versionResponse = await fetch(`${baseUrl}/version.json?__deploy_check=${nonce}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  assertNoStore(versionResponse, 'version.json');
  if (!versionResponse.ok) {
    throw new Error(`version.json returned HTTP ${versionResponse.status}`);
  }

  const versionInfo = await versionResponse.json();
  assertBuildInfo(versionInfo, 'version.json');
  if (versionInfo.commit !== expectedCommit) {
    throw new Error(`version.json commit is ${versionInfo.commit}, expected ${expectedCommit}`);
  }

  const htmlResponse = await fetch(`${baseUrl}/?__deploy_check=${nonce}`, {
    cache: 'no-store',
    headers: { Accept: 'text/html' },
  });
  assertNoStore(htmlResponse, 'index.html');
  if (!htmlResponse.ok) {
    throw new Error(`index.html returned HTTP ${htmlResponse.status}`);
  }

  const html = await htmlResponse.text();
  const htmlBuildInfo = readBuildMetadata(html);
  assertBuildInfo(htmlBuildInfo, 'index.html metadata');
  if (
    htmlBuildInfo.buildId !== versionInfo.buildId ||
    htmlBuildInfo.commit !== versionInfo.commit ||
    htmlBuildInfo.builtAt !== versionInfo.builtAt
  ) {
    throw new Error('index.html metadata does not match version.json');
  }
  if (htmlBuildInfo.commit !== expectedCommit) {
    throw new Error(`index.html commit is ${htmlBuildInfo.commit}, expected ${expectedCommit}`);
  }

  const assetsToCheck = [...readSameOriginAssets(html)];
  const checkedAssets = new Set();
  while (assetsToCheck.length > 0) {
    const assetUrl = assetsToCheck.shift();
    if (!assetUrl || checkedAssets.has(assetUrl)) {
      continue;
    }
    checkedAssets.add(assetUrl);

    const parsedAssetUrl = new URL(assetUrl);
    if (parsedAssetUrl.pathname.endsWith('.js') && parsedAssetUrl.searchParams.get('v') !== versionInfo.buildId) {
      throw new Error(`JavaScript asset is missing the current build version: ${assetUrl}`);
    }

    const assetResponse = await fetch(assetUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!assetResponse.ok) {
      throw new Error(`referenced asset returned HTTP ${assetResponse.status}: ${assetUrl}`);
    }

    if (parsedAssetUrl.pathname.endsWith('.js')) {
      assertJavaScriptCachePolicy(assetResponse, assetUrl);
      const assetSource = await assetResponse.text();
      for (const nestedAssetUrl of readJavaScriptAssets(assetSource, versionInfo.buildId)) {
        if (!checkedAssets.has(nestedAssetUrl)) {
          assetsToCheck.push(nestedAssetUrl);
        }
      }
    }
  }
}

function assertNoStore(response, label) {
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (!cacheControl.toLowerCase().includes('no-store')) {
    throw new Error(`${label} is missing the no-store cache policy`);
  }
}

function assertJavaScriptCachePolicy(response, assetUrl) {
  const cacheControl = (response.headers.get('cache-control') ?? '').toLowerCase();
  if (!cacheControl.includes('no-cache') && !cacheControl.includes('no-store')) {
    throw new Error(`JavaScript asset is not revalidated: ${assetUrl}`);
  }
  if (cacheControl.includes('immutable')) {
    throw new Error(`JavaScript asset is incorrectly marked immutable: ${assetUrl}`);
  }
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

function readSameOriginAssets(html) {
  const assets = new Set();
  const pattern = /(?:src|href)="([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1], `${baseUrl}/`);
      if (url.origin === new URL(baseUrl).origin) {
        assets.add(url.href);
      }
    } catch {
      // Ignore malformed optional resources.
    }
  }

  return assets;
}

function readJavaScriptAssets(source, buildId) {
  const assets = new Set();
  const baseOrigin = new URL(baseUrl).origin;
  const expectedVersion = encodeURIComponent(buildId);
  const pattern = /(\/_expo\/static\/js\/[^"'`\s\\?]+?\.js)(?:\?v=([^"'`\s\\]*))?/g;

  for (const match of source.matchAll(pattern)) {
    if (match[2] !== expectedVersion) {
      throw new Error(`JavaScript bundle contains an unversioned asset URL: ${match[1]}`);
    }

    const url = new URL(`${match[1]}?v=${expectedVersion}`, `${baseUrl}/`);
    if (url.origin === baseOrigin) {
      assets.add(url.href);
    }
  }

  return assets;
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
