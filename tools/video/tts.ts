// Speech with edge-tts (free neural voices, Python package `edge-tts`).
// One file per sentence, cached by content (voice + text), silence trimmed at start and end.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Clip {
  text: string;
  file: string;
  duration: number;
}

export const VOICE = process.env.HG_VOICE || 'de-DE-SeraphinaMultilingualNeural';

// Was die Stimme falsch betont, bekommt hier eine Lautschrift; Untertitel zeigen den Originaltext.
const SPOKEN: [RegExp, string][] = [
  [/\bNAS\b/g, 'Nass'],
  [/\bZIP\b/g, 'Zip'],
]

export const spoken = (text: string) => SPOKEN.reduce((t, [re, to]) => t.replace(re, to), text);

export function probe(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  return Number.parseFloat(out.toString().trim());
}

export function synthesize(texts: string[], cacheDir: string, voice = VOICE): Clip[] {
  mkdirSync(cacheDir, { recursive: true });
  return texts.map((text) => {
    const say = spoken(text);
    const hash = createHash('sha256').update(`${voice}\n${say}`).digest('hex').slice(0, 32);
    const mp3 = join(cacheDir, `${hash}.mp3`);
    const wav = join(cacheDir, `${hash}.wav`);
    if (!existsSync(wav)) {
      if (!existsSync(mp3)) {
        execFileSync('python', ['-m', 'edge_tts', '--voice', voice, '--text', say, '--write-media', mp3], { stdio: ['ignore', 'ignore', 'inherit'] });
        console.log('  spoken: ' + text);
      }
      const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mp3, '-af', `${trim},areverse,${trim},areverse`, '-ac', '1', '-ar', '24000', wav]);
    }
    return { text, file: wav, duration: probe(wav) };
  });
}
