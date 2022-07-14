/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as fs from 'fs';
import { join } from 'path';
import { pipeline as cbPipeline } from 'stream';
import { promisify } from 'util';
import { Logger } from '@salesforce/core';
import * as globby from 'globby';
import * as JSZIP from 'jszip';

const pipeline = promisify(cbPipeline);

/**
 * Zips directory to given zipfile.
 *
 * https://github.com/archiverjs/node-archiver
 *
 * @param dir to zip
 * @param zipfile
 * @param options
 */
export async function zipDir(dir: string, zipfile: string, options = {}): Promise<void> {
  const logger = Logger.childFromRoot('srcDevUtils#zipDir');

  const timer = process.hrtime();
  const globbyResult: string[] = await globby('**/*', { expandDirectories: true, cwd: dir });
  const zip = new JSZIP();
  // add files tp zip
  for (const file of globbyResult) {
    zip.file(file, fs.readFileSync(join(dir, file)));
  }
  // write zip to file
  const zipStream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: {
      level: 3,
    },
  });
  await pipeline(zipStream, fs.createWriteStream(zipfile));
  const stat = fs.statSync(zipfile);
  logger.debug(`${stat.size} bytes written to ${zipfile} in ${getElapsedTime(timer)}ms`);
  return;
}

export function getElapsedTime(timer: [number, number]): string {
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
