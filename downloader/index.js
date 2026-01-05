"use strict"

import Parser from './parser.js';
import { access, writeFile, mkdir } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const concurrent_http_requests = 10;

async function getSiteMap() {
   const res = await fetch('http://www.bbc.co.uk/food/sitemap.xml', { headers: { 'User-Agent': 'auntiesrecipes downloader' } });
   const body = await res.text();
   const parser = new Parser();
   return new Promise((resolve, reject) => {
      parser.parse(body, (err, doc) => {
         if (err) return reject(err);
         resolve(doc);
      });
   });
}

function getOutfile(url) {
   let outfile = url.substring(url.lastIndexOf('//') + 2);
   outfile = outfile.replace(/\//g, '_');
   outfile = outfile.replace(/\./g, '_') + '.html';
   return outfile;
}

async function fileExists(path) {
   try {
      await access(path, fsConstants.F_OK);
      return true;
   } catch (e) {
      return false;
   }
}

async function downloadTask(task) {
   process.stdout.write('.');
   const htmlDir = path.join(__dirname, 'html');
   await mkdir(htmlDir, { recursive: true });
   const outPath = path.join(htmlDir, task.outfile);
   if (await fileExists(outPath)) {
      process.stdout.write('/');
      return;
   }
   const res = await fetch(task.url, { headers: { 'User-Agent': 'auntiesrecipes downloader' } });
   const body = await res.text();
   await writeFile(outPath, body, 'utf8');
   process.stdout.write('-');
}

async function run() {
   try {
      const urls = await getSiteMap();
      const tasks = urls.map(u => (u && u.toString().trim()) || '')
         .filter(u => u.length)
         .map(url => {
            try {
               const parsed = new URL(url);
               if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
               return { url, outfile: getOutfile(url) };
            } catch (e) {
               return null;
            }
         })
         .filter(Boolean);
      console.log('Downloading: ' + tasks.length + ' URLs.');

      let index = 0;
      async function worker() {
         while (true) {
            const i = index++;
            if (i >= tasks.length) break;
            await downloadTask(tasks[i]);
         }
      }

      const workers = Array.from({ length: Math.min(concurrent_http_requests, tasks.length) }, () => worker());
      await Promise.all(workers);
      console.log('Everything has been downloaded.');
   } catch (e) {
      console.error(e);
   }
}

run();

