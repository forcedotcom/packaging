/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { join } from 'path';
import * as archiver from 'archiver';
import { Logger } from '@salesforce/core';

/**
 * Zips directory to given zipfile.
 *
 * https://github.com/archiverjs/node-archiver
 *
 * @param dir to zip
 * @param zipfile
 * @param options
 */
export async function zipDir(dir: string, zipfile: string, options = {}) {
  const logger = Logger.childFromRoot('srcDevUtils#zipDir');
  const file = path.parse(dir);
  const outFile = zipfile || path.join(os.tmpdir() || '.', `${file.base}.zip`);
  const output = fs.createWriteStream(outFile);

  const timer = process.hrtime();
  const archive = archiver('zip', options);
  archive.on('finish', () => {
    logger.debug(`${archive.pointer()} bytes written to ${outFile} using ${getElapsedTime(timer)}ms`);
    // zip file returned once stream is closed, see 'close' listener below
  });

  archive.on('error', (err) => {
    Promise.reject(err);
  });

  output.on('close', () => {
    Promise.resolve(outFile);
  });

  archive.pipe(output);
  archive.directory(dir, '');
  return await archive.finalize();
}

export function getElapsedTime(timer: [number, number]) {
  const elapsed = process.hrtime(timer);
  return (elapsed[0] * 1000 + elapsed[1] / 1000000).toFixed(3);
}

export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.map((entry) => {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    return entry.isDirectory() ? copyDir(srcPath, destPath) : fs.copyFileSync(srcPath, destPath);
  });
}
