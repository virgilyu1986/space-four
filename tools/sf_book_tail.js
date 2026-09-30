'use strict';
/* 续跑：读已有 book.json，把棋盘还原到第 --from 手，接着往下算到分出胜负。
   为什么要单独一个脚本：完整重跑一次前 40 手要再花十几分钟，续跑只需几秒。
   用法：node sf_book_tail.js [预算ms] [最大深度] [最多再算几手] [从第几手之后接] */
const fs = require('fs');
const path = require('path');
const E = require('./sf_engine.js');
const A = require('./sf_annotate.js');

const MS = +(process.argv[2] || 8000);
const MAXD = +(process.argv[3] || 10);
const MORE = +(process.argv[4] || 20);
const FROM = process.argv[5] ? +process.argv[5] : null;
const bookPath = path.resolve(__dirname, 'book.json');
const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));

if(FROM !== null && book.moves.length > FROM){
  book.moves = book.moves.slice(0, FROM);      // 把上一次续跑补进去的手砍掉，重来
  console.log('已裁回第 ' + FROM + ' 手');
}
E.newGame();
for(const mv of book.moves) E.putFast(mv.cell, mv.who);
console.log('已还原到第 ' + book.moves.length + ' 手，现在轮到' + (book.moves.length % 2 === 1 ? '红' : '蓝'));

const before = book.moves.length;
let finished = book.moves.length >= (book.meta.base || 0) ? book.result : null;
const t00 = Date.now();
for(let n = 0; n < MORE; n++){
  const k = book.moves.length + 1;
  const who = (k % 2 === 1) ? 1 : 2;
  const r = E.rootSearch(who, MAXD, MS, { noBreak: false });
  const best = r.cands[0];
  if(!best) break;
  const mv = A.recordMove(k, who, best, r);
  book.moves.push(mv);
  const nm = (Math.abs(best.sc) >= E.WIN - 500) ? (best.sc > 0 ? '必胜' : '必输') : Math.round(best.sc);
  console.log('  #' + k + ' ' + (who === 1 ? '蓝' : '红') + ' ' + E.cellName(best.cell)
    + ' 分=' + nm + ' 深度' + r.depth + ' ' + r.ms + 'ms ' + mv.type);
  E.putFast(best.cell, who);
  if(mv.profile.win){ finished = { winner: who, mv: k }; break; }
  if(E.legalMoves().length === 0){ finished = { winner: 0, mv: k }; break; }
}

book.result = finished;
book.meta.moves = book.moves.length;
book.meta.tailMs = MS;
const moves = book.moves;
book.stats.inCenter3 = moves.filter(m => m.x >= 1 && m.x <= 3 && m.y >= 1 && m.y <= 3).length;
book.stats.layerHist = [0, 0, 0, 0, 0, 0];
for(const m of moves) book.stats.layerHist[m.z + 1]++;
book.stats.typeHist = {};
for(const m of moves) book.stats.typeHist[m.type] = (book.stats.typeHist[m.type] || 0) + 1;
book.stats.threatTurns = moves.filter(m => m.profile.foeThreatBefore >= 1).length;
book.stats.forkTurns = moves.filter(m => m.type === 'fork').length;

fs.writeFileSync(bookPath, JSON.stringify(book, null, 1));
console.log('\n续算 ' + (moves.length - before) + ' 手，用时 ' + ((Date.now() - t00) / 1000).toFixed(1) + ' 秒');
console.log('结果：' + (finished ? (finished.winner === 0 ? '和棋' : (finished.winner === 1 ? '先手（蓝）胜' : '后手（红）胜') + '，第 ' + finished.mv + ' 手连成四') : '仍未分胜负'));
