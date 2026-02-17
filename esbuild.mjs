import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  // Keep class names for error stack traces
  keepNames: production,
  metafile: true,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[esbuild] watching for changes...");
  } else {
    const result = await esbuild.build(buildOptions);

    if (result.metafile) {
      const analysis = await esbuild.analyzeMetafile(result.metafile);
      if (production) {
        console.log("\n--- Bundle Analysis ---");
        console.log(analysis);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
