// Rebuild: NODE_PATH=/path/to/node_modules node scripts/generate-notebook-icons.cjs
// All artwork shares a 24-unit canvas and 1.75-unit rounded stroke.
const fs = require('node:fs');
const path = require('node:path');
const icons = {
  document: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  book: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M8 3v18M3 7h4M3 12h4M3 17h4M12 7h4M12 11h4"/>',
  checklist: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  tag: '<path d="M13 3H5a2 2 0 0 0-2 2v8l8 8a2 2 0 0 0 3 0l7-7a2 2 0 0 0 0-3z"/><circle cx="8" cy="8" r="1"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',
  unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 15v2"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  share: '<path d="m14 3 7 6-7 6v-4C8 11 5 15 3 20c0-8 3-13 11-13z"/>',
  edit: '<path d="m15 4 5 5M4 15 16 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20l-6 1zM13 21h8"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  'chevron-down': '<path d="m5 9 7 7 7-7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  pin: '<path d="M8 3h8l-1 7 4 4H5l4-4zM12 14v7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9M16 16l3-3M18 18l3-3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  refresh: '<path d="M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-5M4 14a8 8 0 0 0 14 5"/>',
};
const tones = { default: '#52657f', primary: '#2458ff', white: '#ffffff', coral: '#f47458' };
const output = path.resolve(__dirname, '../miniprogram/packages/notebook/assets/outline');
async function generate() {
  const sharp = require('sharp');
  fs.mkdirSync(output, { recursive: true });
  for (const [name, art] of Object.entries(icons)) {
    for (const [tone, color] of Object.entries(tones)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${art}</svg>`;
      await sharp(Buffer.from(svg)).png().toFile(path.join(output, `${name}-${tone}.png`));
    }
  }
}
if (require.main === module) generate().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { icons, tones };
