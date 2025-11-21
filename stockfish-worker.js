let engine = null;
let ready = false;

function init() {
  if (engine) return;
  importScripts('lib/stockfish.js');
  engine = self.STOCKFISH();
  engine.onmessage = (event) => {
    parseEngineMessage(event.data);
  };
  engine.postMessage('uci');
  ready = true;
}

function parseEngineMessage(line) {
  if (typeof line !== 'string') return;
  if (line.startsWith('info')) {
    const depthMatch = line.match(/depth (\d+)/);
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    const bestMatch = line.match(/pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
    let depth = depthMatch ? parseInt(depthMatch[1], 10) : null;
    let score = null;
    if (scoreMatch) {
      score = scoreMatch[1] === 'cp' ? parseInt(scoreMatch[2], 10) : `#${scoreMatch[2]}`;
    }
    if (depth !== null && score !== null && bestMatch) {
      self.postMessage({ type: 'info', depth, score, bestmove: bestMatch[1] });
    }
  } else if (line.startsWith('bestmove')) {
    const move = line.split(' ')[1];
    self.postMessage({ type: 'info', depth: currentDepth, score: lastScore || 0, bestmove: move });
  }
}

let currentDepth = 0;
let lastScore = null;

self.onmessage = function(event) {
  const { type, fen, depth } = event.data;
  if (type === 'go') {
    init();
    currentDepth = depth;
    lastScore = null;
    engine.postMessage('ucinewgame');
    engine.postMessage(`position fen ${fen}`);
    engine.postMessage(`go depth ${depth}`);
  }
};
