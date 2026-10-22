import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(frontendRoot, 'assets', 'fonts');
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

const require = createRequire(import.meta.url);
const fontDefinitions = [
  {
    family: 'ionicons',
    glyphMapPath: require.resolve(
      '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
    ),
    output: 'Ionicons-subset.ttf',
    source: require.resolve(
      '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf',
    ),
  },
  {
    family: 'material-community',
    glyphMapPath: require.resolve(
      '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json',
    ),
    output: 'MaterialCommunityIcons-subset.ttf',
    source: require.resolve(
      '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf',
    ),
  },
];

const sourceFiles = sourceRoots.flatMap((root) => listFiles(path.join(frontendRoot, root)));
const stringLiterals = collectStringLiterals(sourceFiles);

fs.mkdirSync(outputDir, { recursive: true });

const manifest = { fonts: {} };

for (const definition of fontDefinitions) {
  const glyphMap = JSON.parse(fs.readFileSync(definition.glyphMapPath, 'utf8'));
  const iconNames = Object.keys(glyphMap)
    .filter((name) => stringLiterals.has(name))
    .sort();
  const codepoints = [...new Set([
    ...iconNames.map((name) => Number(glyphMap[name])),
    0x3f,
  ])].sort((left, right) => left - right);
  const unicodeList = codepoints.map((value) => `U+${value.toString(16).toUpperCase()}`).join(',');
  const outputPath = path.join(outputDir, definition.output);

  execFileSync('hb-subset', [
    definition.source,
    `--unicodes=${unicodeList}`,
    '--name-IDs=*',
    '--name-languages=*',
    '--name-legacy',
    '--glyph-names',
    `--output-file=${outputPath}`,
  ], { stdio: 'inherit' });

  manifest.fonts[definition.family] = {
    icons: iconNames,
    output: definition.output,
    unicodes: codepoints,
  };
}

fs.writeFileSync(
  path.join(outputDir, 'icon-font-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

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
