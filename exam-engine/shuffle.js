// shuffle.js — deterministic per-student shuffling of exam content, so a
// personalised batch can give each learner their own question/option
// order while the exam paper and its marking scheme still match for that
// same student (both are shuffled with the same seed). Used by
// api/generate-pdf.js when the request sets shuffle: true.

// Small deterministic PRNG (mulberry32), seeded from a string hash of the
// student's name+class — same student always gets the same shuffle on
// every regeneration; different students get different orders.
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seedString) {
  return mulberry32(hashSeed(String(seedString)));
}
function shuffleArray(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffles MCQ order within section_a, option order within each MCQ
// (remapping .answer to the new correct letter so the scheme still marks
// correctly), and structured-question order within section_b. Renumbers
// 1..N across both sections afterward, matching the convention
// ExamStudio.tsx already uses when it builds the unshuffled content.
function shuffleContentForStudent(content, seedString) {
  const rng = makeRng(seedString);
  const out = { ...content };

  if (out.section_a && Array.isArray(out.section_a.questions)) {
    const shuffledQs = shuffleArray(out.section_a.questions, rng).map(q => {
      if (!Array.isArray(q.options)) return q;
      const positions = q.options.map((_, i) => i);
      const shuffledPositions = shuffleArray(positions, rng);
      const newOptions = shuffledPositions.map(i => q.options[i]);
      let newAnswer = q.answer;
      if (q.answer) {
        const oldIdx = q.answer.toUpperCase().charCodeAt(0) - 65;
        const newPos = shuffledPositions.indexOf(oldIdx);
        if (newPos >= 0) newAnswer = String.fromCharCode(65 + newPos);
      }
      return { ...q, options: newOptions, answer: newAnswer };
    });
    out.section_a = { ...out.section_a, questions: shuffledQs };
  }

  if (out.section_b && Array.isArray(out.section_b.questions)) {
    out.section_b = { ...out.section_b, questions: shuffleArray(out.section_b.questions, rng) };
  }

  let n = 1;
  if (out.section_a) out.section_a = { ...out.section_a, questions: out.section_a.questions.map(q => ({ ...q, number: n++ })) };
  if (out.section_b) out.section_b = { ...out.section_b, questions: out.section_b.questions.map(q => ({ ...q, number: n++ })) };

  return out;
}

module.exports = { shuffleContentForStudent, makeRng, shuffleArray };
