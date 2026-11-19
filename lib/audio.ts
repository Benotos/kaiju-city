"use client";

type TradeSide = "buy" | "sell";

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let reverb: ConvolverNode | null = null;
let enabled = false;
let noiseBuffer: AudioBuffer | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass({ latencyHint: "interactive" });
    masterGain = audioContext.createGain();
    masterGain.gain.value = enabled ? 0.62 : 0;

    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;
    masterGain.connect(compressor);
    compressor.connect(audioContext.destination);

    reverb = audioContext.createConvolver();
    const impulseLength = Math.floor(audioContext.sampleRate * 1.15);
    const impulse = audioContext.createBuffer(2, impulseLength, audioContext.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < impulseLength; i += 1) {
        const decay = Math.pow(1 - i / impulseLength, 3.2);
        samples[i] = (Math.random() * 2 - 1) * decay * 0.42;
      }
    }
    reverb.buffer = impulse;
    const wet = audioContext.createGain();
    wet.gain.value = 0.22;
    reverb.connect(wet);
    wet.connect(compressor);

    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i += 1) noise[i] = Math.random() * 2 - 1;
  }

  return audioContext;
}

export function setTradeSoundEnabled(next: boolean) {
  enabled = next;
  const context = getAudioContext();
  if (!context || !masterGain) return;
  void context.resume();
  masterGain.gain.cancelScheduledValues(context.currentTime);
  masterGain.gain.setTargetAtTime(next ? 0.62 : 0, context.currentTime, 0.035);
}

function envelope(gain: GainNode, start: number, peak: number, attack: number, end: number) {
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + end);
}

function tone(
  context: AudioContext,
  frequency: number,
  endFrequency: number,
  start: number,
  duration: number,
  volume: number,
  wave: OscillatorType = "sine",
  sendToReverb = true,
) {
  if (!masterGain || !compressor) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
  envelope(gain, start, volume, Math.min(0.025, duration * 0.12), duration);
  oscillator.connect(gain);
  gain.connect(masterGain);
  if (sendToReverb && reverb) {
    const send = context.createGain();
    send.gain.value = 0.22;
    gain.connect(send);
    send.connect(reverb);
  }
  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
}

function noiseHit(context: AudioContext, start: number, duration: number, volume: number, cutoff: number, highpass = false) {
  if (!noiseBuffer || !masterGain) return;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = highpass ? "highpass" : "lowpass";
  filter.frequency.setValueAtTime(cutoff, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.28), start + duration);
  filter.Q.value = highpass ? 0.7 : 0.9;
  const gain = context.createGain();
  envelope(gain, start, volume, 0.006, duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(start);
  source.stop(start + duration + 0.02);
}

export function playTradeSound(side: TradeSide, amount: number) {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context || !masterGain) return;
  if (context.state === "suspended") void context.resume();

  const now = context.currentTime + 0.012;
  const scale = Math.min(1.45, Math.max(0.58, 0.72 + Math.log1p(Math.max(0, amount)) * 0.16));

  if (side === "buy") {
    // A clean, rising two-note glass chime with a soft analog body.
    tone(context, 520, 760, now, 0.18, 0.12 * scale, "sine");
    tone(context, 790, 1180, now + 0.055, 0.24, 0.085 * scale, "sine");
    tone(context, 1560, 1320, now + 0.07, 0.15, 0.027 * scale, "triangle", false);
    tone(context, 130, 176, now, 0.11, 0.045 * scale, "triangle", false);
    noiseHit(context, now, 0.045, 0.018 * scale, 5200, true);
  } else {
    // A low cinematic hit, gritty transient and short, dark tail.
    tone(context, 92, 38, now, 0.62, 0.25 * scale, "sine");
    tone(context, 188, 54, now + 0.012, 0.34, 0.12 * scale, "triangle");
    tone(context, 430, 92, now + 0.02, 0.23, 0.055 * scale, "sawtooth");
    noiseHit(context, now, 0.34, 0.16 * scale, 1150);
    noiseHit(context, now + 0.025, 0.19, 0.045 * scale, 3600, true);
  }
}
