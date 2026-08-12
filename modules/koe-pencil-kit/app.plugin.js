const { withInfoPlist } = require("expo/config-plugins");

/**
 * Keep iPhone portrait-only while allowing an iPad writing desk to rotate.
 * This runs after Expo's orientation plugin and is committed beside the native
 * module, rather than patching generated ios/ files.
 */
module.exports = function withKoePencilKit(config) {
  return withInfoPlist(config, (nextConfig) => {
    nextConfig.modResults["UISupportedInterfaceOrientations~ipad"] = [
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationPortraitUpsideDown",
      "UIInterfaceOrientationLandscapeLeft",
      "UIInterfaceOrientationLandscapeRight",
    ];
    return nextConfig;
  });
};
