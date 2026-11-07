const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PNG } = require('pngjs');
const { icons, tones } = require('../../scripts/generate-notebook-icons.cjs');
const root = path.resolve(__dirname, '../packages/notebook');

test('notebook outline icons have a uniform transparent canvas with unclipped centered artwork', () => {
  for (const name of Object.keys(icons)) {
    let expectedAlpha;
    for (const tone of Object.keys(tones)) {
      const png = PNG.sync.read(fs.readFileSync(path.join(root, `assets/outline/${name}-${tone}.png`)));
      assert.equal(png.width, 96, name);
      assert.equal(png.height, 96, name);
      const alpha = [];
      let left = 96, right = 0, top = 96, bottom = 0;
      for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
        const a = png.data[(y * 96 + x) * 4 + 3];
        alpha.push(a);
        if (a > 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      }
      assert.ok(left >= 4 && right <= 91 && top >= 4 && bottom <= 91, `${name}: transparent padding on all sides`);
      assert.ok(Math.abs((left + right) / 2 - 47.5) <= 8, `${name}: horizontal center`);
      assert.ok(Math.abs((top + bottom) / 2 - 47.5) <= 8, `${name}: vertical center`);
      if (expectedAlpha) assert.deepEqual(alpha, expectedAlpha, `${name}: tones preserve geometry`);
      expectedAlpha = alpha;
    }
  }
});

test('nb-icon validates properties, preserves square size, and falls back to a supported asset', () => {
  let component;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/nb-icon/index.js'), 'utf8'), { Component: x => { component = x; } });
  assert.equal(component.properties.size.value, 40);
  const context = { setData(x) { this.data = x; } };
  const observe = component.observers['name, tone, size'];
  observe.call(context, 'lock', 'primary', 32);
  assert.equal(context.data.source, '/packages/notebook/assets/outline/lock-primary.png');
  assert.equal(context.data.displaySize, 32);
  observe.call(context, '../unknown', 'unknown', -1);
  assert.equal(context.data.source, '/packages/notebook/assets/outline/document-default.png');
  assert.equal(context.data.displaySize, 40);
});

test('home exposes named create, management, and encryption controls using shared icons', () => {
  const markup = fs.readFileSync(path.join(root, 'index/index.wxml'), 'utf8');
  assert.match(markup, /class="encryption-management"[^>]*bindtap="openSecurity"/);
  assert.match(markup, /bindtap="manageBooks"/);
  assert.match(markup, /<text>新建笔记<\/text>/);
  assert.doesNotMatch(markup, /assets\/icons\/|[›×✓]/);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'index/index.json'), 'utf8'));
  assert.equal(config.usingComponents['nb-icon'], '../components/nb-icon/index');
});
