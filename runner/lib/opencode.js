export function buildPrompt(job) {
  const answers = Object.entries(job.answers || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '(none)';
  return [
    'You are an autonomous engineering agent. Build a small, self-contained web app from the brief below.',
    'Operate fully autonomously: when the superpowers skills (brainstorming, writing-plans) ask for approval,',
    'choose the best option yourself and proceed. NEVER wait for human input. Use TDD.',
    '',
    'HARD CONTRACT — your task is not done until ALL of these are true:',
    '1. The app builds and runs from a `Dockerfile` at the repo root.',
    '2. The container listens on a single HTTP port.',
    '3. You have written `.deploybot/app.json` containing exactly {"containerPort": <the port number>}.',
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
    'Operate fully autonomously: never wait for human input; choose the best option and proceed. Use TDD.',
    '',
    'HARD CONTRACT — your task is not done until ALL of these remain true after your changes:',
    '1. The app still builds and runs from the `Dockerfile` at the repo root.',
    '2. The container listens on a single HTTP port.',
    '3. `.deploybot/app.json` still contains exactly {"containerPort": <the port number>}.',
    '4. A local container smoke-test returns a 2xx/3xx HTTP response on that port.',
    '',
    'Keep the same lightweight stack (static / single Node or Python container, optional SQLite).',
    'Do NOT change the subdomain or introduce multi-container setups.',
    '',
    '--- CHANGE REQUEST ---',
    job.description,
  ].join('\n');
}

export function buildCommand(workdir) {
  // opencode reads OPENCODE_API_KEY / config from the environment; prompt is piped via a heredoc file.
  return `cd ${workdir} && opencode run "$(cat .deploybot/prompt.txt)"`;
}
