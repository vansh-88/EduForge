/**
 * Wrapping raw PCM in a WAV container.
 *
 * Gemini's TTS models return headerless PCM — the response's mimeType says
 * `audio/L16;codec=pcm;rate=24000`, and the bytes are nothing but samples. No
 * browser and no transcoder will play that, because nothing in the payload says
 * how to interpret it: sample rate, bit depth and channel count all live in a
 * header that isn't there.
 *
 * A WAV header is 44 fixed bytes, so adding one is pure arithmetic rather than a
 * reason to take on an audio dependency.
 */

/** Parses `audio/L16;codec=pcm;rate=24000` into the fields the header needs. */
export function parsePcmMimeType(mimeType = '') {
  const rate = /rate=(\d+)/i.exec(mimeType);
  const bits = /L(\d+)/i.exec(mimeType);

  return {
    sampleRate: rate ? Number(rate[1]) : 24000,
    bitsPerSample: bits ? Number(bits[1]) : 16,
    // Gemini's TTS output is mono, and the mime type carries no channel count to
    // read instead. Wrong here would play at double speed, so it is pinned rather
    // than guessed per response.
    channels: 1,
  };
}

/**
 * Prepends a canonical 44-byte RIFF/WAVE header to raw little-endian PCM.
 *
 * Returns a Buffer that is a complete, playable .wav file.
 */
export function pcmToWav(pcm, { sampleRate = 24000, bitsPerSample = 16, channels = 1 } = {}) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0, 'ascii');
  // Size of everything after this field: 36 + the sample data.
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');

  // "fmt " sub-chunk
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // sub-chunk size for PCM
  header.writeUInt16LE(1, 20); // audio format 1 = uncompressed PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** How long the given PCM will play for, in seconds. */
export function pcmDurationSeconds(pcm, { sampleRate = 24000, bitsPerSample = 16, channels = 1 } = {}) {
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  return bytesPerSecond > 0 ? pcm.length / bytesPerSecond : 0;
}
