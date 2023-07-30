import * as esbuild from 'esbuild';

const argv = new Set(process.argv.slice(2));

const identifier = (length = 9) =>
  `i${Math.random().toString(36).substring(2, length)}`;

const createRequireAlias = identifier();

/**
 * @type {import('esbuild').BuildOptions}
 */
const options = {
  entryPoints: ['./src/worker/index.ts'],
  outfile: './dist/worker.mjs',
  format: 'esm',
  platform: 'node',
  bundle: true,
  sourcemap: true,
  minify: argv.has('--minify'),
  banner: {
    js: `
      import { createRequire as ${createRequireAlias} } from 'module';
      const require = ${createRequireAlias}(import.meta.url);
    `,
  },
};

if (argv.has('--watch')) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'rebuild',
        setup(build) {
          build.onEnd((result) => {
            console.log('[watch] build started');
            if (result.errors.length > 0) {
              result.errors.forEach((error) =>
                console.error(
                  `> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`,
                ),
              );
            } else {
              console.log('[watch] build finished, watching for changes...');
            }
          });
        },
      },
    ],
  });

  await ctx.watch();
} else {
  await esbuild.build(options);
}
