// Audio thread: hands the microphone's mono samples to the page in ~43 ms blocks.
// (AudioWorklet globals aren't in TypeScript's DOM lib, hence the declarations.)
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

const BLOCK = 2048

class Capture extends AudioWorkletProcessor {
  private buf = new Float32Array(BLOCK)
  private n = 0
  process(inputs: Float32Array[][]) {
    const ch = inputs[0]?.[0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === BLOCK) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(BLOCK); this.n = 0 }
      }
    }
    return true
  }
}

registerProcessor('grafi-capture', Capture)
