export function pushCommands(appName, workdir) {
  return [
    `git init ${workdir}`,
    `git -C ${workdir} add -A`,
    `git -C ${workdir} -c user.email=deploybot@s.ciepka.com -c user.name=deploybot commit -q -m "Initial commit (deploybot)"`,
    `gh repo create ${appName} --private --source=${workdir} --remote=origin`,
    `git -C ${workdir} push`,
  ];
}
