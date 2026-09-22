const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const src = fs.readFileSync(path.join(root, 'prototype-source.html'), 'utf8');
const data = fs.readFileSync(path.join(root, 'assets/kodebart-cover.png')).toString('base64');
if (!src.includes('__COVER_DATA__')) throw new Error('Missing cover token');
fs.writeFileSync(path.join(root, 'KodeBart-UI-Demo.html'), src.replace('__COVER_DATA__', 'data:image/png;base64,' + data));
console.log('Built self-contained KodeBart-UI-Demo.html');
