// Stockfish WASM loader adapted for Chrome extensions. Expects stockfish.wasm in the same directory.
// This loader wires a simple postMessage/onmessage API compatible with the stockfish-worker wrapper.

(function() {
  function loadEngine() {
    if (self.STOCKFISH_INSTANCE) return self.STOCKFISH_INSTANCE;

    const engine = {
      ready: false,
      listeners: [],
      stdout(text) {
        this.listeners.forEach((cb) => cb(text));
      },
      onmessage: null,
      postMessage(cmd) {
        if (!this.ready || !this.module || !this.module.ccall) return;
        this.module.ccall('uci_command', 'number', ['string'], [cmd]);
      },
      addMessageListener(fn) {
        this.listeners.push(fn);
      }
    };

    const wasmUrl = 'stockfish.wasm';

    fetch(wasmUrl)
      .then(response => response.arrayBuffer())
      .then(buffer => WebAssembly.instantiate(buffer, {}))
      .then(result => {
        engine.module = result.instance.exports;
        engine.ready = true;
        if (engine.onready) engine.onready();
      })
      .catch(err => console.error('Failed to load Stockfish WASM', err));

    self.STOCKFISH_INSTANCE = engine;
    self.STOCKFISH = () => engine;
    return engine;
  }

  loadEngine();
})();
