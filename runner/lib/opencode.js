export function buildPrompt(job) {
  const answers = Object.entries(job.answers || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '(none)';
  return [
    'You are an autonomous engineering agent. Build a small, self-contained web app from the brief below.',
    'Operate autonomously and make reasonable assumptions; when the superpowers skills (brainstorming,',
    'writing-plans) ask for approval, choose the best option yourself and proceed. Use TDD.',
    '',
    'ASKING THE USER: If you genuinely need a decision only the user can make, or data only they have',
    '(an API key/token, credentials, an account id, a URL, or a choice between real alternatives), output',
    'exactly one line `ASK: <your question>` and STOP your turn — do NOT guess secrets or fabricate',
    'credentials. The user will reply and you will continue in the same session. Ask only when necessary.',
    '',
    'HARD CONTRACT — your task is not done until ALL of these are true:',
    '1. The app builds and runs from a `Dockerfile` at the repo root.',
    '2. The container listens on a single HTTP port.',
    '3. You have written `.deploybot/app.json` with {"containerPort": <port>} and, if the app needs runtime',
    '   config or secrets (e.g. an API key the user gave you), an optional "env" object, e.g.',
    '   {"containerPort": 8080, "env": {"OWM_API_KEY": "the-value"}}. The deploy injects "env" into the',
    '   container as environment variables — read secrets from process env, do NOT hardcode them in source.',
    '4. A local container smoke-test returns a 2xx/3xx HTTP response on that port.',
    '',
    'ALLOWED STACK (pick the lightest that fits): a static site (HTML/JS served by a tiny',
    'nginx/caddy image), OR a single small Node or Python container. You MAY use SQLite',
    '(file-based) for persistence. Do NOT use Postgres/MySQL or any multi-container setup.',
    '',
    `PUBLIC: ${job.public ? 'the app is publicly accessible' : 'the app should be access-restricted as described'}.`,
    '',
    '--- BRIEF ---',
    job.description,
    '',
    '--- CLARIFICATIONS ---',
    answers,
  ].join('\n');
}

export function buildUpdatePrompt(job) {
  return [
    'You are an autonomous engineering agent. UPDATE the existing web app in this directory per the change request below.',
    'The app source, its `Dockerfile`, and `.deploybot/app.json` already exist here — modify them in place.',
    'Operate autonomously and choose the best option; use TDD. If you genuinely need a decision only the',
    'user can make or data only they have (token, credentials, a real choice), output one line',
    '`ASK: <your question>` and STOP — do not guess secrets. The user replies and you continue.',
    '',
    'HARD CONTRACT — your task is not done until ALL of these remain true after your changes:',
    '1. The app still builds and runs from the `Dockerfile` at the repo root.',
    '2. The container listens on a single HTTP port.',
    '3. `.deploybot/app.json` still has {"containerPort": <port>} (and may carry an "env" object for runtime',
    '   config/secrets, which the deploy injects as container env vars — read secrets from env, never hardcode).',
    '4. A local container smoke-test returns a 2xx/3xx HTTP response on that port.',
    '',
    'Keep the same lightweight stack (static / single Node or Python container, optional SQLite).',
    'Do NOT change the subdomain or introduce multi-container setups.',
    '',
    '--- CHANGE REQUEST ---',
    job.description,
  ].join('\n');
}

export function buildCommand(workdir, model) {
  // --format json streams structured LLM-inference events to stdout (and avoids the TUI
  // renderer hanging when run headless without a TTY). Prompt is read from the workspace.
  // < /dev/null: a piped stdin that never closes makes opencode hang at init.
  const m = model || 'kimi-k2.7-code';
  return `cd ${workdir} && opencode run "$(cat .deploybot/prompt.txt)" --model opencode-go/${m} --format json < /dev/null`;
}

// Resume an existing opencode session with the user's answer (read from a file to avoid shell-escaping).
export function resumeCommand(workdir, sessionId, model) {
  const m = model || 'kimi-k2.7-code';
  return `cd ${workdir} && opencode run --session ${sessionId} "$(cat .deploybot/answer.txt)" --model opencode-go/${m} --format json < /dev/null`;
}
