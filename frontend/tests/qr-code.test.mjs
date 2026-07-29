import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_QR_FIELDS,
  fileSafeQrName,
  validateQrContent,
} from '../lib/qr-code.ts';

test('normalizes a link without a protocol', () => {
  const result = validateQrContent('link', {
    ...DEFAULT_QR_FIELDS,
    link: 'example.com/path',
  });

  assert.equal(result.error, null);
  assert.equal(result.payload, 'https://example.com/path');
  assert.equal(result.caption, 'example.com');
});

test('rejects unsupported link protocols', () => {
  const result = validateQrContent('link', {
    ...DEFAULT_QR_FIELDS,
    link: 'ftp://example.com/file',
  });

  assert.match(result.error ?? '', /HTTP 或 HTTPS/);
  assert.equal(result.payload, '');
});

test('builds and escapes a Wi-Fi payload', () => {
  const result = validateQrContent('wifi', {
    ...DEFAULT_QR_FIELDS,
    wifiPassword: 'pass;word',
    wifiSsid: 'Studio:2F',
  });

  assert.equal(result.error, null);
  assert.equal(result.payload, 'WIFI:T:WPA;S:Studio\\:2F;P:pass\\;word;H:false;');
});

test('requires a password for encrypted Wi-Fi', () => {
  const result = validateQrContent('wifi', {
    ...DEFAULT_QR_FIELDS,
    wifiPassword: '',
  });

  assert.match(result.error ?? '', /需要填写/);
});

test('builds a vCard with optional contact fields', () => {
  const result = validateQrContent('contact', {
    ...DEFAULT_QR_FIELDS,
    contactEmail: '',
    contactName: '王小明',
    contactPhone: '13800138000',
  });

  assert.equal(result.error, null);
  assert.match(result.payload, /^BEGIN:VCARD\nVERSION:3\.0/);
  assert.match(result.payload, /FN:王小明/);
  assert.match(result.payload, /TEL;TYPE=CELL:13800138000/);
  assert.doesNotMatch(result.payload, /EMAIL:/);
});

test('creates a stable export name', () => {
  assert.equal(fileSafeQrName(' www.FunBox.app / 下载 '), 'www-funbox-app-下载');
  assert.equal(fileSafeQrName('---'), 'funbox-qr');
});
