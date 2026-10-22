import fs from 'node:fs';
import path from 'node:path';

const distDirectory = path.resolve(process.argv[2] ?? 'dist');
const indexPath = path.join(distDirectory, 'index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const marker = 'data-funbox-boot-fallback';

if (indexHtml.includes(marker)) {
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
