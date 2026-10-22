import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = [
  'app',
  'components',
  'constants',
  'features',
  'hooks',
  'lib',
  'mocks',
  'shared',
  'types',
];
const manifest = JSON.parse(
  fs.readFileSync(path.join(frontendRoot, 'assets/fonts/icon-font-manifest.json'), 'utf8'),
);
const glyphMaps = {
  ionicons: JSON.parse(
    fs.readFileSync(
      path.join(
        frontendRoot,
        '..',
        'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
      ),
      'utf8',
    ),
  ),
  'material-community': JSON.parse(
    fs.readFileSync(
      path.join(
        frontendRoot,
        '..',
        'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json',
      ),
      'utf8',
    ),
  ),
};

const sourceFiles = sourceRoots.flatMap((root) => listFiles(path.join(frontendRoot, root)));
const stringLiterals = collectStringLiterals(sourceFiles);

for (const [family, glyphMap] of Object.entries(glyphMaps)) {
  test(`${family} subset manifest covers every icon name used by source`, () => {
    const includedIcons = new Set(manifest.fonts[family].icons);
    const missingIcons = Object.keys(glyphMap)
      .filter((name) => stringLiterals.has(name) && !includedIcons.has(name))
      .sort();

    assert.deepEqual(missingIcons, []);
  });
}

function collectStringLiterals(files) {
  const values = new Set();
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = pattern.exec(source))) values.add(match[2]);
  }

  return values;
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}
