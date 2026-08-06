const fs = require('node:fs');
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.blockList = [/\.worktrees[/\\].*/];
const cacheRoot = path.join(__dirname, '.expo', 'metro-cache');
const fileMapCacheRoot = path.join(cacheRoot, 'file-map');
const transformCacheRoot = path.join(cacheRoot, 'transforms');

fs.mkdirSync(fileMapCacheRoot, { recursive: true });
fs.mkdirSync(transformCacheRoot, { recursive: true });

config.cacheStores = [new FileStore({ root: transformCacheRoot })];
config.fileMapCacheDirectory = fileMapCacheRoot;

module.exports = config;
