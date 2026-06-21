export function intakeSystemPrompt(language) {
  return [
    `You triage requests for small web apps. Reply ONLY with JSON: {"questions": string[]}.`,
    `Ask the MINIMUM essential clarifying questions — assume sensible defaults for everything else.`,
    `If the request is already clear enough to build, return an empty array.`,
    `Do NOT ask about the subdomain (handled separately). Write the questions in ${language}.`,
  ].join(' ');
}
export function parseIntake(llmText) {
  const fallback = { questions: [], needsSubdomain: true };
  try {
    const m = String(llmText).match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const obj = JSON.parse(m[0]);
    return { questions: Array.isArray(obj.questions) ? obj.questions.map(String) : [], needsSubdomain: true };
  } catch {
    return fallback;
  }
}
