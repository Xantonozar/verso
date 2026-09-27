'use strict';

/**
 * Poetic phrase library (plan step 79). The job payload carries facts; the
 * display text is rendered by the worker when the row is first written (a
 * retry re-renders only if nothing was inserted yet, so the stored phrase is
 * always one of these). `{actor}` falls back to "Someone" for anonymous
 * actors and system events (duel results).
 */
const TEMPLATES = {
  reaction: [
    '{actor} found an echo in your work.',
    '{actor} lingered at the edge of your poem.',
    'A new reaction brightened your page - {actor} was here.',
  ],
  comment: [
    '{actor} left a note beneath your lines.',
    'Words are waiting for you - {actor} commented.',
    '{actor} whispered a reply into your comments.',
  ],
  follow: [
    '{actor} started walking your path.',
    '{actor} now follows your verses.',
    'A new reader joined your circle - {actor}.',
  ],
  collab_turn: [
    '{actor} added the next lines to your shared poem.',
    'Your collab grew - {actor} took a turn.',
    '{actor} continued your relay poem.',
  ],
  duel_result: [
    'The votes are in - your duel has reached its final line.',
    'Your duel has closed; the result is waiting for you.',
    'The contest is decided - see how your poem fared.',
  ],
};

/**
 * Pick a phrase for the type and substitute the actor. split/join (not
 * String.replace) so `$` sequences in a displayName are never treated as
 * replacement patterns.
 */
function renderPoeticMessage({ type, actorName = null }, rng = Math.random) {
  const bank = TEMPLATES[type];
  if (!bank) throw new Error(`Unknown notification type: ${type}`);
  const template = bank[Math.floor(rng() * bank.length) % bank.length];
  return template.split('{actor}').join(actorName || 'Someone');
}

module.exports = { TEMPLATES, renderPoeticMessage };
