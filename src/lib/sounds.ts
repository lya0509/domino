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
      const sound = this.sounds[name];
      if (sound) {
        await sound.replayAsync();
      } else if (SOUND_URLS[name]) {
        // If not preloaded, try playing directly
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
