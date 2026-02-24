/**
 * build.js — esbuild-based bundler for BrowserOS userscript.
 *
 * Produces a single IIFE in dist/ with the userscript metadata header prepended.
 * The IIFE wrapper satisfies userscript managers (Tampermonkey, Violentmonkey,
 * Userscripts app on iOS) while allowing ES module source structure during dev.
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         BrowserOS
// @namespace    https://github.com/heberttyler93/WebSU
// @version      0.1.0
// @description  Personal browser middleware — visual pipeline builder using authenticated sessions
// @author       heberttyler93
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
`;

const result = await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  globalName: 'BrowserOS',
  outfile: 'dist/browseros.user.js',
  target: ['safari14', 'chrome90', 'firefox90'],
  // Minify for dist — comment out during debugging
  // minify: true,
  metafile: true,
});

// Prepend userscript header (esbuild banner option can also do this, but
// doing it post-build keeps the header human-readable in the output)
const bundled = readFileSync('dist/browseros.user.js', 'utf8');
writeFileSync('dist/browseros.user.js', USERSCRIPT_HEADER + '\n' + bundled);

console.log('Build complete → dist/browseros.user.js');
