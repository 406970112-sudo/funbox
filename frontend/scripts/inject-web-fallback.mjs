import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = path.resolve(process.argv[2] ?? 'dist');
const indexPath = path.join(distDirectory, 'index.html');
const versionPath = path.join(distDirectory, 'version.json');
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
const marker = 'data-funbox-boot-fallback';
const buildMetadataPattern = /[ \t]*<!-- funbox-build-metadata:start -->[\s\S]*?<!-- funbox-build-metadata:end -->[ \t]*\n?/g;

const buildInfo = createBuildInfo();

indexHtml = indexHtml.replace(buildMetadataPattern, '');
const buildMetadata = `<!-- funbox-build-metadata:start -->
  <meta name="funbox-build-id" content="${escapeHtml(buildInfo.buildId)}" data-funbox-build-metadata />
  <meta name="funbox-build-commit" content="${escapeHtml(buildInfo.commit)}" data-funbox-build-metadata />
  <meta name="funbox-build-time" content="${escapeHtml(buildInfo.builtAt)}" data-funbox-build-metadata />
  <!-- funbox-build-metadata:end -->
`;

if (!indexHtml.includes('</head>')) {
  throw new Error('Unable to find the closing head tag in dist/index.html');
}

indexHtml = indexHtml.replace('</head>', `${buildMetadata}</head>`);
fs.writeFileSync(versionPath, `${JSON.stringify(buildInfo)}\n`);

if (indexHtml.includes(marker)) {
  fs.writeFileSync(indexPath, indexHtml);
  process.exit(0);
}

const emptyRoot = '<div id="root"></div>';
if (!indexHtml.includes(emptyRoot)) {
  throw new Error('Unable to find the Expo root element in dist/index.html');
}

const fallback = `
    <div
      id="funbox-boot-fallback"
      ${marker}
      role="status"
      style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#eef4ff;color:#18233f;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;box-sizing:border-box">
      <div>
        <div style="font-size:24px;font-weight:800;letter-spacing:-0.02em">FunBox</div>
        <div id="funbox-boot-message" style="margin-top:10px;color:#7483a2;font-size:14px">正在加载工具与游戏…</div>
        <button
          id="funbox-boot-retry"
          type="button"
          hidden
          style="margin-top:18px;padding:10px 18px;border:0;border-radius:10px;background:#18211f;color:#fff;font:inherit;font-weight:700"
          onclick="window.location.reload()">
          重新加载
        </button>
      </div>
    </div>
    <script>
      (function () {
        var message = document.getElementById('funbox-boot-message');
        var retry = document.getElementById('funbox-boot-retry');
        var failed = false;

        function showFailure() {
          if (failed || !message || !document.body.contains(message)) return;
          failed = true;
          message.textContent = '页面资源加载失败，请检查网络后刷新重试。';
          if (retry) retry.hidden = false;
        }

        window.addEventListener('error', function (event) {
          if (event.target && (event.target.tagName === 'SCRIPT' || event.target.tagName === 'LINK')) {
            showFailure();
          }
        }, true);

        window.setTimeout(showFailure, 12000);
      })();
    </script>`;

fs.writeFileSync(indexPath, indexHtml.replace(emptyRoot, `<div id="root">${fallback}</div>`));

function createBuildInfo() {
  const configuredCommit = normaliseString(process.env.DEPLOY_COMMIT);
  const configuredBuiltAt = normaliseString(process.env.WEB_BUILD_TIME);
  const commit = configuredCommit ?? resolveGitCommit();
  const isDirty = !configuredCommit && isGitWorktreeDirty();
  const builtAt = configuredBuiltAt ?? new Date().toISOString();

  if (!Number.isFinite(Date.parse(builtAt))) {
    throw new Error(`Invalid WEB_BUILD_TIME value: ${builtAt}`);
  }

  return {
    buildId: `${commit}${isDirty ? '-dirty' : ''}`,
    commit,
    builtAt,
  };
}

function resolveGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: frontendRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function isGitWorktreeDirty() {
  try {
    return Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: frontendRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return false;
  }
}

function normaliseString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
