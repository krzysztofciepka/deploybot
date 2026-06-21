import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_ORDER = ['config.js', 'session.js', 'intake.js', 'subdomain.js', 'runnerClient.js'];

function bundle() {
  return LIB_ORDER.map((f) => {
    const src = readFileSync(join(__dirname, 'lib', f), 'utf8');
    // strip ESM import/export so it runs as plain script inside an n8n Code node
    return src
      .replace(/^\s*import[^;]+;\s*$/gm, '')
      .replace(/^export\s+/gm, '');
  }).join('\n');
}

function main() {
  const template = readFileSync(join(__dirname, 'workflow.template.json'), 'utf8');
  const tmpl = JSON.parse(template);
  const code = bundle();
  for (const node of tmpl.nodes) {
    if (node.type === 'n8n-nodes-base.code' && typeof node.parameters?.jsCode === 'string') {
      node.parameters.jsCode = node.parameters.jsCode.replace('// __DEPLOYBOT_BUNDLE__', code);
    }
  }
  const out = JSON.stringify(tmpl, null, 2);
  if (/sk-[A-Za-z0-9_-]{20,}/.test(out) || /\d{6,}:[A-Za-z0-9_-]{30,}/.test(out)) {
    throw new Error('refusing to write workflow.json: looks like it contains a secret');
  }
  writeFileSync(join(__dirname, '..', 'workflow.json'), out + '\n');
  console.log('wrote workflow.json');
}

main();
