const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

const sharedRoot = path.resolve(workspaceRoot, 'packages', 'shared') + path.sep;

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Shared is TypeScript written with Node's .js import specifiers. Metro only
// sees the .ts files, so rewrite those relative imports before resolving.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath;
  if (
    origin.startsWith(sharedRoot) &&
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js')
  ) {
    return context.resolveRequest(context, moduleName.slice(0, -3) + '.ts', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
