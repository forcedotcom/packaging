/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert, expect } from 'chai';
import * as JSZIP from 'jszip';
import { zipDir } from '../../src/utils';

describe('srcDevUtils', () => {
  let tmpZipDir: string;
  let tmpSrcDir: string;
  beforeEach(() => {
    tmpZipDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
    tmpSrcDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
    fs.mkdirSync(path.join(tmpSrcDir, 'empty-dir'), { recursive: true });
    fs.mkdirSync(path.join(tmpSrcDir, 'not-empty-dir', 'empty-sub-dir'), { recursive: true });
    fs.mkdirSync(path.join(tmpSrcDir, 'not-empty-dir', 'sub-dir'), { recursive: true });
    fs.writeFileSync(path.join(tmpSrcDir, 'file1.txt'), 'file contents');
    fs.writeFileSync(path.join(tmpSrcDir, 'file2.txt'), 'file contents');
    fs.writeFileSync(path.join(tmpSrcDir, 'not-empty-dir', 'sub-dir', 'file4.txt'), 'file contents');
    fs.writeFileSync(path.join(tmpSrcDir, 'not-empty-dir', 'file3.txt'), 'file contents');
    // eslint-disable-next-line no-console
    console.log(`tmpDir: ${tmpZipDir}`);
  });
  afterEach(() => {
    // fs.rmSync(tmpZipDir, { recursive: true });
    // fs.rmSync(tmpSrcDir, { recursive: true });
  });

  it('should be defined', async () => {
    const entries = [
      'file1.txt',
      'file2.txt',
      'not-empty-dir/',
      'not-empty-dir/file3.txt',
      'not-empty-dir/sub-dir/',
      'not-empty-dir/sub-dir/file4.txt',
    ];
    await zipDir(path.resolve(tmpSrcDir), path.join(tmpZipDir, 'test.zip'));
    try {
      const stat = fs.statSync(path.join(tmpZipDir, 'test.zip'));
      expect(stat.size).to.be.greaterThan(0);
    } catch (e) {
      assert.fail((e as Error).message);
    }

    const zip = await JSZIP.loadAsync(await fs.promises.readFile(path.join(tmpZipDir, 'test.zip')));
    expect(Object.keys(zip.files)).to.have.lengthOf(entries.length);
    zip.forEach((file) => {
      expect(entries.includes(file)).to.be.true;
    });
  });
});
