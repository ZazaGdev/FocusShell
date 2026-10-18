// Commits made since local midnight on every branch of each project (#289), shared by the
// tavern's chalkboard (#285). git(cwd, args) -> Promise<stdout, '' on error>.
// { total, projects: [{ name, count }] }, most commits first, projects with none left out.
export async function commitsToday(projects, git, now = new Date()) {
  const since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 00:00`;
  const list = await Promise.all(projects.filter(p => p.path).map(async p => ({
    name: p.name, count: (await git(p.path, ['log', '--all', `--since=${since}`, '--format=%H'])).split('\n').filter(Boolean).length })));
  const out = list.filter(x => x.count).sort((a, b) => b.count - a.count);
  return { total: out.reduce((n, x) => n + x.count, 0), projects: out };
}
