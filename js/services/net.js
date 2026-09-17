// Serverless peer-to-peer chat over WebRTC.
//
// There is no signalling server: one player generates an offer code, sends it
// to a friend by any means they like, and pastes the answer code back. Codes
// are gzipped and base64url-encoded — the previous build called this
// "LZString" but the implementation was a bare btoa(), which applied no
// compression at all and threw outright on any non-Latin1 character.

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const ICE_TIMEOUT_MS = 2500;

// --- code encoding ---------------------------------------------------------

function bytesToBase64Url(bytes) {
  let binary = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on large SDPs
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const normalised = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function collapse(stream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeCode(value) {
  const json = JSON.stringify(value);
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'undefined') return 'r' + bytesToBase64Url(raw);
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return 'z' + bytesToBase64Url(await collapse(stream));
}

export async function decodeCode(code) {
  const trimmed = code.trim();
  const marker = trimmed[0];
  const bytes = base64UrlToBytes(trimmed.slice(1));
  if (marker === 'r') return JSON.parse(new TextDecoder().decode(bytes));
  if (marker !== 'z') throw new Error('Unrecognised code format');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(await collapse(stream)));
}

// --- peer ------------------------------------------------------------------

export class PeerService {
  #pc = null;
  #channel = null;
  #listeners = { message: new Set(), status: new Set() };
  #status = 'idle';

  get status() {
    return this.#status;
  }

  get connected() {
    return this.#channel?.readyState === 'open';
  }

  on(event, fn) {
    this.#listeners[event].add(fn);
    return () => this.#listeners[event].delete(fn);
  }

  #emit(event, payload) {
    this.#listeners[event].forEach(fn => fn(payload));
  }

  #setStatus(status) {
    this.#status = status;
    this.#emit('status', status);
  }

  #createConnection() {
    this.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.#setStatus(state);
      }
    };
    pc.ondatachannel = event => this.#attachChannel(event.channel);
    this.#pc = pc;
    return pc;
  }

  #attachChannel(channel) {
    this.#channel = channel;
    channel.onopen = () => this.#setStatus('connected');
    channel.onclose = () => this.#setStatus('closed');
    channel.onmessage = event => {
      // Anything arriving over the wire is untrusted: parse defensively and
      // only ever surface it as text.
      try {
        const payload = JSON.parse(event.data);
        if (typeof payload?.content !== 'string') return;
        this.#emit('message', {
          sender: String(payload.sender ?? 'Peer').slice(0, 24),
          content: payload.content.slice(0, 500),
        });
      } catch {
        // ignore malformed frames
      }
    };
  }

  /** Waits for ICE gathering, but never longer than ICE_TIMEOUT_MS. */
  #awaitIce(pc) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(timer);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, ICE_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /** Host: produce an offer code to send to a friend. */
  async createOffer() {
    const pc = this.#createConnection();
    this.#attachChannel(pc.createDataChannel('bertdash'));
    await pc.setLocalDescription(await pc.createOffer());
    await this.#awaitIce(pc);
    this.#setStatus('awaiting-answer');
    return encodeCode(pc.localDescription);
  }

  /** Guest: consume an offer code and produce an answer code. */
  async acceptOffer(code) {
    const description = await decodeCode(code);
    const pc = this.#createConnection();
    await pc.setRemoteDescription(description);
    await pc.setLocalDescription(await pc.createAnswer());
    await this.#awaitIce(pc);
    this.#setStatus('awaiting-peer');
    return encodeCode(pc.localDescription);
  }

  /** Host: finish the handshake with the friend's answer code. */
  async acceptAnswer(code) {
    if (!this.#pc) throw new Error('Generate an invite code first');
    await this.#pc.setRemoteDescription(await decodeCode(code));
    this.#setStatus('connecting');
  }

  send(payload) {
    if (!this.connected) return false;
    this.#channel.send(JSON.stringify(payload));
    return true;
  }

  close() {
    this.#channel?.close();
    this.#pc?.close();
    this.#channel = null;
    this.#pc = null;
  }
}

export const peer = new PeerService();
