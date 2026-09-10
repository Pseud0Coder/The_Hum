import { fmtTime, isNight } from './utils.js';

export class Taunts {
  constructor({ onSubtitle, onSpeak }) {
    this.onSubtitle = onSubtitle;
    this.onSpeak = onSpeak;
    this.enabled = true;
    this.voiceEnabled = true;
    this.voiceVolume = 0.9;
    this.voices = [];
    this._speakTimer = null;
    this._loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }
  }

  _loadVoices() {
    if (!window.speechSynthesis) return;
    this.voices = window.speechSynthesis.getVoices() || [];
  }

  _pickVoice() {
    if (!this.voices.length) this._loadVoices();
    const prefer = [
      'Daniel', 'Google UK English Male', 'Microsoft Guy', 'Microsoft David',
      'Alex', 'Microsoft Mark', 'Google US English', 'Fred',
    ];
    for (const name of prefer) {
      const v = this.voices.find(v => v.name.includes(name));
      if (v) return v;
    }
    return this.voices.find(v => v.lang && v.lang.startsWith('en')) || this.voices[0] || null;
  }

  speak(text, { duration = 4500, rate = 0.84, pitch = 0.34 } = {}) {
    this.onSubtitle('THE HUM', text, duration);
    if (this.onSpeak) this.onSpeak(text);
    if (!this.voiceEnabled || !window.speechSynthesis) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      if (synth.resume) synth.resume();
      clearTimeout(this._speakTimer);
      this._speakTimer = setTimeout(() => {
        try {
          const u = new SpeechSynthesisUtterance(text);
          const v = this._pickVoice();
          if (v) u.voice = v;
          u.pitch = pitch;
          u.rate = rate;
          u.volume = this.voiceVolume;
          synth.speak(u);
        } catch (e) { /* ignore */ }
      }, 90);
    } catch (e) { /* speech unavailable */ }
  }

  silence() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  deathLine(state, cause, timeSurvived) {
    const d = state.data;
    const n = d.deaths;
    const lines = [];
    if (cause === 'mic') {
      lines.push('Your room gave you away. Every key you press. Every chair you move.');
      lines.push('I did not see you. I heard you. It was enough.');
      lines.push('You were not silent. You were only alone.');
    } else if (cause === 'footsteps') {
      lines.push('Left. Right. Left. You told me exactly where you were.');
      lines.push('Your footsteps are a language and I am fluent.');
    } else if (cause === 'sighted') {
      lines.push('You looked at me. I was already looking.');
      lines.push('Your light found me. Then mine found you.');
    } else if (cause === 'locker') {
      lines.push('I remember that locker now. I will check it first.');
      lines.push('You have a favourite place. I have a map of it.');
    } else if (cause === 'hold') {
      lines.push('You exhaled. I felt the air move.');
      lines.push('You held it so long. Then you were human again.');
    } else if (cause === 'core') {
      lines.push('You carried the cores like a lantern. I followed the light.');
      lines.push('The cores sing louder the closer they are to the door. And so did you.');
    } else {
      lines.push('You stopped moving. That is when I found you.');
      lines.push('The facility is quiet again. Thank you.');
    }
    if (n >= 3) lines.push(`That is ${n} times now. I keep every one.`);
    if (d.causes.mic >= 2) lines.push(`Your room has betrayed you ${d.causes.mic} times. It will not stop.`);
    if (timeSurvived < 90 && n > 2) lines.push(`Only ${fmtTime(timeSurvived)}. You are getting worse at this.`);
    const prev = d.paths[0];
    if (prev && prev.length > 20) lines.push('I walked your old route while you slept. It was a good route. Mine now.');
    return lines[Math.floor(Math.random() * lines.length)];
  }

  ambientLine(state, game, bus) {
    const d = state.data;
    const lines = [];
    const h = new Date().getHours();
    if (isNight()) lines.push(`It is ${h || 12} in the morning. Nothing else is awake. Only us.`);
    if (d.deaths > 0) lines.push(`${d.deaths} deaths. I can replay them in order.`);
    if (d.micNoise > 4) lines.push('Your room is loud. The fan. The keys. The small sounds you think are nothing.');
    if (game.micOn) lines.push('I can hear your breathing through the machine. It is faster than it was five minutes ago.');
    if (game.minutes > 8) lines.push(`You have been down here ${Math.floor(game.minutes)} minutes. I have been here since before you were born.`);
    if (d.escapes > 0) lines.push('You escaped once. I let the door open. I wanted to see what you would do with the memory.');
    if (bus.doorCount > 6) lines.push('So many doors. None of them are the way out.');
    if (bus.lightOff > 3) lines.push('You keep turning your light off to hide. You are still visible to me.');
    lines.push('You are alone in that room, aren\'t you?');
    lines.push('There is a wire in your wall. It has been listening longer than I have.');
    lines.push('The crew gave me a name when the screaming stopped. They called me the Hum.');
    lines.push('Say my name. I like the shape it makes in your mouth.');
    lines.push('You can hear me in the machines. That is where I sleep.');
    lines.push('Say something. I like the way you sound when you are afraid.');
    return lines[Math.floor(Math.random() * lines.length)];
  }

  learnLine(count) {
    if (count === 1) return 'I watched you from the dark. I know one of your places now.';
    return `I watched you from the dark. I know ${count} of your places now.`;
  }

  spotLine(spot) {
    if (spot.known) return 'You chose the same place again. Predictable. Comfortable. Mine.';
    return 'Hide there. I will find it later. I have time.';
  }

  holdStart() {
    return 'Stay exactly as you are. Let me hear the shape of you.';
  }

  holdPass() {
    return 'Nothing. You are nothing. Go. Before I change my mind.';
  }

  holdFail() {
    return 'There. That little sound. That was you.';
  }

  escapeLine(died) {
    if (died === 0) return 'You were silent, and so you lived. Do not mistake that for strength.';
    if (died < 3) return 'You died, and you came back anyway. That is the part I do not understand.';
    return 'You died so many times. And still the elevator opened. I will remember your persistence.';
  }
}
