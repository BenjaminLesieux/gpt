import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.gitarpro.desktop",
  productName: "Gitarpro",

  directories: {
    buildResources: "build",
    output: "release",
  },

  // Files to bundle into the app
  files: ["out/**", "dist/**"],

  // Ship the bundled `gpt` CLI (a single self-contained CJS file produced by
  // the `@gpt/cli:bundle` target) into the app's resources. At runtime the main
  // process spawns it with Electron's embedded Node — see ServeSupervisor.
  // Lands at <app>/Contents/Resources/bin/gpt.cjs.
  extraResources: [
    {
      from: "../cli/dist-desktop/gpt.cjs",
      to: "bin/gpt.cjs",
    },
  ],

  mac: {
    icon: "build/icons/icon.icns",
    category: "public.app-category.music",
    // Build universal binary (Intel + Apple Silicon)
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
  },

  dmg: {
    title: "${productName} ${version}",
    artifactName: "${productName}-${version}-${arch}.dmg",
  },
};

export default config;
