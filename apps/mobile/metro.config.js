// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// jose (a transitive dep of @privy-io/expo, used for JWT verification) has an incorrect package
// exports map — Metro resolves its Node build by default, which imports the Node "crypto"
// module and fails to bundle for React Native. Forcing the "browser" condition for this one
// package gets the RN-safe build instead. Straight from Privy's own Expo starter template.
const resolveRequestWithPackageExports = (context, moduleName, platform) => {
  if (moduleName === 'jose') {
    const ctx = { ...context, unstable_conditionNames: ['browser'] };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.resolveRequest = resolveRequestWithPackageExports;

module.exports = config;
