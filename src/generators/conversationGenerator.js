'use strict';

/**
 * MemoryArena Dynamic Conversation Generator
 * Generates synthetic multi-turn conversations for training memory-intensive agents.
 */

// ---------------------------------------------------------------------------
// Difficulty profiles
// ---------------------------------------------------------------------------

const DIFFICULTY_PROFILES = {
  easy: {
    vocabTier: 'basic',
    contextDepth: 1,
    avgTurnLength: 'short',
    maxFacts: 2,
  },
  medium: {
    vocabTier: 'intermediate',
    contextDepth: 3,
    avgTurnLength: 'medium',
    maxFacts: 5,
  },
  hard: {
    vocabTier: 'advanced',
    contextDepth: 6,
    avgTurnLength: 'long',
    maxFacts: 10,
  },
};

// ---------------------------------------------------------------------------
// Lexicon pools
// ---------------------------------------------------------------------------

const LEXICON = {
  basic: {
    topics: ['weather', 'food', 'hobbies', 'daily routine', 'colors', 'animals'],
    adjectives: ['nice', 'big', 'small', 'good', 'bad', 'happy', 'sad'],
    verbs: ['like', 'have', 'go', 'eat', 'see', 'know'],
    connectors: ['and', 'but', 'so'],
  },
  intermediate: {
    topics: [
      'software development', 'climate science', 'economics', 'psychology',
      'history', 'nutrition', 'urban planning',
    ],
    adjectives: [
      'efficient', 'complex', 'relevant', 'significant', 'notable',
      'practical', 'fundamental',
    ],
    verbs: [
      'analyze', 'consider', 'develop', 'implement', 'understand',
      'evaluate', 'compare',
    ],
    connectors: ['however', 'therefore', 'furthermore', 'in addition', 'as a result'],
  },
  advanced: {
    topics: [
      'epistemological frameworks', 'quantum information theory', 'macroeconomic policy',
      'neuroplasticity', 'distributed systems consensus', 'phenomenological analysis',
      'post-structuralist critique',
    ],
    adjectives: [
      'multifaceted', 'counterintuitive', 'paradigmatic', 'non-trivial',
      'heuristic', 'stochastic', 'recursive',
    ],
    verbs: [
      'interrogate', 'synthesize', 'extrapolate', 'operationalize',
      'deconstruct', 'proliferate', 'disambiguate',
    ],
    connectors: [
      'notwithstanding', 'by extension', 'in contradistinction to',
      'predicated upon', 'consequentially',
    ],
  },
};

// ---------------------------------------------------------------------------
// Template patterns
// ---------------------------------------------------------------------------

/**
 * Q&A template: user asks questions, assistant answers with increasing depth.
 */
function buildQAConversation(topic, turns, profile, rng) {
  const lex = LEXICON[profile.vocabTier];
  const adj = () => pick(lex.adjectives, rng);
  const verb = () => pick(lex.verbs, rng);
  const conn = () => pick(lex.connectors, rng);

  const result = [];
  for (let i = 0; i < turns; i++) {
    if (i % 2 === 0) {
      // User turn: question
      const depth = i / 2;
      let question;
      if (depth === 0) {
        question = `Can you explain the ${adj()} aspects of ${topic}?`;
      } else if (depth < 3) {
        question = `${capitalize(conn())}, how do the ${adj()} factors ${verb()} in the context of ${topic}?`;
      } else {
        question = `Given what you said, how would you ${verb()} the ${adj()} implications of ${topic} ` +
          `${conn()} account for ${adj()} edge cases?`;
      }
      result.push({ role: 'user', content: question });
    } else {
      // Assistant turn: answer
      const factCount = Math.min(Math.ceil((i + 1) / 2), profile.maxFacts);
      const sentences = buildAnswerSentences(topic, factCount, lex, rng);
      result.push({ role: 'assistant', content: sentences.join(' ') });
    }
  }
  return result;
}

/**
 * Narrative template: user sets a scenario, assistant continues the story.
 */
function buildNarrativeConversation(topic, turns, profile, rng) {
  const lex = LEXICON[profile.vocabTier];
  const adj = () => pick(lex.adjectives, rng);
  const verb = () => pick(lex.verbs, rng);
  const conn = () => pick(lex.connectors, rng);

  const result = [];
  const characters = ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey'];
  const char = pick(characters, rng);

  for (let i = 0; i < turns; i++) {
    if (i === 0) {
      result.push({
        role: 'user',
        content: `Let's write a story about ${char}, who encounters something ${adj()} related to ${topic}.`,
      });
    } else if (i % 2 === 1) {
      // Assistant narrative continuation
      const factCount = Math.min(Math.ceil((i + 1) / 2), profile.maxFacts);
      const narration = buildNarrationSentences(char, topic, factCount, lex, rng);
      result.push({ role: 'assistant', content: narration.join(' ') });
    } else {
      // User prompt continuation
      result.push({
        role: 'user',
        content: `${capitalize(conn())}, what happens when ${char} tries to ${verb()} the ${adj()} situation?`,
      });
    }
  }
  return result;
}

