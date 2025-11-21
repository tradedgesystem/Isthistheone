(function() {
  const ENGINE_DEPTHS = [8, 12, 15, 20];
  let boardEl = null;
  let overlaySvg = null;
  let worker = null;
  let lastEval = null;
  let lastBestMove = null;
  let previousEval = null;
  let lastMoveFen = null;
  let observing = false;
  let debounceTimer = null;

  const sidebar = createSidebar();

  function createSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = 'chess-assistant-sidebar';
    sidebar.innerHTML = `
      <div class="ca-header">
        <div class="ca-title">Chess Assistant</div>
        <button class="ca-toggle" aria-label="Toggle sidebar">❯</button>
      </div>
      <div class="ca-body">
        <div class="ca-section">
          <div class="ca-label">Best move</div>
          <div class="ca-bestmove" id="ca-bestmove">--</div>
        </div>
        <div class="ca-section ca-eval-section">
          <div class="ca-label">Evaluation</div>
          <div class="ca-eval" id="ca-eval">--</div>
          <div class="ca-depth" id="ca-depth">Depth: --</div>
        </div>
        <div class="ca-section">
          <div class="ca-label">Blunder detection</div>
          <div class="ca-blunder" id="ca-blunder">Waiting for moves...</div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(sidebar);
    const toggle = sidebar.querySelector('.ca-toggle');
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      toggle.textContent = sidebar.classList.contains('collapsed') ? '❮' : '❯';
    });
    return sidebar;
  }

  function initWorker() {
    if (worker) return;
    worker = new Worker(chrome.runtime.getURL('engine.js'));
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'analysis') {
        handleEngineResult(data);
      }
    };
  }

  function observeBoard() {
    if (observing) return;
    observing = true;
    const observer = new MutationObserver(() => {
      const board = document.querySelector('.board, .board-layout-board, .board-layout-chessboard');
      if (board && board !== boardEl) {
        boardEl = board;
        setupOverlay();
        analyzePosition();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupOverlay() {
    if (overlaySvg && overlaySvg.parentElement) overlaySvg.remove();
    if (!boardEl) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'ca-arrow-layer';
    overlaySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlaySvg.setAttribute('class', 'ca-arrow-svg');
    wrapper.appendChild(overlaySvg);
    boardEl.style.position = 'relative';
    boardEl.appendChild(wrapper);
  }

  function squareToCoords(square) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1], 10) - 1;
    const boardRect = boardEl.getBoundingClientRect();
    const squareSize = boardRect.width / 8;
    const isFlipped = boardEl.classList.contains('flipped') || boardEl.parentElement?.classList?.contains('board-flipped');
    const x = isFlipped ? (7 - file) * squareSize : file * squareSize;
    const y = isFlipped ? rank * squareSize : (7 - rank) * squareSize;
    return {
      x: x + squareSize / 2,
      y: y + squareSize / 2,
      squareSize,
      rect: boardRect
    };
  }

  function drawArrow(from, to, color = '#00b894') {
    if (!overlaySvg) return;
    overlaySvg.innerHTML = '';
    const fromC = squareToCoords(from);
    const toC = squareToCoords(to);
    overlaySvg.setAttribute('width', fromC.rect.width);
    overlaySvg.setAttribute('height', fromC.rect.height);
    overlaySvg.setAttribute('viewBox', `0 0 ${fromC.rect.width} ${fromC.rect.height}`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', fromC.x);
    line.setAttribute('y1', fromC.y);
    line.setAttribute('x2', toC.x);
    line.setAttribute('y2', toC.y);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', Math.max(6, fromC.squareSize / 8));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#ca-arrowhead)');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'ca-arrowhead');
    marker.setAttribute('markerWidth', '20');
    marker.setAttribute('markerHeight', '20');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '5');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M0,0 L0,10 L10,5 z');
    path.setAttribute('fill', color);
    marker.appendChild(path);
    defs.appendChild(marker);
    overlaySvg.appendChild(defs);
    overlaySvg.appendChild(line);
  }

  function clearArrow() {
    if (overlaySvg) overlaySvg.innerHTML = '';
  }

  function pieceToFENChar(piece) {
    const parts = piece.split(' ');
    const type = parts[0];
    const color = parts[1];
    const map = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
    let ch = map[type] || 'p';
    if (color === 'white') ch = ch.toUpperCase();
    return ch;
  }

  function extractFEN() {
    if (!boardEl) return null;
    const pieces = boardEl.querySelectorAll('.piece');
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    pieces.forEach((p) => {
      const square = p.getAttribute('data-square') || p.dataset.square || p.dataset.coord;
      const pieceName = p.getAttribute('data-piece') || Array.from(p.classList).find(c => ['king','queen','rook','bishop','knight','pawn'].includes(c));
      const color = p.classList.contains('white') || (p.dataset?.piece && p.dataset.piece.startsWith('w')) ? 'white' : 'black';
      if (!square || !pieceName) return;
      const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
      const rank = parseInt(square[1], 10) - 1;
      board[7 - rank][file] = pieceToFENChar(`${pieceName} ${color}`);
    });
    const rows = board.map(row => {
      let fenRow = '';
      let empty = 0;
      row.forEach(cell => {
        if (cell) {
          if (empty) { fenRow += empty; empty = 0; }
          fenRow += cell;
        } else {
          empty += 1;
        }
      });
      if (empty) fenRow += empty;
      return fenRow;
    }).join('/');
    const sideToMove = detectSideToMove();
    return `${rows} ${sideToMove} - - 0 1`;
  }

  function detectSideToMove() {
    const turnIndicator = document.querySelector('[data-drag-ply]');
    if (turnIndicator) {
      const ply = parseInt(turnIndicator.getAttribute('data-drag-ply'), 10);
      if (!isNaN(ply)) return ply % 2 === 0 ? 'w' : 'b';
    }
    const moveLists = document.querySelectorAll('.move-list .node');
    return moveLists.length % 2 === 0 ? 'w' : 'b';
  }

  function analyzePosition() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const fen = extractFEN();
      if (!fen) return;
      initWorker();
      lastMoveFen = fen;
      worker.postMessage({ type: 'analyze', fen, depths: ENGINE_DEPTHS });
    }, 200);
  }

  function handleEngineResult(result) {
    const bestMoveEl = document.getElementById('ca-bestmove');
    const evalEl = document.getElementById('ca-eval');
    const depthEl = document.getElementById('ca-depth');
    const blunderEl = document.getElementById('ca-blunder');
    if (!bestMoveEl || !evalEl || !depthEl || !blunderEl) return;
    lastEval = result.eval;
    lastBestMove = result.bestMove;
    bestMoveEl.textContent = result.bestMove || '--';
    evalEl.textContent = formatEval(result.eval, result.sideToMove);
    depthEl.textContent = `Depth: ${result.depth}/${ENGINE_DEPTHS[ENGINE_DEPTHS.length - 1]}`;
    if (result.bestMove && result.bestMove.length >= 4) {
      drawArrow(result.bestMove.substring(0,2), result.bestMove.substring(2,4));
    }
    if (previousEval !== null) {
      const side = result.sideToMove === 'white' ? 1 : -1;
      const delta = side * (previousEval - result.eval);
      const verdict = classifyDelta(delta);
      blunderEl.textContent = verdict.text;
      blunderEl.style.color = verdict.color;
      if (verdict.highlight && lastBestMove) {
        drawArrow(lastBestMove.substring(0,2), lastBestMove.substring(2,4), '#d63031');
      }
    }
  }

  function classifyDelta(delta) {
    const abs = Math.abs(delta);
    if (abs < 0.3) return { text: 'Good move', color: '#2ecc71' };
    if (abs < 0.7) return { text: 'Inaccuracy', color: '#f1c40f' };
    if (abs < 1.5) return { text: 'Mistake', color: '#e67e22' };
    return { text: 'Blunder', color: '#e74c3c', highlight: true };
  }

  function formatEval(value, side) {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'string' && value.startsWith('#')) return `Mate ${value.replace('#','')}`;
    const score = side === 'black' ? -value : value;
    return `${(score / 100).toFixed(2)} cp`;
  }

  function monitorMoves() {
    const observer = new MutationObserver(() => analyzePosition());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function trackBlunders() {
    const observer = new MutationObserver(() => {
      const fen = extractFEN();
      if (fen && fen !== lastMoveFen && lastEval !== null) {
        previousEval = lastEval;
        lastMoveFen = fen;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    initWorker();
    observeBoard();
    monitorMoves();
    trackBlunders();
  }

  init();
})();
