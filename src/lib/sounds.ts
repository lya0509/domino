import { Audio } from 'expo-av';

// Dejaremos los URLs vacíos por ahora para evitar el Error 403 de Pixabay.
// Cuando el usuario tenga sus audios, puede poner los URLs aquí o requerirlos localmente.
const SOUND_URLS = {
  chaching: '', // Win bet
  clap: '', // Win match
  slap: '', // Zapato
  pop: '', // New message
};

class SoundManager {
  private sounds: Record<string, Audio.Sound> = {};

  async preloadSounds() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const entries = Object.entries(SOUND_URLS);
      for (const [key, url] of entries) {
        if (!url) continue; // Skip empty URLs
        const { sound } = await Audio.Sound.createAsync({ uri: url });
        this.sounds[key] = sound;
      }
      console.log('✅ Sounds preloaded successfully');
    } catch (err) {
      console.log('Failed to preload sounds', err);
    }
  }

  async playSound(name: keyof typeof SOUND_URLS) {
    try {
      // Web Audio API Synthesizer (Zero network, 100% reliable sound on web/browsers)
      if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();

        if (name === 'pop') {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(500, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.08);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.08);
          return;
        }

        if (name === 'chaching') {
          // Coin sound (two bright bell tones)
          [1300, 1900].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
            gain.gain.setValueAtTime(0.35, ctx.currentTime + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.08);
            osc.stop(ctx.currentTime + i * 0.08 + 0.25);
          });
          return;
        }

        if (name === 'slap') {
          // Domino tile heavy slam / thud
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(150, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.6, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
          return;
        }

        if (name === 'clap') {
          // Victory Fanfare Chord
          [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);
            gain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.07 + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + idx * 0.07);
            osc.stop(ctx.currentTime + idx * 0.07 + 0.4);
          });
          return;
        }
      }

      // Native fallback
      const sound = this.sounds[name];
      if (sound) {
        await sound.replayAsync();
      } else if (SOUND_URLS[name]) {
        const { sound: tempSound } = await Audio.Sound.createAsync({ uri: SOUND_URLS[name] });
        await tempSound.playAsync();
      }
    } catch (err) {
      console.log('Error playing sound:', err);
    }
  }

  async unloadAll() {
    for (const sound of Object.values(this.sounds)) {
      await sound.unloadAsync();
    }
  }
}

export const sounds = new SoundManager();
