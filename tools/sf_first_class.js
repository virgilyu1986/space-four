'use strict';
/* 补算：先手第一步的**全部 25 个落点**分数（主跑里只留了前 6 名），
   用来填满「6 个对称类」那张表。
   用法：node sf_first_class.js [ms] [maxd] */
const fs = require('fs');
const path = require('path');
const E = require('./sf_engine.js');

const MS = +(process.argv[2] || 40000);
const MAXD = +(process.argv[3] || 12);
const bookPath = path.resolve(__dirname, 'book.json');
const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));

E.newGame();
const r = E.rootSearch(1, MAXD, MS, { noBreak: false });
const all = r.cands.map(c => ({
  cell: c.cell, x: E.XOA[c.cell], y: E.YOA[c.cell],
  sc: Math.round(c.sc * 10) / 10,
}));
console.log('先手第一步全 25 点（深度 ' + r.depth + '，' + r.ms + 'ms，' + r.nodes.toLocaleString() + ' 节点）：');
for(const a of all) console.log('  ' + E.cellName(a.cell) + ' = ' + a.sc);

book.firstAll = all;
book.firstDepth = r.depth;
/* 把每个对称类的 searchVal 从"前 6 名里碰巧有的"补成"全 25 点都有" */
const m = new Map(all.map(a => [a.cell, a.sc]));
if(book.classes){
  for(const c of book.classes){
    const vals = c.cells.map(x => m.get(x)).filter(v => v !== undefined);
    if(vals.length) c.searchVal = Math.round(Math.max.apply(null, vals) * 10) / 10;
  }
  book.classes.sort((a, b) => (b.searchVal ?? -1e9) - (a.searchVal ?? -1e9));
}
fs.writeFileSync(bookPath, JSON.stringify(book, null, 1));
console.log('已写回 ' + bookPath);
