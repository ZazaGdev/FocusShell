// Short passing runs (#3073): which commands the lead plugin's hook wraps and what a run's
// output becomes. Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRun, wrap, MARK, failedSigns, summarize, splitMark, markAfter, SHORT_LINES } from './quietrun.js';

test('quietrun isRun: test runs and builds are wrapped (#3073)', () => {
  for (const c of [
    'cd app && node --test lib/lib.test.js',
    'cd app; node --test lib/lib.test.js',
    'npm test',
    'npm run build',
    'npm --prefix web run lint',
    'pnpm test',
    'yarn typecheck',
    'bun run check',
    'npx vitest run',
    'npx playwright test',
    'npx tsc --noEmit',
    'cd app; npx electron . --smoke',
    'FOCUSSHELL_SMOKE_MINUTES=20 npx electron . --smoke',
    'pytest -q',
    'python -m pytest tests',
    'python3 -m unittest discover',
    'dotnet test',
    'dotnet build Sample.sln',
    'go test ./...',
    'go vet ./...',
    'cargo clippy',
    './gradlew test',
    'gradle assembleDebug',
    'mvn -q verify',
    './mvnw test',
    'powershell -NoProfile -Command "Invoke-Pester tests"',
    'flutter test',
    'flutter build apk',
    'xcodebuild -scheme Sample test',
    'make test',
    'timeout 600 npm test',
    'npm test # the whole suite',
    'npm test 2>&1',
    'node --test x.js &> /dev/null',
    'npm run build && npm test',
    'cd app\nnode --test lib/lib.test.js',
  ]) assert.equal(isRun(c), true, c);
});

test('quietrun isRun: only when the last part is the run, with no ||, background & or shell change (#3073)', () => {
  for (const c of [
    'npm test && git commit -m "x"',
    'node --test lib/lib.test.js && git log --oneline -60',
    'npm run build && ls dist',
    'go test ./... || true',
    'npm test || echo failed',
    'cd app || exit 1; node --test lib/lib.test.js',
    'dotnet test; echo $?',
    'mvn test; git status',
    'sleep 6 & node --test x',
    'npm run build && npx vite preview &',
    'export CI=1; npm test',
    'source .venv/bin/activate && pytest',
    '. ./env.sh; make test',
    'unset NODE_OPTIONS; npm test',
    'alias t=npm; npm test',
    'set -e; npm test',
    'CI=1; npm test',
    'mvn dependency:tree',
    'xcodebuild -list',
    'xcodebuild -showBuildSettings',
    // Ends in a heredoc's last line, not the run: left alone.
    'node --test <<EOF\nx\nEOF',
  ]) assert.equal(isRun(c), false, c);
  // A VAR=value before the run is for that command only, not a shell change.
  assert.equal(isRun('CI=1 npm test'), true);
});

test('quietrun isRun: a part before a ; or newline must be a cd or a comment, so its failure is never masked (#3073)', () => {
  for (const c of [
    'npx prettier --check . ; npm test',
    'npx prettier --check .\nnpm test',
    'cd app\nnpm run lint\nnpm test',
    'cd app; npm run build && npm test',
    'git diff --check; node --test x.js',
    // A quoted body is never split, so these are never wrapped.
    'bash -c "npm test"',
    'bash -c "npm test; echo done"',
    'bash -c "npm test && git log --oneline -60"',
    'sh -c \'go test ./...\'',
    'cmd /c "npm test"',
    // bash skips the subshell's EXIT trap after exec: the marker would be lost.
    'exec npm test',
  ]) assert.equal(isRun(c), false, c);
  for (const c of [
    'cd app; node --test x.js',
    'cd app && npm test',
    'cd app\nnode --test lib/lib.test.js',
    '# the unit tests\nnpm test',
    'cd app; # the unit tests\nnode --test x.js',
    'npm run build && npm test',
  ]) assert.equal(isRun(c), true, c);
});

test('quietrun isRun: a test tool\'s list, config, help or version form is left alone (#3073)', () => {
  for (const c of [
    'npx tsc --showConfig',
    'npx tsc --show-config',
    'npx eslint --print-config a.js',
    'npx jest --listTests',
    'npx playwright test --list',
    'npx vitest list',
    'pytest --collect-only -q',
    'dotnet test --list-tests',
    'go test -list . ./...',
    'cargo test -- --list',
    'mvn dependency:tree -Dscope=test',
    './gradlew tasks --group build',
    'npx jest --help',
    'npx vitest --version',
    'node gen.mjs --test-data out',
    'node --test-reporter=dot gen.mjs',
  ]) assert.equal(isRun(c), false, c);
  for (const c of ['node --test', 'node --test-reporter=dot --test x.js', 'npx jest', 'pytest -q tests']) assert.equal(isRun(c), true, c);
  // A word "list" or "tasks" in an ordinary run is not its list form.
  for (const c of [
    'npx jest -t "shows the list"',
    'pytest -k list',
    'pytest tasks/',
    'node --test list.test.js',
    'cd app/lib; node --test tasks.test.js',
    'dotnet test Tasks.Tests.csproj',
    'npm run test -- --listener-port 9',
  ]) assert.equal(isRun(c), true, c);
});