/**
 * Mixed template: alternates between Q&A and narrative segments.
 */
function buildMixedConversation(topic, turns, profile, rng) {
  const qaSegment = buildQAConversation(topic, Math.ceil(turns / 2), profile, rng);
  const narrativeSegment = buildNarrativeConversation(topic, Math.floor(turns / 2), profile, rng);

  // Interleave: take one pair from Q&A, one pair from narrative, etc.
  const result = [];
  const maxLen = Math.max(qaSegment.length, narrativeSegment.length);
  for (let i = 0; i < maxLen && result.length < turns; i++) {
    if (i < qaSegment.length) result.push(qaSegment[i]);
    if (result.length < turns && i < narrativeSegment.length) result.push(narrativeSegment[i]);
  }
  return result.slice(0, turns);
}

// ---------------------------------------------------------------------------
// Sentence builders
// ---------------------------------------------------------------------------

function buildAnswerSentences(topic, count, lex, rng) {
  const sentences = [];
  for (let i = 0; i < count; i++) {
    const adj = pick(lex.adjectives, rng);
    const verb = pick(lex.verbs, rng);
    const conn = i > 0 ? `${capitalize(pick(lex.connectors, rng))}, ` : '';
    sentences.push(
      `${conn}one ${adj} aspect of ${topic} is that experts ${verb} it in relation to broader patterns.`
    );
  }
  return sentences;
}

function buildNarrationSentences(char, topic, count, lex, rng) {
  const sentences = [];
  for (let i = 0; i < count; i++) {
    const adj = pick(lex.adjectives, rng);
    const verb = pick(lex.verbs, rng);
    const conn = i > 0 ? `${capitalize(pick(lex.connectors, rng))}, ` : '';
    sentences.push(
      `${conn}${char} began to ${verb} the ${adj} dimensions of ${topic}, noticing something unexpected.`
    );
  }
  return sentences;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Ensures reproducible output when a seed is provided.
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate synthetic conversations for MemoryArena training.
 *
 * @param {number} count - Number of conversations to generate.
 * @param {object} options
 * @param {'easy'|'medium'|'hard'} [options.difficulty='medium'] - Difficulty level.
 * @param {number} [options.turns=4] - Number of turns per conversation.
 * @param {'qa'|'narrative'|'mixed'} [options.template='mixed'] - Conversation template.
 * @param {number} [options.seed] - Optional RNG seed for reproducibility.
 * @returns {Array<{id: string, difficulty: string, template: string, turns: Array<{role: string, content: string}>, metadata: object}>}
 */
function generateConversations(count, options = {}) {
  const {
    difficulty = 'medium',
    turns = 4,
    template = 'mixed',
    seed,
  } = options;

  if (!DIFFICULTY_PROFILES[difficulty]) {
    throw new Error(`Unknown difficulty: "${difficulty}". Use easy, medium, or hard.`);
  }
  if (!['qa', 'narrative', 'mixed'].includes(template)) {
    throw new Error(`Unknown template: "${template}". Use qa, narrative, or mixed.`);
  }
  if (typeof turns !== 'number' || turns < 1) {
    throw new Error('turns must be a positive integer');
  }

  const profile = DIFFICULTY_PROFILES[difficulty];
  const lex = LEXICON[profile.vocabTier];
  const conversations = [];

  for (let i = 0; i < count; i++) {
    const rng = makeRng(seed !== undefined ? seed + i : Date.now() + i * 1337);
    const topic = pick(lex.topics, rng);
    const id = `conv-${i + 1}`;

    let turnList;
    switch (template) {
      case 'qa':
        turnList = buildQAConversation(topic, turns, profile, rng);
        break;
      case 'narrative':
        turnList = buildNarrativeConversation(topic, turns, profile, rng);
        break;
      case 'mixed':
      default:
        turnList = buildMixedConversation(topic, turns, profile, rng);
        break;
    }

    conversations.push({
      id,
      difficulty,
      template,
      turns: turnList,
      metadata: {
        topic,
        vocabTier: profile.vocabTier,
        contextDepth: profile.contextDepth,
        generatedAt: new Date().toISOString(),
      },
    });
  }

  return conversations;
}

/**
 * Format an array of conversations as JSONL (one JSON object per line).
 *
 * @param {Array} conversations - Output of generateConversations().
 * @returns {string} JSONL string.
 */
function toJSONL(conversations) {
  return conversations.map(c => JSON.stringify(c)).join('\n');
}

module.exports = { generateConversations, toJSONL };
