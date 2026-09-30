'use strict';
/* 把 tools/book.json 注入 index.html（替换 BOOK_START/BOOK_END 之间的内容）
   用法：node sf_inject.js [book.json] [index.html] */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const bookPath = path.resolve(__dirname, process.argv[2] || 'book.json');
const htmlPath = path.resolve(__dirname, process.argv[3] || path.join(ROOT, 'index.html'));

const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
/* 数字收一下精度，JSON 能小一大截 —— 分数保留 1 位小数足够讲清楚"差多少分" */
function trim(o, key){
  if(key === 'sc' && typeof o === 'number') return Math.round(o * 10) / 10;
  return o;
}
const slim = JSON.stringify(book, (k, v) => trim(v, k));
let html = fs.readFileSync(htmlPath, 'utf8');
const A = '/*__BOOK_START__*/', B = '/*__BOOK_END__*/';
const i = html.indexOf(A), j = html.indexOf(B);
if(i < 0 || j < 0) throw new Error('index.html 里找不到 BOOK 锚点');
const before = html.length;
html = html.slice(0, i + A.length)
     + '\nconst OPENING_BOOK = ' + slim + ';\n'
     + html.slice(j);
fs.writeFileSync(htmlPath, html);
console.log('注入完成：' + book.moves.length + ' 手，JSON ' + (slim.length / 1024).toFixed(1) + ' KB，'
  + 'index.html ' + (before / 1024).toFixed(1) + ' KB → ' + (html.length / 1024).toFixed(1) + ' KB');
