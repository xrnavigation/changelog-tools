import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRange } from './check-changelog-note.mjs';

const checker = fileURLToPath(
	new URL('./check-changelog-note.mjs', import.meta.url),
);
const note = (summary = 'Explore maps using the new keyboard controls.') =>
	JSON.stringify({ id: 'controls', category: 'Added', summary });
const internal = (reason) =>
	JSON.stringify({ id: 'abandoned-controls', kind: 'internal', reason });
function fixture() {
	const cwd = mkdtempSync(path.join(tmpdir(), 'changelog-check-'));
	const git = (...args) =>
		execFileSync('git', args, {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	git('init', '-b', 'master');
	git('config', 'user.name', 'Fragment tests');
	git('config', 'user.email', 'fragments@example.invalid');
	git('config', 'core.hooksPath', path.join(cwd, 'no-hooks'));
	const write = (file, content) => {
		mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
		writeFileSync(path.join(cwd, file), content);
	};
	const commit = () => {
		git('add', '.');
		git('commit', '-m', 'Fixture integration');
		return git('rev-parse', 'HEAD');
	};
	write('README.md', 'Initial scaffold');
	const baseline = commit();
	const range = (base, head = 'HEAD') => {
		const prior = process.cwd();
		try {
			process.chdir(cwd);
			return checkRange(base, head);
		} finally {
			process.chdir(prior);
		}
	};
	const run = (...args) =>
		execFileSync(process.execPath, [checker, ...args], {
			cwd,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	return { cwd, git, write, commit, baseline, range, run };
}

test('new feature-branch draft notes remain editable before integration', () => {
	const f = fixture();
	f.git('checkout', '-b', 'feature');
	f.write('app.js', 'export const controls=true;');
	f.write('.changelog/controls.json', note());
	f.commit();
	f.write(
		'.changelog/controls.json',
		note('Explore maps using keyboard controls and clearer position feedback.'),
	);
	f.commit();
	assert.equal(f.range(f.baseline).notes, 1);
});

test('notes the base branch gained after the branch point are not edits by the branch', () => {
	const f = fixture();
	f.git('checkout', '-b', 'feature');
	f.write('app.js', 'export const controls=true;');
	f.write('.changelog/controls.json', note());
	const head = f.commit();
	f.git('checkout', 'master');
	f.write('other.js', 'export const other=true;');
	f.write(
		'.changelog/other.json',
		JSON.stringify({
			id: 'other',
			category: 'Fixed',
			summary: 'Another change merged while the branch was open.',
		}),
	);
	const base = f.commit();
	assert.equal(f.range(base, head).notes, 1);
});

test('modifications restored to a fragment already present in the base are rejected', () => {
	const f = fixture();
	f.write('.changelog/controls.json', note());
	const base = f.commit();
	f.write(
		'.changelog/controls.json',
		note('Describe a different behavior temporarily.'),
	);
	f.commit();
	f.write('.changelog/controls.json', note());
	f.commit();
	assert.throws(() => f.range(base), /immutable/i);
});

test('staged source changes cannot pass by checking an unchanged HEAD', () => {
	const f = fixture();
	f.write('app.js', 'export const controls=true;');
	f.git('add', '--', 'app.js');
	assert.throws(
		() => f.run('--staged'),
		(error) => error.status === 1 && /Add a new .changelog/.test(error.stderr),
	);
});

test('staged new notes validate against the index tree and preserve explicit base support', () => {
	const f = fixture();
	f.write('app.js', 'export const controls=true;');
	f.write('.changelog/controls.json', note());
	f.git('add', '.');
	for (const args of [['--staged'], ['--staged', f.baseline]])
		assert.match(f.run(...args), /1 valid new change note/);
	assert.equal(f.range(f.baseline, f.git('write-tree')).notes, 1);
});

test('production commits reverted within the range still need a note', () => {
	const f = fixture();
	f.write('app.js', 'export const abandoned=true;');
	f.commit();
	unlinkSync(path.join(f.cwd, 'app.js'));
	f.commit();
	assert.equal(f.git('diff', '--name-only', f.baseline, 'HEAD'), '');
	assert.throws(() => f.range(f.baseline), /Add a new .changelog/i);
	f.write(
		'.changelog/abandoned-controls.json',
		internal(
			'An experimental control implementation was reverted before integration, leaving no reader-facing behavior.',
		),
	);
	f.commit();
	assert.deepEqual(f.range(f.baseline), { required: true, notes: 1 });
});

test('staged explicit-base checking includes committed reverted work while the default only checks the index', () => {
	const f = fixture();
	f.write('app.js', 'export const abandoned=true;');
	f.commit();
	unlinkSync(path.join(f.cwd, 'app.js'));
	f.commit();
	const tree = f.git('write-tree');
	assert.equal(f.range('HEAD', tree).required, false);
	assert.throws(() => f.range(f.baseline, tree), /Add a new .changelog/i);
	f.write(
		'.changelog/abandoned-controls.json',
		internal(
			'Revert an experiment before integration without changing reader-facing behavior.',
		),
	);
	f.git('add', '--', '.changelog/abandoned-controls.json');
	assert.deepEqual(f.range(f.baseline, f.git('write-tree')), {
		required: true,
		notes: 1,
	});
	assert.match(f.run('--staged', f.baseline), /1 valid new change note/);
});

test('routine base-branch replay does not turn a documentation-only PR into an unnoted production change', () => {
	const f = fixture();
	f.write('app.js', 'export const version=0;');
	f.commit();
	f.git('checkout', '-b', 'feature');
	f.write('docs/feature.md', 'Explain the existing map controls.');
	f.commit();
	f.git('checkout', 'master');
	f.write('app.js', 'export const version=1;');
	const base = f.commit();
	f.git('checkout', 'feature');
	f.git('merge', '--no-ff', 'master', '-m', 'Bring in current base');
	assert.deepEqual(f.range(base), { required: false, notes: 0 });
});
