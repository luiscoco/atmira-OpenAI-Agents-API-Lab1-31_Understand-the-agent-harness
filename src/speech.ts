export const masculineVoiceName = /\b(male|guy|david|mark|ryan|alex|daniel|oliver|fred|thomas)\b/i;

export function selectNarratorVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const englishVoices = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
  return englishVoices.find((voice) => masculineVoiceName.test(voice.name))
    || englishVoices.find((voice) => voice.default)
    || englishVoices[0]
    || null;
}
