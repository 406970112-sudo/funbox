import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoredZip } from '../lib/stored-zip.ts';

test('creates a standards-shaped ZIP with UTF-8 file names', () => {
  const content = new TextEncoder().encode('compressed-image');
  const name = '01-压缩图.png';
  const nameBytes = new TextEncoder().encode(name);
  const archive = createStoredZip([{ data: content, name }]);
  const view = new DataView(archive.buffer);

  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint32(18, true), content.length);
  assert.equal(view.getUint16(26, true), nameBytes.length);

  const dataOffset = 30 + nameBytes.length;
  assert.deepEqual(archive.slice(dataOffset, dataOffset + content.length), content);

  const centralOffset = dataOffset + content.length;
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  const endOffset = archive.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50);
  assert.equal(view.getUint16(endOffset + 10, true), 1);
  assert.equal(view.getUint32(endOffset + 16, true), centralOffset);
});