test('quietrun isRun: pipes, watches, other commands and mentions are left alone (#3073)', () => {
  for (const c of [
    '',
    '   ',
    undefined,
    'git status',
    'node --test x.js | tail -3',
    'npm test 2>&1 | grep fail',
    'npm test |& tail',
    'npx vitest --watch',
    'npm run test:watch',
    'npx jest --watchAll',
    'watch npm test',
    'npm install',
    'npm ci',
    'npm start',
    'node app/deck.mjs list',
    'git commit -m "fix: npm test runs on CI; go test too"',
    'grep -rn "node --test" app',
    'echo npm test',
    'ls build',
  ]) assert.equal(isRun(c), false, String(c));
});

test('quietrun wrap: the EXIT trap prints the marker and keeps the folder; the filter with forward slashes (#3073)', () => {
  assert.equal(wrap('npm test', 'C:\\deck\\app\\lead-plugin\\hooks\\quiet-out.mjs'),
    `__ad_d=$(mktemp); ( trap 'echo "${MARK}$?"; pwd -P >| "$__ad_d"' EXIT\nnpm test\n) 2>&1 | node "C:/deck/app/lead-plugin/hooks/quiet-out.mjs"; `
    + `__ad_rc=$?; cd "$(cat "$__ad_d" 2>/dev/null || pwd)"; rm -f "$__ad_d"; (exit $__ad_rc)`);
  assert.equal(MARK, '__FOCUSSHELL_EXIT__:');
});

test('quietrun markAfter: the code and the length of its line (#3073)', () => {
  assert.deepEqual(markAfter('0\nrest'), { code: 0, length: 2 });
  assert.deepEqual(markAfter('12\r\n'), { code: 12, length: 4 });
  assert.deepEqual(markAfter('3'), { code: 3, length: 1 });
  assert.equal(markAfter('x\n'), null);
  assert.equal(markAfter(''), null);
});

test('quietrun splitMark: takes the marker line out and reads the code (#3073)', () => {
  assert.deepEqual(splitMark(`a\nb\n${MARK}0\n`), { text: 'a\nb\n', code: 0 });
  assert.deepEqual(splitMark(`a\nb\n${MARK}3\r\n`), { text: 'a\nb\n', code: 3 });
  // Output without a final newline: the marker is glued to its last line.
  assert.deepEqual(splitMark(`a\nb${MARK}1\n`), { text: 'a\nb', code: 1 });
  // A later line (a background child still printing) is kept.
  assert.deepEqual(splitMark(`a\n${MARK}0\nlate\n`), { text: 'a\nlate\n', code: 0 });
  assert.deepEqual(splitMark('a\nb\n'), { text: 'a\nb\n', code: null });
  assert.deepEqual(splitMark(`a\n${MARK}x\n`), { text: `a\n${MARK}x\n`, code: null });
  assert.deepEqual(splitMark(''), { text: '', code: null });
});

test('quietrun failedSigns: any sign of failure, even with exit 0 (#3073)', () => {
  for (const t of ['# fail 1', 'ℹ fail 0\n# fail 2', '3 failed, 10 passed', '1 failing', '2 errors',
    'Tests: FAILED', 'FAIL src/sample.test.js', 'TypeError: x is not a function', 'npm ERR! code 1',
    'Traceback (most recent call last):', 'panic: runtime error', '✗ adds', '✖ adds', 'smoke run failed: 2 lines',
    'not ok 4 - adds', 'bash: cd: ap: No such file or directory', 'cd: no such file or directory: ap'])
    assert.equal(failedSigns(t), true, t);
  for (const t of ['# fail 0', '0 failed, 12 passed', '0 errors', 'ok 1 - adds', '✔ adds', '', 'Build succeeded.'])
    assert.equal(failedSigns(t), false, t);
});

