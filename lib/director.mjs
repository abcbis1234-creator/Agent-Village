// lib/director.mjs — deterministic pre-production for short-form video.
//
// This is the zero-dependency "creative workbench" behind /director.html and
// POST /api/director/plan. It turns a plain-language brief into an editable
// project: a storyboard, a multi-track timeline, caption cues, a palette and
// type system, an audio brief, a publish kit, and interchange files that a real
// editor can ingest (SRT, VTT, CSV, CMX 3600 EDL, FCPXML, OTIO).
//
// Deliberate boundaries:
//   - No network calls, no media fetching, no filesystem writes.
//   - Every value is deterministic from the brief + seed, so the same input
//     produces the same plan and exports.
//   - The output is a plan, not a promise of a rendered video. Rendering stays
//     in the composer/editor of the user's choice.

export const DIRECTOR_SCHEMA = 'agent-village/director-project@1';

export const ASPECTS = Object.freeze({
  '9:16': { width: 1080, height: 1920, label: 'Vertical 9:16', safe: 'Keep text inside the middle 80%; leave room for platform UI.' },
  '16:9': { width: 1920, height: 1080, label: 'Landscape 16:9', safe: 'Keep text inside the title-safe 90% area.' },
  '1:1': { width: 1080, height: 1080, label: 'Square 1:1', safe: 'Center the subject; feeds crop the edges.' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait 4:5', safe: 'Keep text above the bottom 15% for feed captions.' },
});

export const PLATFORMS = Object.freeze({
  tiktok: {
    label: 'TikTok', aspect: '9:16', durationSeconds: 21, hashtags: ['#tiktok', '#fyp'],
    notes: ['Hook in the first 1–2 seconds.', 'Keep captions out of the top and bottom UI zones.', 'Loop the final frame back into the first when the story allows.'],
  },
  reels: {
    label: 'Instagram Reels', aspect: '9:16', durationSeconds: 30, hashtags: ['#reels', '#instagram'],
    notes: ['Keep text away from the right-side action rail.', 'Design for sound-off viewing first.', 'A 20–40 second cut is a safe target; check the current limit before exporting.'],
  },
  shorts: {
    label: 'YouTube Shorts', aspect: '9:16', durationSeconds: 40, hashtags: ['#shorts', '#youtubeshorts'],
    notes: ['Earn the first 2 seconds; Shorts can be skipped instantly.', 'Keep captions inside the vertical safe area.', 'A clean loop improves repeat views.'],
  },
  youtube: {
    label: 'YouTube', aspect: '16:9', durationSeconds: 90, hashtags: ['#youtube', '#video'],
    notes: ['Use 16:9 unless this is intentionally a Short.', 'Chapters need a 00:00 start and a useful spread of timestamps.', 'The thumbnail and title carry more weight than the first frame.'],
  },
  linkedin: {
    label: 'LinkedIn', aspect: '4:5', durationSeconds: 45, hashtags: ['#linkedin', '#business'],
    notes: ['Assume sound-off; captions are mandatory.', 'A 4:5 or 1:1 feed crop usually reads better than 16:9.', 'Lead with the professional stake, not a TikTok-style hook.'],
  },
  square: {
    label: 'Square feed', aspect: '1:1', durationSeconds: 30, hashtags: ['#video', '#creative'],
    notes: ['1:1 survives the widest range of feed crops.', 'Center the subject and keep text compact.', 'Use the same cut as a teaser for vertical and landscape versions.'],
  },
});

export const TONE_NAMES = ['energetic', 'calm', 'premium', 'playful', 'documentary', 'technical'];
export const PACE_NAMES = ['slow', 'medium', 'fast'];
export const FPS_VALUES = [24, 25, 30, 60];

export const TONES = Object.freeze({
  energetic: {
    label: 'Energetic', paletteTheme: 'dark', type: 'bold',
    mood: 'driving, bright, confident', style: 'bold editorial photography, saturated color, crisp contrast',
    hook: ['Stop scrolling: {topic} in {duration} seconds.', 'The {kw} detail everyone gets wrong.', 'Nobody talks about this part of {topic}.'],
    cta: ['Save this for later.', 'Follow for the next breakdown.', 'Try it and tell me what changed.'],
    voice: {
      setup: ['No fluff — here is the setup.', 'This is the part everyone skips.'],
      build: ['Watch what happens next.', 'Here is the move.'],
      turn: ['And this is the turn.', 'Wait for it.'],
      proof: ['That is the proof.', 'Look at that.'],
      payoff: ['That is the payoff.', 'Worth it.'],
    },
  },
  calm: {
    label: 'Calm', paletteTheme: 'light', type: 'editorial',
    mood: 'warm, unhurried, reflective', style: 'soft natural light, muted palette, calm composition',
    hook: ['A quieter way to think about {topic}.', 'Slow down — {topic} is simpler than it looks.', 'The small detail that makes {topic} work.'],
    cta: ['Keep this for a slower day.', 'Share it with someone who needs it.', 'Try one small step today.'],
    voice: {
      setup: ['Start with the ordinary version.', 'Take a moment to notice the setup.'],
      build: ['Here is the simple move.', 'One change is enough.'],
      turn: ['Then something shifts.', 'Notice the difference.'],
      proof: ['The result is quiet but clear.', 'That is the evidence.'],
      payoff: ['This is the calmer version.', 'That is the whole point.'],
    },
  },
  premium: {
    label: 'Premium', paletteTheme: 'dark', type: 'editorial',
    mood: 'restrained, tactile, cinematic', style: 'premium product photography, controlled reflections, rich shadows',
    hook: ['{topic}, without the noise.', 'The details that make {topic} feel different.', 'Craft is the part you cannot fake.'],
    cta: ['Save this for the details.', 'Follow for the full craft breakdown.', 'See the full collection in the caption.'],
    voice: {
      setup: ['The setup is deliberately simple.', 'Start with the material.'],
      build: ['Every choice is intentional.', 'This is the craft.'],
      turn: ['Then the detail changes the read.', 'The difference is subtle, not small.'],
      proof: ['The finish is the proof.', 'Look at the edge.'],
      payoff: ['This is the finished object.', 'That is what craft looks like.'],
    },
  },
  playful: {
    label: 'Playful', paletteTheme: 'light', type: 'warm',
    mood: 'bouncy, curious, human', style: 'bright playful color, tactile props, candid energy',
    hook: ['Okay, {topic} is actually fun.', 'I did not expect {topic} to be this good.', 'Wait for the {kw} moment.'],
    cta: ['Save this for later.', 'Send it to the friend who needs it.', 'Try it and tag us.'],
    voice: {
      setup: ['Okay, here is the setup.', 'This is where it gets interesting.'],
      build: ['Watch this part.', 'Here is the fun bit.'],
      turn: ['And then it gets weird — in a good way.', 'Plot twist.'],
      proof: ['Yep, that actually worked.', 'That is the proof.'],
      payoff: ['Okay, that is the payoff.', 'Worth the wait.'],
    },
  },
  documentary: {
    label: 'Documentary', paletteTheme: 'dark', type: 'documentary',
    mood: 'observational, grounded, intimate', style: 'observational documentary photography, available light, honest texture',
    hook: ['The real story behind {topic}.', 'The story behind {topic} is not the one you expect.', 'This is what {topic} looks like up close.'],
    cta: ['Follow for the full story.', 'Save this for the context.', 'The full interview is in the caption.'],
    voice: {
      setup: ['This is the everyday context.', 'Start with what is actually there.'],
      build: ['Here is what the process looks like.', 'The work is less glamorous than the result.'],
      turn: ['Then the situation changes.', 'This is where the story turns.'],
      proof: ['The evidence is in the details.', 'This is what the record shows.'],
      payoff: ['That is the outcome.', 'This is where it landed.'],
    },
  },
  technical: {
    label: 'Technical', paletteTheme: 'dark', type: 'techno',
    mood: 'precise, clean, explanatory', style: 'clean technical illustration, precise geometry, neutral background',
    hook: ['How {topic} actually works.', 'The constraint that makes {topic} useful.', 'Three parts of {topic}, explained.'],
    cta: ['Save this as a reference.', 'Follow for the next teardown.', 'Full notes in the caption.'],
    voice: {
      setup: ['Here is the baseline configuration.', 'Start with the inputs.'],
      build: ['This is the mechanism.', 'Here is the step, in order.'],
      turn: ['Then the constraint changes the result.', 'This is the edge case.'],
      proof: ['The measurement confirms it.', 'That is the reproducible result.'],
      payoff: ['That is the working system.', 'This is the final configuration.'],
    },
  },
});

export const PACES = Object.freeze({
  slow: { label: 'Slow', bpmMin: 70, bpmMax: 90, cutHint: 'long holds; let details breathe' },
  medium: { label: 'Medium', bpmMin: 90, bpmMax: 115, cutHint: 'steady cuts; one idea per beat' },
  fast: { label: 'Fast', bpmMin: 115, bpmMax: 140, cutHint: 'short holds; cut on motion and sound' },
});

export const FORMATS = Object.freeze({
  json: { label: 'Director project', extension: 'json', contentType: 'application/json; charset=utf-8' },
  markdown: { label: 'Shot list (Markdown)', extension: 'md', contentType: 'text/markdown; charset=utf-8' },
  srt: { label: 'Captions (SRT)', extension: 'srt', contentType: 'application/x-subrip; charset=utf-8' },
  vtt: { label: 'Captions (WebVTT)', extension: 'vtt', contentType: 'text/vtt; charset=utf-8' },
  csv: { label: 'Shot list (CSV)', extension: 'csv', contentType: 'text/csv; charset=utf-8' },
  edl: { label: 'Timeline (CMX 3600 EDL)', extension: 'edl', contentType: 'text/plain; charset=utf-8' },
  fcpxml: { label: 'Timeline (FCPXML)', extension: 'fcpxml', contentType: 'application/xml; charset=utf-8' },
  otio: { label: 'Timeline (OpenTimelineIO)', extension: 'otio', contentType: 'application/json; charset=utf-8' },
  youtube: { label: 'Publish kit (text)', extension: 'txt', contentType: 'text/plain; charset=utf-8' },
});

const BEAT_ORDER = ['hook', 'setup', 'build', 'turn', 'proof', 'payoff', 'cta'];
const ROLE_TO_BEAT = {
  hook: 'hook', setup: 'setup', build: 'build', build2: 'build',
  turn: 'turn', detail: 'turn', proof: 'proof', reaction: 'proof',
  payoff: 'payoff', cta: 'cta',
};
const BEAT_META = {
  hook: { label: 'Hook', purpose: 'Stop the scroll and promise the payoff.' },
  setup: { label: 'Setup', purpose: 'Establish the routine, problem, or stakes.' },
  build: { label: 'Build', purpose: 'Show the first concrete step or mechanism.' },
  turn: { label: 'Turn', purpose: 'Introduce the contrast, twist, or upgrade.' },
  proof: { label: 'Proof', purpose: 'Show the result and let the evidence sit.' },
  payoff: { label: 'Payoff', purpose: 'Deliver the hero image and emotional summary.' },
  cta: { label: 'CTA', purpose: 'Tell the viewer exactly what to do next.' },
};

// Scene counts are explicit so the narrative shape is intentional rather than
// an accident of arithmetic.
const ROLES_BY_COUNT = Object.freeze({
  3: ['hook', 'build', 'cta'],
  4: ['hook', 'build', 'proof', 'cta'],
  5: ['hook', 'setup', 'build', 'payoff', 'cta'],
  6: ['hook', 'setup', 'build', 'proof', 'payoff', 'cta'],
  7: ['hook', 'setup', 'build', 'turn', 'proof', 'payoff', 'cta'],
  8: ['hook', 'setup', 'build', 'build2', 'turn', 'proof', 'payoff', 'cta'],
  9: ['hook', 'setup', 'build', 'build2', 'turn', 'detail', 'proof', 'payoff', 'cta'],
  10: ['hook', 'setup', 'build', 'build2', 'turn', 'detail', 'proof', 'reaction', 'payoff', 'cta'],
  11: ['hook', 'setup', 'build', 'build2', 'turn', 'detail', 'detail2', 'proof', 'reaction', 'payoff', 'cta'],
  12: ['hook', 'setup', 'build', 'build2', 'turn', 'detail', 'detail2', 'proof', 'reaction', 'reaction2', 'payoff', 'cta'],
});

const ROLE_DEFS = {
  hook: {
    weight: 1.0,
    shots: ['extreme close-up', 'macro detail', 'close-up', 'low-angle medium shot'],
    cameras: ['crash zoom', 'whip pan', 'slow push-in', 'locked-off'],
    lighting: ['hard key with a bright rim', 'golden-hour backlight', 'high-contrast studio light'],
    onScreen: ['STOP SCROLLING', 'WATCH THIS', 'WAIT FOR IT', 'THE 3-SECOND HOOK'],
    voice: ['Here is {topic} — in {duration} seconds.', 'This is the part everyone skips.', 'Let me show you the difference.', 'Everything you know about {topic} is about to change.'],
    actions: ['Open on a tight detail that snaps into focus as the first caption lands.', 'Start mid-motion, then settle just long enough to read the hook.', 'Reveal the subject from behind an obstacle, then cut to the promise.'],
    subjects: ['the most tactile detail of {topic}', 'the hero object', 'the moment before the reveal'],
    transitions: ['hard cut', 'whip pan', 'flash cut'],
    sounds: ['bass hit', 'whoosh', 'vinyl stop'],
    broll: ['texture macro', 'eyes reaction', 'environment detail'],
    notes: ['Land the first frame on motion; no logo intro.', 'The hook must read without sound.'],
  },
  setup: {
    weight: 1.2,
    shots: ['wide establishing shot', 'medium shot', 'over-the-shoulder', 'top-down'],
    cameras: ['slow pan', 'handheld follow', 'locked-off', 'tilt up'],
    lighting: ['soft window light', 'practical lamps', 'overcast daylight'],
    onScreen: ['THE SETUP', 'THE PROBLEM', 'WHERE IT STARTS', 'THE ROUTINE'],
    voice: ['Most people treat {topic} like a checklist.', 'This is what {topic} usually looks like.', 'Start with the everyday version — the one everyone recognizes.', 'Here is the baseline before anything changes.'],
    actions: ['Show the routine around {topic}: hands, tools, environment.', 'Let the problem play out in one unbroken shot.', 'Establish the location and the person who lives in it.'],
    subjects: ['the everyday routine around {topic}', 'the person using it', 'the workspace'],
    transitions: ['cut', 'match cut', 'L-cut'],
    sounds: ['room tone', 'camera click', 'paper rustle'],
    broll: ['hands at work', 'wide environment', 'routine detail'],
    notes: ['Keep this under one breath; the setup is not the story.', 'Use one location so the turn lands harder.'],
  },
  build: {
    weight: 1.0,
    shots: ['medium close-up', 'tracking shot', 'handheld close-up', 'detail insert'],
    cameras: ['push in', 'follow', 'orbit', 'rack focus'],
    lighting: ['soft key', 'golden hour', 'clean studio fill'],
    onScreen: ['HERE IS HOW', 'THE FIRST STEP', 'THE METHOD', 'WATCH THE DETAIL'],
    voice: ['Here is the simple version: {benefit}.', 'The first step is smaller than it looks.', 'This is where the work actually happens.', 'Do this one thing and the rest gets easier.'],
    actions: ['Demonstrate the first concrete step; keep the frame moving.', 'Show the mechanism close enough that the viewer can copy it.', 'Cut between the action and the detail that proves it.'],
    subjects: ['hands using {topic}', 'the mechanism', 'the key step'],
    transitions: ['cut', 'match cut', 'speed ramp'],
    sounds: ['click', 'tick', 'soft impact'],
    broll: ['process close-up', 'hands in motion', 'tool detail'],
    notes: ['One idea per shot; let the caption do the explaining.', 'Match the cut to the action, not the beat.'],
  },
  build2: {
    weight: 0.95,
    shots: ['detail insert', 'medium shot', 'tracking shot', 'top-down'],
    cameras: ['follow', 'slow slide', 'orbit', 'rack focus'],
    lighting: ['clean studio fill', 'soft directional', 'practical glow'],
    onScreen: ['STEP TWO', 'KEEP GOING', 'THE SECOND MOVE', 'SAME IDEA, BETTER'],
    voice: ['Then repeat it with one variable changed.', 'The second pass is where it becomes repeatable.', 'Same move, cleaner result.', 'This is the part that makes it stick.'],
    actions: ['Repeat the action with one variable changed so the improvement is visible.', 'Cut from the first pass to the second pass in the same framing.', 'Show the repeatable version, not a one-off.'],
    subjects: ['the repeatable step', 'the second pass', 'the improved version'],
    transitions: ['match cut', 'cut', 'speed ramp'],
    sounds: ['tick', 'soft impact', 'whoosh'],
    broll: ['second pass', 'side-by-side', 'process detail'],
    notes: ['Use identical framing for the comparison.', 'Do not add a new idea here; compound the first one.'],
  },
  turn: {
    weight: 1.15,
    shots: ['split-screen', 'close-up', 'profile shot', 'whip-pan reveal'],
    cameras: ['whip pan', 'snap zoom', 'slow push-in', 'orbit'],
    lighting: ['hard contrast', 'colored practical', 'rim light'],
    onScreen: ['THEN THIS HAPPENS', 'THE TURN', 'BEFORE / AFTER', 'BUT HERE IS THE TWIST'],
    voice: ['Then the detail changes everything.', 'And this is where the old way falls apart.', 'The difference is not the tool — it is the order.', 'Watch what happens when you change one thing.'],
    actions: ['Reveal the contrast: the old way vs. the new way.', 'Cut on the turn so the change feels physical.', 'Show the same action twice, with one variable changed.'],
    subjects: ['the before/after', 'the turning point', 'the same shot, changed'],
    transitions: ['whip pan', 'match cut', 'hard cut', 'flash cut'],
    sounds: ['riser', 'bass drop', 'snap'],
    broll: ['before/after pair', 'reaction', 'detail change'],
    notes: ['Make the contrast legible in one frame.', 'Do not explain the twist before showing it.'],
  },
  detail: {
    weight: 0.8,
    shots: ['macro', 'extreme close-up', 'top-down detail', 'insert'],
    cameras: ['locked-off', 'slow slide', 'rack focus', 'micro push-in'],
    lighting: ['soft directional', 'hard accent', 'practical glow'],
    onScreen: ['LOOK CLOSER', 'THE DETAIL', 'THIS IS THE DIFFERENCE', 'ZOOM IN'],
    voice: ['Look closer — this is where the difference lives.', 'The detail is the whole argument.', 'This is the part the wide shot hides.', 'One texture tells the whole story.'],
    actions: ['Hold on the texture, edge, or interface detail that proves quality.', 'Let the detail fill the frame; no cutaways.', 'Use a slow slide so the viewer can inspect it.'],
    subjects: ['the texture of {topic}', 'the edge detail', 'the interface detail'],
    transitions: ['cut', 'match cut'],
    sounds: ['fabric rustle', 'soft click', 'ambient hum'],
    broll: ['macro texture', 'edge detail', 'slow slide'],
    notes: ['Hold longer than feels comfortable; this is the proof.', 'Keep the background clean so the detail reads.'],
  },
  detail2: {
    weight: 0.75,
    shots: ['insert', 'macro', 'profile detail', 'top-down'],
    cameras: ['slow slide', 'rack focus', 'locked-off'],
    lighting: ['hard accent', 'practical glow', 'soft directional'],
    onScreen: ['ONE MORE DETAIL', 'STAY HERE', 'THE TELL', 'CLOSE ENOUGH'],
    voice: ['One more detail makes the case.', 'Stay here for a second longer.', 'This is the tell that separates the versions.', 'The close-up is doing the convincing.'],
    actions: ['Choose a second detail that supports the first without repeating it.', 'Shift the angle so the viewer sees a new face of the same subject.', 'End on a detail that pays off the hook.'],
    subjects: ['the second detail', 'the supporting texture', 'the reveal edge'],
    transitions: ['cut', 'match cut'],
    sounds: ['soft click', 'ambient hum', 'fabric rustle'],
    broll: ['second detail', 'alternate angle', 'texture'],
    notes: ['Do not repeat the same detail twice.', 'Use a different focal length to keep it fresh.'],
  },
  proof: {
    weight: 1.0,
    shots: ['split-screen', 'medium wide shot', 'reaction close-up', 'before/after'],
    cameras: ['locked-off', 'slow pull-out', 'handheld follow'],
    lighting: ['natural light', 'soft key', 'golden hour'],
    onScreen: ['THE RESULT', 'PROOF', 'BEFORE / AFTER', 'IT WORKS'],
    voice: ['The result speaks for itself.', 'That is the before. This is the after.', 'The proof is in the repeatable result.', 'Same input, better output.'],
    actions: ['Show the result and a real reaction; let the evidence sit for a beat.', 'Cut between the result and the person seeing it.', 'Hold the after frame long enough to compare.'],
    subjects: ['the finished result', 'the person reacting', 'the side-by-side'],
    transitions: ['cut', 'match cut', 'dissolve'],
    sounds: ['soft impact', 'crowd reaction', 'camera shutter'],
    broll: ['result hero', 'reaction', 'side-by-side'],
    notes: ['Do not oversell; let the result carry the claim.', 'A real reaction beats a staged smile.'],
  },
  reaction: {
    weight: 0.7,
    shots: ['close-up', 'over-the-shoulder', 'reaction shot', 'two-shot'],
    cameras: ['handheld', 'locked-off', 'slow push-in'],
    lighting: ['soft window light', 'practical ambiance', 'golden hour'],
    onScreen: ['WAIT FOR IT', 'THE MOMENT', 'THAT IS IT', 'REAL REACTION'],
    voice: ['That is the moment it clicks.', 'And that reaction is the whole point.', 'This is why people keep coming back.', 'No script needed for that one.'],
    actions: ['Catch the honest reaction — a nod, a smile, a double-take.', 'Stay on the face one beat longer than the cut wants.', 'Let the reaction happen off-center; keep the context in frame.'],
    subjects: ['a real reaction', 'the person seeing the result', 'the moment it lands'],
    transitions: ['cut', 'L-cut'],
    sounds: ['soft laugh', 'breath', 'room tone'],
    broll: ['reaction close-up', 'hands to face', 'shared look'],
    notes: ['Never direct the reaction into a fake smile.', 'Use sound design to lift the moment.'],
  },
  reaction2: {
    weight: 0.65,
    shots: ['two-shot', 'over-the-shoulder', 'reaction close-up'],
    cameras: ['handheld', 'locked-off'],
    lighting: ['practical ambiance', 'soft window light'],
    onScreen: ['SAME', 'THE SHARED MOMENT', 'ONE MORE LOOK'],
    voice: ['And the second reaction says it better.', 'That look is the review.', 'One more beat, then let it go.'],
    actions: ['Cut to a second person or a second angle for the reaction.', 'Let the reaction overlap the previous line.', 'End the beat on the shared look.'],
    subjects: ['the second reaction', 'the shared look', 'the room responding'],
    transitions: ['L-cut', 'cut'],
    sounds: ['soft laugh', 'breath', 'room tone'],
    broll: ['second reaction', 'shared look', 'room detail'],
    notes: ['Avoid repeating the same reaction shot.', 'Use the second angle to widen the emotional context.'],
  },
  payoff: {
    weight: 1.1,
    shots: ['hero wide shot', 'orbit', 'slow-motion beauty shot', 'clean product shot'],
    cameras: ['orbit', 'slow pull-out', 'crane up', 'locked-off'],
    lighting: ['golden hour', 'soft studio key', 'rim-lit silhouette'],
    onScreen: ['THIS IS IT', 'THE PAYOFF', 'WORTH IT', '{topicUpper}'],
    voice: ['This is {topic} when it finally works.', 'That is the version worth sharing.', 'This is the result you came for.', 'And that is the whole transformation.'],
    actions: ['Hero shot of {topic}; slow movement, clean background, room to breathe.', 'Pull out to reveal the full result.', 'Let the hero frame hold for a full beat before the CTA.'],
    subjects: ['{topic} as the hero', 'the full result', 'the transformed scene'],
    transitions: ['slow dissolve', 'cut', 'fade'],
    sounds: ['swell', 'soft impact', 'ambient pad'],
    broll: ['hero wide', 'orbit', 'environment reveal'],
    notes: ['This frame is the thumbnail candidate.', 'Keep the hero frame clean enough to crop.'],
  },
  cta: {
    weight: 0.8,
    shots: ['end card', 'graphic layout', 'close-up with text', 'static hero'],
    cameras: ['locked-off', 'slow push-in'],
    lighting: ['clean studio', 'soft gradient', 'practical glow'],
    onScreen: ['SAVE THIS', 'TRY IT', 'FOLLOW FOR MORE', 'FULL GUIDE ↓'],
    voice: ['Save this for later.', 'Follow for the next breakdown.', 'Try it and tell me what changed.', 'Full guide in the caption.'],
    actions: ['End card with the CTA; keep the background moving subtly.', 'Cut to a clean graphic with one action.', 'Return to the hero frame and let the CTA land.'],
    subjects: ['the end card', 'the CTA graphic', 'the hero frame'],
    transitions: ['cut', 'fade to black'],
    sounds: ['pop', 'click', 'outro hit'],
    broll: ['end card', 'logo-free graphic', 'hero frame'],
    notes: ['One CTA only.', 'Make the CTA readable in the thumbnail.'],
  },
};

const STOPWORDS = new Set(`
a an the and or but for of on in to with at by from about into over after before
my our your their his her its this that these those is are was were be been being
make create produce edit design shoot film generate build write plan draft video
reel reels short shorts tiktok youtube promo advert commercial teaser trailer
second seconds sec secs minute minutes min mins new quick simple best
`.trim().split(/\s+/));

const SETTING_RULES = [
  {
    re: /\b(coffee|cafe|café|bakery|pastry|food|restaurant|chef|kitchen|menu)\b/i,
    setting: 'a warm café counter with soft window light',
    props: ['ceramic cup', 'linen napkin', 'menu card'],
    broll: ['beans pouring', 'steam rising', 'hands lifting a cup', 'pastry crumb detail'],
  },
  {
    re: /\b(backpack|outdoor|travel|hike|camp|trail|adventure|survival)\b/i,
    setting: 'a trailhead at golden hour',
    props: ['pack', 'map', 'water bottle'],
    broll: ['straps and stitching', 'pack on the trail', 'boots on gravel', 'sun through trees'],
  },
  {
    re: /\b(fitness|gym|workout|run|running|training|yoga|health)\b/i,
    setting: 'a bright training floor with clean lines',
    props: ['water bottle', 'towel', 'mat'],
    broll: ['chalked hands', 'shoe grip', 'breath in cold air', 'sweat detail'],
  },
  {
    re: /\b(fashion|clothing|wear|beauty|skincare|makeup|style|jewelry)\b/i,
    setting: 'a clean studio with soft directional light',
    props: ['fabric swatch', 'mirror', 'product tray'],
    broll: ['fabric moving', 'texture close-up', 'hands styling', 'mirror reflection'],
  },
  {
    re: /\b(app|software|saas|tech|ai|tool|platform|dashboard|code|developer)\b/i,
    setting: 'a minimal desk with a glowing screen',
    props: ['laptop', 'notebook', 'phone'],
    broll: ['screen glow', 'typing hands', 'cursor movement', 'desk detail'],
  },
  {
    re: /\b(home|interior|furniture|design|decor|garden|plant)\b/i,
    setting: 'a calm interior with practical lamps',
    props: ['ceramic vase', 'textile', 'plant'],
    broll: ['light across a wall', 'texture of fabric', 'plant leaves', 'room wide'],
  },
  {
    re: /\b(music|audio|sound|podcast|studio|song|band)\b/i,
    setting: 'a warm recording studio with foam panels',
    props: ['headphones', 'microphone', 'notebook'],
    broll: ['fader move', 'headphones on', 'waveform close-up', 'room mic'],
  },
  {
    re: /\b(art|design|illustration|painting|craft|maker|diy)\b/i,
    setting: 'a sunlit workbench with tools within reach',
    props: ['brush', 'paper', 'tool roll'],
    broll: ['ink spreading', 'tool selection', 'paper texture', 'hands in frame'],
  },
  {
    re: /\b(finance|business|startup|money|invest|market|sales)\b/i,
    setting: 'a quiet office with a city window',
    props: ['notebook', 'phone', 'coffee cup'],
    broll: ['notes on paper', 'window city', 'handshake', 'screen detail'],
  },
  {
    re: /\b(pet|dog|cat|animal|puppy|kitten)\b/i,
    setting: 'a bright home with soft rugs',
    props: ['toy', 'bowl', 'blanket'],
    broll: ['paw detail', 'tail wag', 'pet looking up', 'toy in motion'],
  },
  {
    re: /\b(game|gaming|esports|console|player)\b/i,
    setting: 'a dark room lit by screen glow',
    props: ['controller', 'headset', 'energy drink'],
    broll: ['controller grip', 'screen reflection', 'headset detail', 'reaction'],
  },
];

const GENERIC_BROLL = ['hands entering frame', 'environment wide', 'texture detail', 'reaction shot', 'movement in the background'];
const GENERIC_PROPS = ['hero object', 'notebook', 'textured surface'];

function fail(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clause(value) {
  const text = cleanText(value, 600);
  return !text || /[.!?]$/.test(text) ? text : `${text}.`;
}

function sentenceCase(value) {
  const text = cleanText(value, 160);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function titleCase(value) {
  const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'on', 'to', 'with', 'at', 'by', 'from']);
  return cleanText(value, 160).split(' ').map((word, index) => {
    if (!word) return word;
    if (index > 0 && small.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function fill(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

function trimWords(value, maxChars) {
  const text = cleanText(value, Math.max(maxChars * 3, maxChars));
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.55 ? lastSpace : maxChars).trim()}…`;
}

/* ------------------------------------------------------------------ */
/* Colour + type                                                       */
/* ------------------------------------------------------------------ */

function hslToRgb(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function hslToHex(hue, saturation, lightness) {
  return rgbToHex(hslToRgb(hue, saturation, lightness));
}

function hexToRgb(hex) {
  const text = String(hex ?? '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(text)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
  };
}

function luminance(rgb) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

function adjustForContrast(hue, saturation, lightness, backgroundLuminance, target) {
  const direction = backgroundLuminance < 0.2 ? 1 : -1;
  let best = { hue, saturation, lightness, ratio: 0 };
  for (let step = 0; step < 22; step++) {
    const nextLightness = clamp(lightness + direction * step * 4, 4, 96);
    const ratio = contrastRatio(luminance(hslToRgb(hue, saturation, nextLightness)), backgroundLuminance);
    if (ratio > best.ratio) best = { hue, saturation, lightness: nextLightness, ratio };
    if (ratio >= target) return best;
  }
  return best;
}

function paletteName(hue) {
  if (hue < 20 || hue >= 345) return 'Ember';
  if (hue < 50) return 'Amber';
  if (hue < 90) return 'Citrus';
  if (hue < 150) return 'Meadow';
  if (hue < 190) return 'Lagoon';
  if (hue < 230) return 'Sky';
  if (hue < 270) return 'Iris';
  if (hue < 310) return 'Orchid';
  return 'Rose';
}

function buildPalette(seed, tone) {
  const toneData = TONES[tone];
  const baseHue = hashString(`${seed}:palette`) % 360;
  const accentHue = (baseHue + [40, 150, 180, 210, 300][hashString(`${seed}:accent`) % 5]) % 360;
  const dark = toneData.paletteTheme === 'dark';
  const backgroundLightness = dark ? 8 : 96;
  const surfaceLightness = dark ? 13 : 91;
  const background = hslToHex(baseHue, dark ? 22 : 18, backgroundLightness);
  const surface = hslToHex(baseHue, dark ? 18 : 14, surfaceLightness);
  const backgroundLuminance = luminance(hexToRgb(background));
  const inkBase = hslToHex(baseHue, 12, dark ? 97 : 10);
  const primary = adjustForContrast(baseHue, 78, dark ? 58 : 42, backgroundLuminance, 4.5);
  const accent = adjustForContrast(accentHue, 82, dark ? 60 : 44, backgroundLuminance, 3.2);
  const muted = adjustForContrast(baseHue, 14, dark ? 68 : 38, backgroundLuminance, 4.5);
  const ink = adjustForContrast(baseHue, 12, dark ? 97 : 10, backgroundLuminance, 7);
  const primaryHex = hslToHex(primary.hue, primary.saturation, primary.lightness);
  const accentHex = hslToHex(accent.hue, accent.saturation, accent.lightness);
  const mutedHex = hslToHex(muted.hue, muted.saturation, muted.lightness);
  const inkHex = hslToHex(ink.hue, ink.saturation, ink.lightness);
  const primaryLum = luminance(hexToRgb(primaryHex));
  const accentLum = luminance(hexToRgb(accentHex));
  const definitions = [
    { role: 'background', name: `${toneData.label} base`, hex: background, use: 'canvas / letterbox' },
    { role: 'surface', name: 'Raised surface', hex: surface, use: 'cards, lower thirds, end-card panels' },
    { role: 'primary', name: paletteName(baseHue), hex: primaryHex, use: 'headline, key shape, active state' },
    { role: 'accent', name: paletteName(accentHue), hex: accentHex, use: 'highlight, progress, one-word emphasis' },
    { role: 'muted', name: 'Secondary text', hex: mutedHex, use: 'captions, metadata' },
    { role: 'ink', name: dark ? 'Paper ink' : 'Carbon ink', hex: inkHex, use: 'body text and icons' },
  ];
  return {
    name: `${dark ? 'Night' : 'Day'} ${paletteName(baseHue)}`,
    theme: dark ? 'dark' : 'light',
    baseHue,
    accentHue,
    gradient: `linear-gradient(135deg, ${background} 0%, ${surface} 100%)`,
    colors: definitions.map((color) => {
      const ratio = contrastRatio(luminance(hexToRgb(color.hex)), backgroundLuminance);
      return {
        ...color,
        contrastOnBackground: Number(ratio.toFixed(2)),
        wcag: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA-large' : 'decorative',
      };
    }),
    textOnPrimary: contrastRatio(luminance(hexToRgb('#ffffff')), primaryLum) >= contrastRatio(luminance(hexToRgb('#0b0d12')), primaryLum) ? '#ffffff' : '#0b0d12',
    textOnAccent: contrastRatio(luminance(hexToRgb('#ffffff')), accentLum) >= 3 ? '#ffffff' : '#0b0d12',
    sceneColors: [primaryHex, accentHex, inkHex],
    note: `Generated from seed hue ${baseHue}°. Contrast ratios are measured against the background; "decorative" colors are for shapes, not small text.`,
  };
}

function buildTypography(tone) {
  const pairs = {
    editorial: {
      name: 'Editorial Contrast',
      display: { family: "Georgia, 'Times New Roman', serif", weight: 700, tracking: '-0.025em', transform: 'none' },
      body: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", weight: 500, tracking: '0' },
      notes: ['Serif display for the hook and end card; sans body for captions.', 'Use two weights only.'],
    },
    bold: {
      name: 'Broadcast Bold',
      display: { family: "'Arial Black', Impact, system-ui, sans-serif", weight: 900, tracking: '-0.035em', transform: 'uppercase' },
      body: { family: "'Arial', 'Helvetica Neue', sans-serif", weight: 700, tracking: '0.01em' },
      notes: ['Heavy display type, short words, high contrast.', 'Keep captions to two lines.'],
    },
    techno: {
      name: 'Technical Mono',
      display: { family: "ui-monospace, 'SFMono-Regular', Menlo, monospace", weight: 700, tracking: '-0.02em', transform: 'uppercase' },
      body: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", weight: 500, tracking: '0' },
      notes: ['Monospace display for labels, measurements, and step numbers.', 'Avoid long paragraphs in the display face.'],
    },
    warm: {
      name: 'Warm Humanist',
      display: { family: "'Trebuchet MS', Verdana, sans-serif", weight: 700, tracking: '-0.01em', transform: 'none' },
      body: { family: "Georgia, 'Times New Roman', serif", weight: 500, tracking: '0' },
      notes: ['Rounded display face, warm serif body.', 'Good for friendly, sound-off storytelling.'],
    },
    documentary: {
      name: 'Documentary Serif',
      display: { family: "Georgia, 'Iowan Old Style', 'Times New Roman', serif", weight: 700, tracking: '-0.015em', transform: 'none' },
      body: { family: "'Helvetica Neue', Arial, sans-serif", weight: 500, tracking: '0.005em' },
      notes: ['Serif display suggests reportage; sans body keeps captions neutral.', 'Use lower-thirds for context, not decoration.'],
    },
  };
  const pair = pairs[TONES[tone].type] ?? pairs.editorial;
  return {
    ...pair,
    caption: {
      family: "'Arial', 'Helvetica Neue', sans-serif",
      weight: 900,
      sizePx: 44,
      lineHeight: 1.08,
      maxLines: 2,
      stroke: '2px rgba(0,0,0,.6)',
      background: 'rgba(0,0,0,.28)',
      position: 'lower-third',
    },
    sample: 'Make the first frame earn the second.',
  };
}

function buildAudio(tone, pace, scenes) {
  const toneData = TONES[tone];
  const paceData = PACES[pace];
  const bpm = Math.round((paceData.bpmMin + paceData.bpmMax) / 2);
  const sfx = unique(scenes.map((scene) => scene.sound));
  return {
    mood: toneData.mood,
    bpm: { min: paceData.bpmMin, max: paceData.bpmMax, suggested: bpm },
    instrumentation: tone === 'premium'
      ? ['felt piano', 'sub bass', 'brushed percussion', 'vinyl texture']
      : tone === 'technical'
        ? ['clean synth pulse', 'ticking percussion', 'low drone']
        : tone === 'documentary'
          ? ['acoustic guitar', 'room tone', 'sparse piano']
          : tone === 'calm'
            ? ['warm keys', 'soft strings', 'light percussion']
            : tone === 'playful'
              ? ['plucked synth', 'hand claps', 'bouncy bass']
              : ['punchy drums', 'bright synth', 'bass hits'],
    energy: paceData.label.toLowerCase(),
    cutHint: paceData.cutHint,
    sfx,
    mixNotes: ['Keep music under the voice; duck 4–6 dB on captions.', 'Use one signature sound for the hook and the CTA.', 'Cut on motion or a sound transient, not only on the beat.'],
    licenseNote: 'Use licensed or original audio. Platform libraries are the safest default.',
  };
}

/* ------------------------------------------------------------------ */
/* Brief parsing                                                       */
/* ------------------------------------------------------------------ */

function cleanTopic(brief) {
  let text = cleanText(brief, 300);
  text = text.replace(/^(?:please\s+)?(?:can you\s+)?(?:help me\s+)?(?:make|create|produce|edit|design|shoot|film|generate|build|write|plan|draft)\s+(?:me\s+)?/i, '');
  const tones = '(?:energetic|calm|quiet|gentle|slow|premium|luxury|elegant|playful|fun|documentary|technical|cinematic|beautiful|minimal)';
  const formats = '(?:tiktok|reel|reels|short|shorts|youtube|video|promo|ad|advert|commercial|teaser|trailer|story|stories|explainer|tutorial|guide)';
  for (let index = 0; index < 5; index++) {
    text = text.replace(/^(?:a|an|the)\s+/i, '');
    text = text.replace(new RegExp(`^${tones}\\s+`, 'i'), '');
    text = text.replace(/^\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*[- ]?\s*(?:seconds?|secs?|s|minutes?|mins?)\b\s*/i, '');
    text = text.replace(new RegExp(`^${formats}\\b\\s*(?:video)?\\s*(?:about|for|of|on)?\\s*`, 'i'), '');
    text = text.replace(/^\w+(?:\s+\w+){0,3}\s+(?:video|reel|short|promo|ad|commercial|teaser|trailer)\s+(?:about|for|of|on)\s+/i, '');
    text = text.replace(/^(?:about|for|of|on|my|our|your|their|his|her|its)\s+/i, '');
  }
  text = text.replace(/[.!?]+$/, '').trim();
  if (text.length < 2 || new RegExp(`^${formats}$`, 'i').test(text)) {
    return cleanText(brief, 120) || 'a short creative story';
  }
  return text.slice(0, 120);
}

function extractKeywords(topic) {
  const words = String(topic ?? '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  return unique(words).slice(0, 8);
}

function detectSetting(topic, keywords) {
  const haystack = `${topic} ${keywords.join(' ')}`;
  for (const rule of SETTING_RULES) {
    if (rule.re.test(haystack)) {
      return { setting: rule.setting, props: [...rule.props], broll: [...rule.broll] };
    }
  }
  return { setting: 'a clean, uncluttered set with soft directional light', props: [...GENERIC_PROPS], broll: [...GENERIC_BROLL] };
}

function inferPlatform(brief) {
  if (/\blinkedin\b/i.test(brief)) return 'linkedin';
  if (/\byoutube\b/i.test(brief)) return 'youtube';
  if (/\bshorts?\b/i.test(brief)) return 'shorts';
  if (/\breels?\b|\binstagram\b/i.test(brief)) return 'reels';
  if (/\btiktok\b/i.test(brief)) return 'tiktok';
  return 'tiktok';
}

function inferDuration(brief) {
  const seconds = brief.match(/(\d{1,3}(?:\.\d+)?)\s*(?:-|\s)?\s*(?:seconds?|secs?|s)\b/i);
  if (seconds) return clamp(Number(seconds[1]), 5, 180);
  const minutes = brief.match(/(\d{1,2}(?:\.\d+)?)\s*(?:-|\s)?\s*(?:minutes?|mins?)\b/i);
  if (minutes) return clamp(Number(minutes[1]) * 60, 5, 180);
  return null;
}

function inferTone(brief) {
  if (/\b(calm|quiet|gentle|slow|soft|mindful)\b/i.test(brief)) return 'calm';
  if (/\b(premium|luxury|elegant|craft|artisan|high-end)\b/i.test(brief)) return 'premium';
  if (/\b(playful|fun|quirky|silly|whimsical)\b/i.test(brief)) return 'playful';
  if (/\b(documentary|reportage|real story|behind the scenes|profile)\b/i.test(brief)) return 'documentary';
  if (/\b(technical|explainer|how it works|engineering|teardown|walkthrough)\b/i.test(brief)) return 'technical';
  return 'energetic';
}

function inferPace(brief, tone) {
  if (/\b(fast|quick|punchy|high-energy|rapid|snappy)\b/i.test(brief)) return 'fast';
  if (/\b(slow|calm|quiet|gentle|patient|deliberate|linger)\b/i.test(brief)) return 'slow';
  if (tone === 'energetic' || tone === 'playful') return 'fast';
  if (tone === 'calm' || tone === 'premium' || tone === 'documentary') return 'slow';
  return 'medium';
}

function resolveInput(input = {}) {
  const brief = cleanText(input.brief, 800);
  if (brief.length < 3) throw fail('brief must be at least 3 characters');
  const platformKey = cleanText(input.platform ?? inferPlatform(brief), 40).toLowerCase();
  const platform = PLATFORMS[platformKey];
  if (!platform) throw fail(`platform must be one of: ${Object.keys(PLATFORMS).join(', ')}`);
  const inferredDuration = input.durationSeconds === undefined ? inferDuration(brief) : null;
  const durationSeconds = input.durationSeconds ?? inferredDuration ?? platform.durationSeconds;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 5 || durationSeconds > 180) {
    throw fail('durationSeconds must be a number between 5 and 180');
  }
  const aspect = cleanText(input.aspect ?? platform.aspect, 10);
  if (!ASPECTS[aspect]) throw fail(`aspect must be one of: ${Object.keys(ASPECTS).join(', ')}`);
  const tone = cleanText(input.tone ?? inferTone(brief), 30).toLowerCase();
  if (!TONES[tone]) throw fail(`tone must be one of: ${TONE_NAMES.join(', ')}`);
  const pace = cleanText(input.pace ?? inferPace(brief, tone), 20).toLowerCase();
  if (!PACES[pace]) throw fail(`pace must be one of: ${PACE_NAMES.join(', ')}`);
  const fps = input.fps ?? 30;
  if (!FPS_VALUES.includes(fps)) throw fail(`fps must be one of: ${FPS_VALUES.join(', ')}`);
  const maxScenes = Math.max(3, Math.min(12, Math.floor((durationSeconds * 1000) / 600)));
  const scenes = input.scenes ?? Math.min(9, Math.max(4, Math.round(durationSeconds / 4)));
  if (!Number.isInteger(scenes) || scenes < 3 || scenes > 12) throw fail('scenes must be an integer between 3 and 12');
  if (scenes > maxScenes) throw fail(`scenes must be ${maxScenes} or fewer for a ${durationSeconds}-second cut`);
  const seed = cleanText(input.seed ?? '', 80) || `director:${hashString(`${brief}|${platformKey}|${durationSeconds}|${aspect}|${tone}|${pace}|${scenes}|${fps}`)}`;
  return { brief, platformKey, platform, durationSeconds, aspect, tone, pace, fps, scenes, seed };
}

function rolesFor(count) {
  return (ROLES_BY_COUNT[count] ?? ROLES_BY_COUNT[9]).map((role) => (ROLE_DEFS[role] ? role : 'build'));
}

function allocateDurations(totalMs, weights) {
  const units = Math.floor(totalMs / 100);
  const minimum = 6; // 600 ms per scene
  if (units < weights.length * minimum) throw fail('the requested scene count is too dense for this duration');
  const remaining = units - weights.length * minimum;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (remaining * weight) / totalWeight);
  const extras = raw.map((value) => Math.floor(value));
  let leftover = remaining - extras.reduce((sum, value) => sum + value, 0);
  const remainders = raw.map((value, index) => ({ index, value: value - extras[index] })).sort((a, b) => b.value - a.value);
  for (let index = 0; index < leftover; index++) extras[remainders[index % remainders.length].index] += 1;
  const allocated = extras.map((extra) => (minimum + extra) * 100);
  const delta = totalMs - allocated.reduce((sum, value) => sum + value, 0);
  allocated[allocated.length - 1] += delta;
  return allocated;
}

function buildHooks({ topic, keywords, durationSeconds, tone, platform }) {
  const templateVars = { topic, kw: titleCase(keywords[0] ?? 'detail'), duration: durationSeconds, platform: platform.label };
  const toneHooks = TONES[tone].hook.map((text) => {
    let filled = fill(text, templateVars);
    if (/^how\b/i.test(topic)) filled = filled.replace(/^How how\b/i, 'How');
    return filled;
  });
  const toneLabels = {
    energetic: ['STOP SCROLLING', 'THE MISTAKE', 'THE MISSING PIECE'],
    calm: ['SLOW DOWN', 'A CALMER WAY', 'THE SMALL DETAIL'],
    premium: ['LESS NOISE', 'THE DETAILS', 'CRAFT MATTERS'],
    playful: ['OKAY, WAIT', 'PLOT TWIST', 'THIS IS FUN'],
    documentary: ['THE REAL STORY', 'UP CLOSE', 'WHAT HAPPENS'],
    technical: ['HOW IT WORKS', 'THE MECHANISM', 'STEP BY STEP'],
  };
  const common = [
    { text: `Stop scrolling: ${topic} in ${durationSeconds} seconds.`, onScreenText: 'STOP SCROLLING' },
    { text: `The ${keywords[0] ?? 'detail'} detail everyone gets wrong.`, onScreenText: `THE ${(keywords[0] ?? 'detail').toUpperCase()} MISTAKE` },
    { text: `Nobody talks about this part of ${topic}.`, onScreenText: 'THE MISSING PIECE' },
    { text: `${sentenceCase(topic)}: before vs. after.`, onScreenText: 'BEFORE / AFTER' },
    { text: `I tried ${topic} so you do not have to.`, onScreenText: 'I TRIED IT' },
    { text: `POV: ${topic}, but it finally works.`, onScreenText: 'POV' },
  ];
  const hooks = [
    ...toneHooks.map((text, index) => ({ text, onScreenText: toneLabels[tone]?.[index] ?? 'WATCH THIS' })),
    ...common,
  ];
  const seen = new Set();
  return hooks.filter((hook) => {
    const text = cleanText(hook.text, 140);
    if (!text || seen.has(text.toLowerCase())) return false;
    seen.add(text.toLowerCase());
    hook.text = text;
    hook.onScreenText = cleanText(hook.onScreenText, 34);
    return true;
  }).slice(0, 6);
}

function buildTitles({ topic, keywords, durationSeconds, hooks }) {
  const keyword = titleCase(keywords[0] ?? 'detail');
  const variants = [
    `${titleCase(topic)} in ${durationSeconds} Seconds`,
    `${titleCase(topic)}: Before & After`,
    `The ${keyword} Edit`,
    `${titleCase(topic)} — Start to Finish`,
    `Why ${titleCase(topic)} Works`,
    ...hooks.map((hook) => hook.text),
  ];
  return unique(variants).slice(0, 5);
}

function buildCtas({ tone, platformKey }) {
  const toneCtas = TONES[tone].cta;
  const platformCtas = platformKey === 'linkedin'
    ? ['Save this post for your next project.', 'Follow for the practical breakdown.']
    : platformKey === 'youtube'
      ? ['Subscribe for the full breakdown.', 'Save this to a playlist.']
      : ['Save this for later.', 'Follow for the next breakdown.'];
  const texts = unique([...toneCtas, ...platformCtas]);
  const text = texts[0];
  return {
    text,
    onScreenText: cleanText(text.replace(/[.?!]+$/, '').toUpperCase(), 34),
    variants: texts.slice(0, 4),
  };
}

/* ------------------------------------------------------------------ */
/* Rebuildable derived state                                           */
/* ------------------------------------------------------------------ */

function wrapCaption(text, maxChars) {
  const words = cleanText(text, 600).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function buildCaptions(scenes, aspect) {
  const maxChars = aspect === '9:16' ? 32 : 42;
  const cues = [];
  let counter = 1;
  for (const scene of scenes) {
    const source = cleanText(scene.voiceover || scene.onScreenText, 600);
    if (!source) continue;
    const lines = wrapCaption(source, maxChars);
    const maxCues = clamp(Math.floor(scene.durationMs / 900), 1, 6);
    const desired = Math.min(maxCues, Math.max(1, Math.ceil(lines.length / 2)));
    const linesPerCue = Math.max(1, Math.ceil(lines.length / desired));
    const groups = [];
    for (let index = 0; index < lines.length; index += linesPerCue) {
      groups.push(lines.slice(index, index + linesPerCue));
    }
    const slice = Math.floor(scene.durationMs / groups.length);
    groups.forEach((group, index) => {
      const startMs = scene.startMs + index * slice;
      const endMs = index === groups.length - 1 ? scene.endMs : scene.startMs + (index + 1) * slice;
      cues.push({
        id: `cc${String(counter++).padStart(2, '0')}`,
        sceneId: scene.id,
        startMs,
        endMs,
        text: group.join('\n'),
      });
    });
  }
  return cues;
}

function buildBeats(scenes) {
  const byBeat = new Map();
  for (const scene of scenes) {
    const beat = ROLE_TO_BEAT[scene.role] ?? 'build';
    if (!byBeat.has(beat)) byBeat.set(beat, []);
    byBeat.get(beat).push(scene);
  }
  return BEAT_ORDER.filter((beat) => byBeat.has(beat)).map((beat) => {
    const members = byBeat.get(beat);
    return {
      id: beat,
      label: BEAT_META[beat].label,
      purpose: BEAT_META[beat].purpose,
      startMs: members[0].startMs,
      endMs: members[members.length - 1].endMs,
      durationMs: members[members.length - 1].endMs - members[0].startMs,
      sceneIds: members.map((scene) => scene.id),
    };
  });
}

function buildTimeline(project) {
  const { scenes, captions, beats, durationMs, fps, audio } = project;
  return {
    fps,
    durationMs,
    markers: beats.map((beat) => ({ atMs: beat.startMs, label: beat.label })),
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'V1 · Picture',
        clips: scenes.map((scene) => ({
          id: `v-${scene.id}`,
          sceneId: scene.id,
          name: `${scene.role.toUpperCase()} · ${scene.shot}`,
          label: scene.onScreenText,
          startMs: scene.startMs,
          endMs: scene.endMs,
          color: scene.color,
        })),
      },
      {
        id: 't1',
        kind: 'text',
        name: 'T1 · Captions',
        clips: captions.map((cue) => ({
          id: `t-${cue.id}`,
          sceneId: cue.sceneId,
          name: 'Caption',
          label: cue.text.replace(/\n/g, ' '),
          startMs: cue.startMs,
          endMs: cue.endMs,
          color: project.palette.sceneColors[2] ?? '#ffffff',
        })),
      },
      {
        id: 'a1',
        kind: 'music',
        name: 'A1 · Music',
        clips: [{
          id: 'a-music',
          name: `${audio.mood} · ${audio.bpm.suggested} BPM`,
          label: audio.instrumentation.join(', '),
          startMs: 0,
          endMs: durationMs,
          color: project.palette.sceneColors[1] ?? '#4f8cff',
        }],
      },
      {
        id: 'a2',
        kind: 'sfx',
        name: 'A2 · SFX',
        clips: scenes.filter((scene) => scene.sound).map((scene) => ({
          id: `a-${scene.id}`,
          sceneId: scene.id,
          name: scene.sound,
          label: scene.sound,
          startMs: scene.startMs,
          endMs: Math.min(scene.endMs, scene.startMs + 600),
          color: project.palette.sceneColors[1] ?? '#4f8cff',
        })),
      },
    ],
  };
}

function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildPublish(project) {
  const { topic, keywords, durationSeconds, platform, aspect, hook, hooks, beats, palette, cta, scenes } = project;
  const titles = buildTitles({ topic, keywords, durationSeconds, hooks });
  const hashtags = unique([
    ...keywords.map((keyword) => `#${keyword.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()}`).filter((tag) => tag.length > 2),
    ...(PLATFORMS[platform]?.hashtags ?? []),
    '#video',
    '#creative',
  ]).slice(0, 12);
  const chapters = beats.map((beat) => ({ ...beat, time: formatClock(beat.startMs) }));
  const chaptersEligible = durationSeconds >= 60 && chapters.length >= 3;
  const descriptionLines = [
    hook.text,
    '',
    project.logline,
    '',
    'In this edit:',
    ...scenes.map((scene) => `• ${formatClock(scene.startMs)} — ${scene.onScreenText}`),
    '',
    cta.text,
  ];
  if (chaptersEligible) {
    descriptionLines.push('', 'Chapters:');
    for (const chapter of chapters) descriptionLines.push(`${chapter.time} ${chapter.label}`);
  }
  descriptionLines.push('', hashtags.join(' '));
  const payoffScene = scenes.find((scene) => scene.role === 'payoff') ?? scenes[scenes.length - 1];
  const thumbnail = {
    text: hook.onScreenText,
    subtext: titles[0],
    composition: aspect === '9:16'
      ? 'Subject on the right third; hook text on the left; leave the top and bottom safe areas clear.'
      : 'Subject on one third; hook text on the other; keep the center clear for platform overlays.',
    prompt: payoffScene.imagePrompt,
    colors: palette.sceneColors,
  };
  return {
    titles,
    title: titles[0],
    description: descriptionLines.join('\n'),
    hashtags,
    chapters,
    chaptersEligible,
    thumbnail,
    cta: cta.text,
    hookOptions: hooks,
  };
}

function buildProduction(project) {
  const { scenes, topic, tone, setting, palette } = project;
  const broll = unique(scenes.flatMap((scene) => scene.bRoll ?? []));
  const props = unique([...setting.props, 'hero object', 'notebook']);
  const locations = unique(scenes.map(() => setting.setting));
  const toneChecks = {
    energetic: 'Protect the pace: cut on motion and keep every shot under four seconds unless it is the payoff.',
    calm: 'Protect the quiet: fewer cuts, longer holds, and no filler sound.',
    premium: 'Protect the finish: clean backgrounds, controlled reflections, and no visible clutter.',
    playful: 'Protect the human moment: keep one unpolished reaction in the cut.',
    documentary: 'Protect the context: label the location and the person on screen.',
    technical: 'Protect the accuracy: every measurement and label must match the source.',
  };
  return {
    shotCount: scenes.length,
    estimatedSetupMinutes: scenes.length * 12 + 30,
    checklist: [
      'Lock the hook in the first 1–2 seconds; no logo intro.',
      'Shoot vertical coverage even if the primary cut is 16:9.',
      'Capture three b-roll options per scene.',
      'Record 10 seconds of room tone in every location.',
      'Keep on-screen text inside the middle 80% safe area.',
      'Export a caption-free master plus a burned-in caption version.',
      'Verify every product detail and claim before publishing.',
      'Use licensed or original music; keep the receipt.',
      'Name files sc01_hook_take01 so the edit matches the shot list.',
      toneChecks[tone],
    ],
    broll,
    props,
    locations,
    deliverables: [
      'Clean master (no captions)',
      'Caption burn-in master',
      'SRT + WebVTT',
      'Thumbnail frame',
      'Vertical and horizontal crops',
    ],
    paletteNote: `Grade toward ${palette.name}; keep skin tones neutral and let ${palette.colors[3]?.hex ?? palette.sceneColors[1] ?? '#4f8cff'} carry the accent.`,
    assetManifest: scenes.map((scene) => ({
      sceneId: scene.id,
      role: scene.role,
      durationMs: scene.durationMs,
      stillPrompt: scene.imagePrompt,
      motionPrompt: scene.videoPrompt,
    })),
    topic,
  };
}

function buildPlatformNotes(project) {
  const data = PLATFORMS[project.platform] ?? PLATFORMS.tiktok;
  const notes = [...data.notes];
  if (project.aspect !== data.aspect) {
    notes.push(`You chose ${project.aspect}; the native ${data.label} canvas is ${data.aspect}. Plan for letterboxing or a separate crop.`);
  }
  if (project.durationSeconds > 90 && project.platform !== 'youtube') {
    notes.push('This is long for a feed-first cut; make a 15–30 second teaser from the hook, proof, and CTA.');
  }
  if (project.durationSeconds < 10) {
    notes.push('Under ten seconds, the hook and the payoff must be the same idea.');
  }
  notes.push('Platform limits and UI safe areas change; confirm the current spec before publishing.');
  return {
    platform: data.label,
    nativeAspect: data.aspect,
    requestedAspect: project.aspect,
    targetDuration: `${project.durationSeconds}s`,
    safeArea: ASPECTS[project.aspect]?.safe ?? '',
    notes,
  };
}

function normalizeScene(raw, index, defaults) {
  const role = ROLE_DEFS[raw?.role] ? raw.role : 'build';
  const def = ROLE_DEFS[role];
  const durationMs = Number.isFinite(raw?.durationMs)
    ? raw.durationMs
    : Number.isFinite(raw?.endMs) && Number.isFinite(raw?.startMs)
      ? raw.endMs - raw.startMs
      : 2_000;
  const color = /^#[0-9a-f]{6}$/i.test(String(raw?.color ?? '')) ? raw.color : defaults.palette.sceneColors[index % defaults.palette.sceneColors.length];
  return {
    id: `sc${String(index + 1).padStart(2, '0')}`,
    index: index + 1,
    role,
    beat: ROLE_TO_BEAT[role] ?? 'build',
    startMs: 0,
    endMs: 0,
    durationMs: clamp(Math.round(durationMs), 250, 120_000),
    shot: cleanText(raw?.shot ?? def.shots[0], 80),
    camera: cleanText(raw?.camera ?? def.cameras[0], 80),
    lighting: cleanText(raw?.lighting ?? def.lighting[0], 120),
    subject: cleanText(raw?.subject ?? def.subjects[0], 180),
    action: cleanText(raw?.action ?? def.actions[0], 240),
    onScreenText: cleanText(raw?.onScreenText ?? def.onScreen[0], 72),
    voiceover: cleanText(raw?.voiceover ?? '', 300),
    bRoll: Array.isArray(raw?.bRoll) ? unique(raw.bRoll.map((item) => cleanText(item, 120))).slice(0, 5) : [...def.broll],
    transition: cleanText(raw?.transition ?? def.transitions[0], 80),
    sound: cleanText(raw?.sound ?? def.sounds[0], 80),
    textPosition: ['top', 'center', 'lower-third'].includes(raw?.textPosition) ? raw.textPosition : 'lower-third',
    textStyle: ['headline', 'caption', 'end-card'].includes(raw?.textStyle) ? raw.textStyle : 'caption',
    color,
    imagePrompt: cleanText(raw?.imagePrompt ?? def.actions[0], 1200),
    videoPrompt: cleanText(raw?.videoPrompt ?? def.actions[0], 600),
    notes: cleanText(raw?.notes ?? def.notes[0], 240),
    purpose: BEAT_META[ROLE_TO_BEAT[role] ?? 'build']?.purpose ?? '',
  };
}

function retimeCopy(value, seconds) {
  const label = String(Number(seconds.toFixed(2)));
  return String(value ?? '')
    .replace(/(\b(?:in|for)\s+)\d+(?:\.\d+)?(\s+seconds?\b)/gi, `$1${label}$2`)
    .replace(/(\ba\s+)\d+(?:\.\d+)?(-\s*seconds?\b)/gi, `$1${label}$2`);
}

function isUsablePalette(palette) {
  return Boolean(
    palette
    && Array.isArray(palette.colors)
    && palette.colors.length >= 6
    && palette.colors.every((color) => color && /^#[0-9a-f]{6}$/i.test(String(color.hex ?? '')))
    && Array.isArray(palette.sceneColors)
    && palette.sceneColors.length >= 2
    && palette.sceneColors.every((hex) => /^#[0-9a-f]{6}$/i.test(String(hex ?? ''))),
  );
}

function isUsableAudio(audio) {
  return Boolean(
    audio
    && typeof audio.mood === 'string'
    && audio.bpm
    && Number.isFinite(audio.bpm.suggested)
    && Array.isArray(audio.instrumentation),
  );
}

function rebuildProject(project, { maxScenes = 24 } = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw fail('plan must be an object');
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) throw fail('plan.scenes must be a non-empty array');
  if (project.scenes.length > maxScenes) throw fail(`plan.scenes must contain at most ${maxScenes} scenes`);
  const tone = TONES[project.tone] ? project.tone : 'energetic';
  const pace = PACES[project.pace] ? project.pace : 'medium';
  const platform = PLATFORMS[project.platform] ? project.platform : 'tiktok';
  const aspect = ASPECTS[project.aspect] ? project.aspect : PLATFORMS[platform].aspect;
  const fps = FPS_VALUES.includes(project.fps) ? project.fps : 30;
  const brief = cleanText(project.brief ?? project.topic ?? 'Untitled creative brief', 800);
  const topic = cleanText(project.topic ?? cleanTopic(brief), 120) || cleanTopic(brief);
  const keywords = Array.isArray(project.keywords) && project.keywords.length ? project.keywords.map((word) => cleanText(word, 40)).filter(Boolean).slice(0, 8) : extractKeywords(topic);
  const seed = cleanText(project.seed ?? `director:${hashString(brief)}`, 80);
  const palette = isUsablePalette(project.palette) ? project.palette : buildPalette(seed, tone);
  const setting = detectSetting(topic, keywords);
  const toneData = TONES[tone];
  const cta = project.cta && typeof project.cta.text === 'string'
    ? { ...buildCtas({ tone, platformKey: platform }), ...project.cta }
    : buildCtas({ tone, platformKey: platform });
  const scenes = project.scenes.map((scene, index) => normalizeScene(scene, index, { palette }));
  let cursor = 0;
  for (const scene of scenes) {
    scene.startMs = cursor;
    scene.endMs = cursor + scene.durationMs;
    cursor = scene.endMs;
  }
  if (cursor < 1_000) throw fail('plan must be at least 1 second long');
  if (cursor > 600_000) throw fail('plan must be 10 minutes or shorter');
  const durationMs = cursor;
  const durationSeconds = Number((durationMs / 1000).toFixed(2));
  const beats = buildBeats(scenes);
  const captions = buildCaptions(scenes, aspect);
  // Reflowing a timeline invalidates copy that promised an exact length. Keep
  // custom copy, but update the numeric duration references the planner wrote.
  const hooks = Array.isArray(project.hooks) && project.hooks.length ? project.hooks.slice(0, 6).map((hook) => ({
    text: retimeCopy(cleanText(hook?.text ?? hook, 140), durationSeconds),
    onScreenText: cleanText(hook?.onScreenText ?? hook, 34),
  })) : buildHooks({ topic, keywords, durationSeconds, tone, platform: PLATFORMS[platform] });
  const hook = project.hook && typeof project.hook.text === 'string'
    ? { ...project.hook, text: retimeCopy(cleanText(project.hook.text, 140), durationSeconds), onScreenText: cleanText(project.hook.onScreenText, 34) }
    : hooks[0];
  const generatedLogline = `${sentenceCase(topic)} — a ${durationSeconds}-second ${toneData.label.toLowerCase()} ${PLATFORMS[platform].label} edit.`;
  const logline = cleanText(project.logline ? retimeCopy(project.logline, durationSeconds) : generatedLogline, 300);
  const audio = isUsableAudio(project.audio) ? project.audio : buildAudio(tone, pace, scenes);
  const base = {
    schema: DIRECTOR_SCHEMA,
    version: 1,
    id: cleanText(project.id ?? `dir_${hashString(`${seed}|${brief}`).toString(36)}`, 80),
    seed,
    brief,
    topic,
    keywords,
    platform,
    platformLabel: PLATFORMS[platform].label,
    aspect,
    width: ASPECTS[aspect].width,
    height: ASPECTS[aspect].height,
    fps,
    tone,
    pace,
    durationMs,
    durationSeconds,
    palette,
    typography: project.typography && typeof project.typography === 'object' ? project.typography : buildTypography(tone),
    audio,
    hook,
    hooks,
    cta,
    setting,
    scenes,
    beats,
    captions,
    logline,
    platformNotes: buildPlatformNotes({ platform, aspect, durationSeconds }),
  };
  base.title = cleanText(project.title ? retimeCopy(project.title, durationSeconds) : buildPublish(base).title, 140);
  base.publish = buildPublish(base);
  base.production = buildProduction(base);
  base.timeline = buildTimeline(base);
  return base;
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

function srtTimestamp(ms, separator = ',') {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

function timecode(ms, fps) {
  const frames = Math.max(0, Math.round((ms / 1000) * fps));
  const ff = frames % fps;
  const totalSeconds = Math.floor(frames / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

function rationalTime(ms, fps) {
  const frames = Math.max(0, Math.round((ms / 1000) * fps));
  return frames === 0 ? '0s' : `${frames}/${fps}s`;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function buildSrt(project) {
  const blocks = project.captions.map((cue, index) => [
    String(index + 1),
    `${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}`,
    cue.text,
  ].join('\n'));
  return `${blocks.join('\n\n')}\n`;
}

function buildVtt(project) {
  const blocks = project.captions.map((cue, index) => [
    `${index + 1}`,
    `${srtTimestamp(cue.startMs, '.')} --> ${srtTimestamp(cue.endMs, '.')}`,
    cue.text,
  ].join('\n'));
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

function buildCsv(project) {
  const header = ['scene', 'start_ms', 'end_ms', 'duration_ms', 'role', 'shot', 'camera', 'lighting', 'subject', 'action', 'on_screen_text', 'voiceover', 'transition', 'sound', 'broll', 'image_prompt', 'video_prompt', 'notes'];
  const rows = project.scenes.map((scene) => [
    scene.index, scene.startMs, scene.endMs, scene.durationMs, scene.role, scene.shot, scene.camera,
    scene.lighting, scene.subject, scene.action, scene.onScreenText, scene.voiceover, scene.transition,
    scene.sound, scene.bRoll, scene.imagePrompt, scene.videoPrompt, scene.notes,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function buildEdl(project) {
  const lines = [
    `TITLE:   ${cleanText(project.title, 60).toUpperCase()}`,
    'FCM: NON-DROP FRAME',
    '',
  ];
  project.scenes.forEach((scene, index) => {
    const event = String(index + 1).padStart(3, '0');
    const name = `${scene.id}_${scene.role}`.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    lines.push(`${event}  AX       V     C        ${timecode(0, project.fps)} ${timecode(scene.durationMs, project.fps)} ${timecode(scene.startMs, project.fps)} ${timecode(scene.endMs, project.fps)}`);
    lines.push(`* FROM CLIP NAME: ${name}`);
    lines.push(`* COMMENT: ${cleanText(`${scene.shot}; ${scene.camera}; ${scene.onScreenText}`, 120)}`);
    lines.push('');
  });
  lines.push(`* TOTAL DURATION: ${timecode(project.durationMs, project.fps)}`);
  return `${lines.join('\n')}\n`;
}

function buildFcpXml(project) {
  const formatId = 'r1';
  const formatName = `Director ${project.width}x${project.height} ${project.fps}p`;
  const assets = project.scenes.map((scene, index) => [
    `    <asset id="a${index + 1}" name="${xmlEscape(`${scene.id} ${scene.role}`)}" start="0s" duration="${rationalTime(scene.durationMs, project.fps)}" hasVideo="1" format="${formatId}">`,
    `      <media-rep kind="original-media" src="file:///PLACEHOLDER/${scene.id}.mov"/>`,
    '    </asset>',
  ].join('\n'));
  const clips = project.scenes.map((scene, index) => (
    `            <asset-clip ref="a${index + 1}" offset="${rationalTime(scene.startMs, project.fps)}" name="${xmlEscape(`${scene.id} ${scene.role}`)}" duration="${rationalTime(scene.durationMs, project.fps)}" start="0s"/>`
  ));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.9">',
    '  <resources>',
    `    <format id="${formatId}" name="${xmlEscape(formatName)}" frameDuration="1/${project.fps}s" width="${project.width}" height="${project.height}"/>`,
    ...assets,
    '  </resources>',
    '  <library>',
    '    <event name="Agent Village Director">',
    `      <project name="${xmlEscape(project.title)}">`,
    `        <sequence format="${formatId}" duration="${rationalTime(project.durationMs, project.fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>',
    ...clips,
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
  ].join('\n') + '\n';
}

function buildOtio(project) {
  const rate = project.fps;
  const rational = (ms) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.max(0, Math.round((ms / 1000) * rate)) });
  const range = (durationMs) => ({
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: rational(0),
    duration: rational(durationMs),
  });
  const clips = project.scenes.map((scene) => ({
    OTIO_SCHEMA: 'Clip.1',
    name: `${scene.id} ${scene.role}`,
    metadata: {
      agent_village: {
        scene_id: scene.id,
        shot: scene.shot,
        camera: scene.camera,
        on_screen_text: scene.onScreenText,
        voiceover: scene.voiceover,
        image_prompt: scene.imagePrompt,
      },
    },
    source_range: range(scene.durationMs),
    effects: [],
    markers: [],
    enabled: true,
    media_reference: {
      OTIO_SCHEMA: 'MissingReference.1',
      name: `${scene.id}-placeholder`,
      metadata: {},
    },
  }));
  const track = {
    OTIO_SCHEMA: 'Track.1',
    name: 'V1',
    kind: 'Video',
    metadata: {},
    children: clips,
  };
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: project.title,
    global_start_time: rational(0),
    metadata: {
      agent_village: {
        schema: DIRECTOR_SCHEMA,
        brief: project.brief,
        platform: project.platform,
        aspect: project.aspect,
        seed: project.seed,
      },
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      metadata: {},
      children: [track],
    },
  };
}

function buildMarkdown(project) {
  const lines = [];
  lines.push(`# ${project.title}`);
  lines.push('');
  lines.push(`> ${project.logline}`);
  lines.push('');
  lines.push(`**Brief:** ${project.brief}`);
  lines.push(`**Canvas:** ${project.aspect} · ${project.width}×${project.height} · ${project.fps} fps · ${project.durationSeconds}s`);
  lines.push(`**Platform:** ${project.platformLabel} · **Tone:** ${TONES[project.tone].label} · **Pace:** ${PACES[project.pace].label}`);
  lines.push(`**Seed:** \`${project.seed}\``);
  lines.push('');
  lines.push(`## Hook`);
  lines.push('');
  lines.push(project.hook.text);
  lines.push('');
  lines.push(`On-screen: **${project.hook.onScreenText}**`);
  lines.push('');
  lines.push('## Palette');
  lines.push('');
  lines.push('| Role | Color | Use | Contrast | WCAG |');
  lines.push('|---|---|---|---:|---|');
  for (const color of project.palette.colors) {
    lines.push(`| ${mdCell(color.role)} | \`${color.hex}\` ${mdCell(color.name)} | ${mdCell(color.use)} | ${color.contrastOnBackground}:1 | ${color.wcag} |`);
  }
  lines.push('');
  lines.push(`**Type:** ${project.typography.name} — display ${project.typography.display.family}; body ${project.typography.body.family}.`);
  lines.push('');
  lines.push('## Beats');
  lines.push('');
  lines.push('| Beat | Time | Purpose |');
  lines.push('|---|---|---|');
  for (const beat of project.beats) lines.push(`| ${mdCell(beat.label)} | ${formatClock(beat.startMs)}–${formatClock(beat.endMs)} | ${mdCell(beat.purpose)} |`);
  lines.push('');
  lines.push('## Storyboard');
  lines.push('');
  lines.push('| # | Time | Role | Shot | On-screen | Voiceover |');
  lines.push('|---:|---|---|---|---|---|');
  for (const scene of project.scenes) {
    lines.push(`| ${scene.index} | ${formatClock(scene.startMs)}–${formatClock(scene.endMs)} | ${mdCell(scene.role)} | ${mdCell(scene.shot)} / ${mdCell(scene.camera)} | ${mdCell(scene.onScreenText)} | ${mdCell(scene.voiceover || '—')} |`);
  }
  lines.push('');
  lines.push('## Shot list');
  lines.push('');
  for (const scene of project.scenes) {
    lines.push(`### ${String(scene.index).padStart(2, '0')} · ${scene.role} · ${formatClock(scene.startMs)}–${formatClock(scene.endMs)}`);
    lines.push('');
    lines.push(`- **Shot / camera:** ${scene.shot}; ${scene.camera}`);
    lines.push(`- **Lighting:** ${scene.lighting}`);
    lines.push(`- **Subject:** ${scene.subject}`);
    lines.push(`- **Action:** ${scene.action}`);
    lines.push(`- **On-screen:** ${scene.onScreenText}`);
    lines.push(`- **Voiceover:** ${scene.voiceover || '—'}`);
    lines.push(`- **B-roll:** ${scene.bRoll.join(', ')}`);
    lines.push(`- **Transition:** ${scene.transition} · **Sound:** ${scene.sound}`);
    lines.push(`- **Still prompt:** ${scene.imagePrompt}`);
    lines.push(`- **Motion prompt:** ${scene.videoPrompt}`);
    lines.push(`- **Editor note:** ${scene.notes}`);
    lines.push('');
  }
  lines.push('## Captions');
  lines.push('');
  lines.push('```srt');
  lines.push(buildSrt(project).trimEnd());
  lines.push('```');
  lines.push('');
  lines.push('## Audio brief');
  lines.push('');
  lines.push(`- **Mood:** ${project.audio.mood}`);
  lines.push(`- **Tempo:** ${project.audio.bpm.min}–${project.audio.bpm.max} BPM (suggested ${project.audio.bpm.suggested})`);
  lines.push(`- **Instrumentation:** ${project.audio.instrumentation.join(', ')}`);
  lines.push(`- **Cut hint:** ${project.audio.cutHint}`);
  lines.push(`- **SFX:** ${project.audio.sfx.join(', ')}`);
  for (const note of project.audio.mixNotes) lines.push(`- ${note}`);
  lines.push(`- ${project.audio.licenseNote}`);
  lines.push('');
  lines.push('## Publishing kit');
  lines.push('');
  lines.push('### Titles');
  for (const title of project.publish.titles) lines.push(`- ${title}`);
  lines.push('');
  lines.push('### Description');
  lines.push('');
  lines.push('```text');
  lines.push(project.publish.description);
  lines.push('```');
  lines.push('');
  lines.push(`**Hashtags:** ${project.publish.hashtags.join(' ')}`);
  lines.push('');
  lines.push('### Thumbnail');
  lines.push('');
  lines.push(`- **Text:** ${project.publish.thumbnail.text}`);
  lines.push(`- **Subtext:** ${project.publish.thumbnail.subtext}`);
  lines.push(`- **Composition:** ${project.publish.thumbnail.composition}`);
  lines.push(`- **Prompt:** ${project.publish.thumbnail.prompt}`);
  lines.push('');
  lines.push('## Production');
  lines.push('');
  lines.push(`- **Shots:** ${project.production.shotCount}`);
  lines.push(`- **Estimated setup:** ${project.production.estimatedSetupMinutes} minutes`);
  lines.push(`- **Props:** ${project.production.props.join(', ')}`);
  lines.push(`- **B-roll:** ${project.production.broll.join(', ')}`);
  lines.push('');
  lines.push('### Checklist');
  for (const item of project.production.checklist) lines.push(`- [ ] ${item}`);
  lines.push('');
  lines.push('## Platform notes');
  lines.push('');
  lines.push(`**${project.platformNotes.platform}** · native ${project.platformNotes.nativeAspect} · requested ${project.platformNotes.requestedAspect} · ${project.platformNotes.safeArea}`);
  for (const note of project.platformNotes.notes) lines.push(`- ${note}`);
  lines.push('');
  return lines.join('\n');
}

function buildYoutubeText(project) {
  const lines = [];
  lines.push(`TITLE OPTIONS`);
  for (const title of project.publish.titles) lines.push(`- ${title}`);
  lines.push('');
  lines.push('DESCRIPTION');
  lines.push(project.publish.description);
  lines.push('');
  lines.push('THUMBNAIL');
  lines.push(`Text: ${project.publish.thumbnail.text}`);
  lines.push(`Subtext: ${project.publish.thumbnail.subtext}`);
  lines.push(`Composition: ${project.publish.thumbnail.composition}`);
  lines.push('');
  lines.push('HASHTAGS');
  lines.push(project.publish.hashtags.join(' '));
  lines.push('');
  lines.push('CAPTION FILE: use the SRT or VTT export.');
  lines.push('');
  return lines.join('\n');
}

function projectForJson(project) {
  const { exports: _exports, ...rest } = project;
  return rest;
}

export function buildExports(project) {
  return {
    json: JSON.stringify(projectForJson(project), null, 2),
    markdown: buildMarkdown(project),
    srt: buildSrt(project),
    vtt: buildVtt(project),
    csv: buildCsv(project),
    edl: buildEdl(project),
    fcpxml: buildFcpXml(project),
    otio: JSON.stringify(buildOtio(project), null, 2),
    youtube: buildYoutubeText(project),
  };
}

export function planProject(input = {}) {
  const resolved = resolveInput(input);
  const { brief, platformKey, platform, durationSeconds, aspect, tone, pace, fps, seed } = resolved;
  const rng = createRng(hashString(seed));
  const topic = cleanTopic(brief);
  const keywords = extractKeywords(topic);
  const setting = detectSetting(topic, keywords);
  const palette = buildPalette(seed, tone);
  const typography = buildTypography(tone);
  const hooks = buildHooks({ topic, keywords, durationSeconds, tone, platform });
  const hook = hooks[0];
  const cta = buildCtas({ tone, platformKey });
  const roles = rolesFor(resolved.scenes);
  const weights = roles.map((role) => ROLE_DEFS[role].weight);
  const durations = allocateDurations(durationSeconds * 1000, weights);
  const scenes = buildScenesFromPlan({
    topic, keywords, durationSeconds, aspect, tone, rng, palette, setting, cta, hook,
    roles, durations,
  });
  const project = {
    schema: DIRECTOR_SCHEMA,
    version: 1,
    id: `dir_${hashString(`${seed}|${brief}`).toString(36)}`,
    seed,
    brief,
    topic,
    keywords,
    logline: `${sentenceCase(topic)} — a ${durationSeconds}-second ${TONES[tone].label.toLowerCase()} ${platform.label} edit.`,
    platform: platformKey,
    platformLabel: platform.label,
    aspect,
    width: ASPECTS[aspect].width,
    height: ASPECTS[aspect].height,
    fps,
    tone,
    pace,
    durationMs: durationSeconds * 1000,
    durationSeconds,
    palette,
    typography,
    audio: buildAudio(tone, pace, scenes),
    hook,
    hooks,
    cta,
    setting,
    scenes,
    title: '',
  };
  project.title = buildTitles({ topic, keywords, durationSeconds, hooks })[0];
  return rebuildProject(project, { maxScenes: 12 });
}

function buildScenesFromPlan({ topic, keywords, durationSeconds, aspect, tone, rng, palette, setting, cta, hook, roles, durations }) {
  const style = TONES[tone].style;
  const benefit = keywords.length ? `more ${keywords[0]}, less friction` : 'less friction, more clarity';
  const proof = keywords.length ? `a visible change in ${keywords[0]}` : 'a visible before-and-after';
  const vars = {
    topic,
    topicUpper: titleCase(topic).toUpperCase(),
    kw: titleCase(keywords[0] ?? 'detail'),
    duration: durationSeconds,
    benefit,
    proof,
    setting: setting.setting,
    cta: cta.text,
  };
  const scenes = [];
  let startMs = 0;
  roles.forEach((role, index) => {
    const def = ROLE_DEFS[role];
    const durationMs = durations[index];
    const voicePool = TONES[tone].voice?.[role] ?? [];
    const useToneVoice = voicePool.length > 0 && rng() < 0.62;
    const voiceTemplate = useToneVoice ? pick(rng, voicePool) : pick(rng, def.voice);
    const onScreenTemplate = role === 'hook'
      ? hook.onScreenText
      : role === 'cta'
        ? cta.onScreenText
        : pick(rng, def.onScreen);
    const onScreenText = cleanText(fill(onScreenTemplate, vars), 72);
    const voiceover = durationMs < 1_200 && role !== 'hook' && role !== 'cta'
      ? ''
      : trimWords(fill(voiceTemplate, vars), Math.max(36, Math.min(240, Math.round((durationMs / 1000) * 17))));
    const shot = pick(rng, def.shots);
    const camera = pick(rng, def.cameras);
    const lighting = pick(rng, def.lighting);
    const transition = index === 0 ? 'cut' : pick(rng, def.transitions);
    const sound = pick(rng, def.sounds);
    const action = fill(pick(rng, def.actions), vars);
    const subject = fill(pick(rng, def.subjects), vars);
    const broll = unique([...def.broll, ...setting.broll]).slice(0, 3);
    const textPosition = role === 'hook' || role === 'cta' || role === 'payoff' ? 'center' : index % 3 === 0 ? 'top' : 'lower-third';
    const textStyle = role === 'hook' ? 'headline' : role === 'cta' ? 'end-card' : 'caption';
    scenes.push({
      id: `sc${String(index + 1).padStart(2, '0')}`,
      index: index + 1,
      role,
      beat: ROLE_TO_BEAT[role] ?? 'build',
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      shot,
      camera,
      lighting,
      subject,
      action,
      onScreenText,
      voiceover,
      bRoll: broll,
      transition,
      sound,
      textPosition,
      textStyle,
      color: palette.sceneColors[index % palette.sceneColors.length],
      imagePrompt: cleanText(`${shot} of ${subject}. ${clause(action)} Lighting: ${clause(lighting)} Setting: ${clause(setting.setting)} Style: ${clause(style)} ${aspect} composition. No text, no logos.`, 900),
      videoPrompt: cleanText(`Camera: ${camera}. ${clause(action)} Lighting: ${clause(lighting)} Duration: ${Math.round(durationMs / 100) / 10}s. Transition: ${transition}. No captions, no logos.`, 600),
      notes: pick(rng, def.notes),
      purpose: BEAT_META[ROLE_TO_BEAT[role] ?? 'build']?.purpose ?? '',
    });
    startMs += durationMs;
  });
  return scenes;
}

export function exportProject({ format, plan } = {}) {
  const key = cleanText(format, 20).toLowerCase();
  const meta = FORMATS[key];
  if (!meta) throw fail(`format must be one of: ${Object.keys(FORMATS).join(', ')}`);
  const project = rebuildProject(structuredClone(plan), { maxScenes: 24 });
  const body = buildExports(project)[key];
  const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'director-plan';
  return {
    format: key,
    filename: `${slug}.${meta.extension}`,
    contentType: meta.contentType,
    body,
  };
}

export { formatClock, cleanTopic, buildSrt, buildVtt, buildFcpXml, buildOtio };
