self.onmessage = function(event) {
  const { type, fen, depths } = event.data;
  if (type === 'analyze') {
    runAnalysis(fen, depths || [12]);
  }
};

let stockfishWorker = null;

function initEngine() {
  if (!stockfishWorker) {
    stockfishWorker = new Worker('stockfish-worker.js');
  }
}

function runAnalysis(fen, depths) {
  initEngine();
  const sideToMove = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  let currentDepthIndex = 0;
  const maxDepth = depths[depths.length - 1];

  const handleMessage = (event) => {
    const data = event.data;
    if (data.type === 'info' && data.depth === depths[currentDepthIndex]) {
      self.postMessage({
        type: 'analysis',
        depth: data.depth,
        bestMove: data.bestmove,
        eval: data.score,
        sideToMove
      });
      currentDepthIndex += 1;
      if (currentDepthIndex < depths.length) {
        stockfishWorker.postMessage({
          type: 'go',
          fen,
          depth: depths[currentDepthIndex]
        });
      } else {
        stockfishWorker.removeEventListener('message', handleMessage);
      }
    }
  };

  stockfishWorker.addEventListener('message', handleMessage);
  stockfishWorker.postMessage({ type: 'go', fen, depth: depths[0] });
}
