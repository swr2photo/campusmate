import { VIDEO_MODES } from './chatVideoPolicy.js';

export function chatPreviewText(message, fallback = '') {
  const text = String(message?.text || fallback).trim();
  if (message?.mediaType === 'video' || text === '[วิดีโอ]') {
    const mode = VIDEO_MODES[message?.videoMode];
    const caption = text && text !== '[วิดีโอ]' ? `: ${text}` : '';
    return `วิดีโอ${mode ? ` · ${mode}` : ''}${caption}`;
  }
  return text;
}
