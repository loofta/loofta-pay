// Didn't exist before — Expo falls back to babel-preset-expo without one. Needed now because
// react-native-reanimated v4 requires its worklets babel plugin, which must run last.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