const many = (n, f = i => `ok ${i} - sample ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1));

// Real-looking failure output of runners that may exit 0, or whose code a later part could mask.
const FAILS = {
  'Pester 3.4': ['Describing Get-Sample', ' [+] returns one 52ms', ' [-] returns two 31ms', '   Expected: {2}',
    '   But was:  {1}', '   at line: 5 in C:\\sample\\Sample.Tests.ps1', 'Tests completed in 83ms',
    'Passed: 0 Failed: 9 Skipped: 0 Pending: 0 Inconclusive: 0'],
  'Pester 3.4, summary only': ['Tests completed in 83ms', 'Passed: 0 Failed: 9 Skipped: 0 Pending: 0 Inconclusive: 0'],
  'Pester 5': ['Starting discovery in 1 files.', 'Discovery found 46 tests in 120ms.', 'Running tests.',
    '[-] Get-Sample.returns two 12ms (10ms|2ms)', ' Expected 2, but got 1.', 'Tests completed in 1.2s',
    'Tests Passed: 45, Failed: 1, Skipped: 0 NotRun: 0'],
  'Pester 5, summary only': ['Tests completed in 1.2s', 'Tests Passed: 45, Failed: 1, Skipped: 0 NotRun: 0'],
  'go test': ['=== RUN   TestAdd', '--- FAIL: TestAdd (0.00s)', '    add_test.go:9: got 1, want 2', 'FAIL', 'FAIL\tsample/add\t0.012s'],
  'go build': ['# sample/add', './add.go:5:2: undefined: x'],
  'dotnet test': ['Failed Sample.Tests.Adds [12 ms]', 'Failed!  - Failed:     1, Passed:    11, Skipped:     0, Total:    12'],
  'maven': ['Tests run: 12, Failures: 1, Errors: 0, Skipped: 0', '[INFO] BUILD FAILURE'],
  'flutter': ['00:03 +11 -1: Some tests failed.'],
  'cargo': ['error[E0425]: cannot find value `x` in this scope', ' --> src/main.rs:2:5'],
  'tsc': ['src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.'],
  'make': ['make: *** [Makefile:4: test] Error 2'],
};

test('quietrun failedSigns: Pester, go, dotnet, maven, flutter, cargo, tsc and make failures (#3073)', () => {
  for (const [name, lines] of Object.entries(FAILS)) {
    if (name === 'go build') continue; // its only sign is the exit code
    assert.equal(failedSigns(lines.join('\n')), true, name);
  }
});

test('quietrun summarize: a long run that exits 0 with failure output stays complete (#3073)', () => {
  for (const [name, lines] of Object.entries(FAILS)) {
    if (name === 'go build') continue;
    const text = [...many(SHORT_LINES + 5, i => `step ${i}`), ...lines].join('\n') + '\n';
    assert.equal(summarize({ text, code: 0, secs: 1, file: 'f.log' }), null, name);
  }
});

test('quietrun summarize: passing Pester and dotnet runs are still shortened (#3073)', () => {
  for (const last of ['Passed: 46 Failed: 0 Skipped: 0 Pending: 0 Inconclusive: 0',
    'Tests Passed: 46, Failed: 0, Skipped: 0 NotRun: 0',
    'Passed!  - Failed:     0, Passed:    12, Skipped:     0, Total:    12']) {
    const text = [...many(SHORT_LINES + 5, i => ` [+] sample ${i} 3ms`), last].join('\n') + '\n';
    assert.notEqual(summarize({ text, code: 0, secs: 1, file: 'f.log' }), null, last);
  }
});

test('quietrun summarize: short, failed or failed-looking output stays complete (#3073)', () => {
  assert.equal(summarize({ text: 'ok 1\n# pass 1\n', code: 0, secs: 1, file: 'f.log' }), null);
  const long = many(SHORT_LINES + 10).join('\n') + '\n';
  assert.equal(summarize({ text: long, code: 1, secs: 1, file: 'f.log' }), null);
  assert.equal(summarize({ text: long + '# fail 1\n', code: 0, secs: 1, file: 'f.log' }), null);
  // Few lines but over 3,000 characters is not short.
  const wide = many(5, i => `ok ${i} ` + 'x'.repeat(800)).join('\n');
  assert.notEqual(summarize({ text: wide, code: 0, secs: 1, file: 'f.log' }), null);
});

test('quietrun summarize: a long node --test pass gives the header and its count lines (#3073)', () => {
  const text = [...many(60), '1..60', '# tests 60', '# suites 0', '# pass 60', '# fail 0', '# cancelled 0',
    '# skipped 0', '# todo 0', '# duration_ms 1234.5'].join('\n') + '\n';
  const s = summarize({ text, code: 0, secs: 12.345, file: 'C:\\tmp\\focusshell-runs\\run.log' });
  const lines = s.split('\n');
  assert.equal(lines[0], '[FocusShell] passed (exit 0) in 12.3 s: 69 lines, full output in C:\\tmp\\focusshell-runs\\run.log');
  assert.deepEqual(lines.slice(1), ['# tests 60', '# pass 60', '# fail 0', '# skipped 0', '# todo 0', '# duration_ms 1234.5']);
});

test('quietrun summarize: no count lines gives the last three non-empty lines (#3073)', () => {
  const text = [...many(50, i => `step ${i}`), '', 'done', ''].join('\n');
  const s = summarize({ text, code: 0, secs: 2, file: 'f.log' }).split('\n');
  assert.match(s[0], /^\[FocusShell\] passed \(exit 0\) in 2 s: 52 lines, full output in f\.log$/);
  assert.deepEqual(s.slice(1), ['step 49', 'step 50', 'done']);
});
