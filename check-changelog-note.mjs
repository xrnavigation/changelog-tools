#!/usr/bin/env node
// The one changelog note checker for every Audiom repository.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateNote(note) {
	if (!note || !/^[a-z0-9][a-z0-9-]*$/.test(note.id))
		throw new Error('A note needs a stable lowercase id.');
	const text = (value) =>
		typeof value === 'string' && value.trim().length >= 15;
	if (note.kind !== undefined && note.kind !== 'internal')
		throw new Error(`${note.id}: unsupported note kind.`);
	if (note.breaking !== undefined && typeof note.breaking !== 'boolean')
		throw new Error(`${note.id}: breaking must be boolean.`);
	for (const key of ['details', 'migration'])
		if (note[key] !== undefined && typeof note[key] !== 'string')
			throw new Error(`${note.id}: ${key} must be text.`);
	if (
		note.integration !== undefined &&
		!/^[a-f0-9]{40}$/.test(note.integration)
	)
		throw new Error(
			`${note.id}: recovery integration must be a full commit SHA.`,
		);
	if (note.kind === 'internal') {
		if (!text(note.reason))
			throw new Error(
				`${note.id}: reason must explain why the change has no product impact.`,
			);
	} else {
		if (
			![
				'Added',
				'Changed',
				'Deprecated',
				'Removed',
				'Fixed',
				'Security',
			].includes(note.category)
		)
			throw new Error(`${note.id}: unknown category.`);
		if (!text(note.summary))
			throw new Error(`${note.id}: summary must describe the reader outcome.`);
		if (note.breaking && !text(note.migration))
			throw new Error(`${note.id}: breaking changes need migration advice.`);
	}
	return note;
}

const git = (args) =>
	execFileSync('git', args, {
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	}).trim();
export function checkRange(baseRef, head = 'HEAD') {
	// Index trees have no ancestry; inspect committed history through HEAD instead.
	const historyHead = git(['cat-file', '-t', head]) === 'tree' ? 'HEAD' : head;
	// Compare from where the branch left its base, so notes the base gained
	// since then are not read as edits to published notes.
	const base = git(['merge-base', baseRef, historyHead]);
	const previous = git([
		'ls-tree',
		'-r',
		'--name-only',
		base,
		'--',
		'.changelog',
	])
		.split('\n')
		.filter((file) => file.endsWith('.json'));
	const immutable = new Set(previous);
	const historicalChanges = git([
		'log',
		'--format=',
		'--name-only',
		'--no-renames',
		'--diff-filter=MDT',
		'--diff-merges=first-parent',
		`${base}..${historyHead}`,
		'--',
		'.changelog',
	])
		.split('\n')
		.filter((file) => immutable.has(file));
	const changedNotes = git([
		'diff',
		'--no-renames',
		'--name-only',
		'--diff-filter=MDT',
		base,
		head,
		'--',
		'.changelog',
	])
		.split('\n')
		.filter((file) => file.endsWith('.json'));
	const forbidden = [...new Set([...changedNotes, ...historicalChanges])];
	if (forbidden.length)
		throw new Error(
			`Published change fragments are immutable; add a new correction note instead: ${forbidden.join(', ')}`,
		);
	// Match collection's per-commit evidence, including substantive work later
	// reverted within the range. Combined merge diffs capture resolutions without
	// treating ordinary replay of the base branch as a new implementation.
	// A staged tree also contributes its net index changes after historyHead.
	const paths = [
		...new Set(
			[
				git(['diff', '--name-only', base, head]),
				git([
					'log',
					'--format=',
					'--name-only',
					'--cc',
					`${base}..${historyHead}`,
				]),
			]
				.join('\n')
				.split('\n')
				.filter(Boolean),
		),
	];
	const relevant = paths.filter(
		(file) =>
			!file.startsWith('.changelog/') &&
			!/(?:^|\/)(?:docs?|documentation|test|tests|e2e|reports)\//.test(file) &&
			!/(?:\.test\.|\.spec\.|\.md$|\.mdx$|^LICENSE|^\.gitignore$)/.test(file),
	);
	const newNotes = git([
		'diff',
		'--name-only',
		'--diff-filter=A',
		base,
		head,
		'--',
		'.changelog',
	])
		.split('\n')
		.filter((file) => file.endsWith('.json'));
	if (relevant.length && !newNotes.length)
		throw new Error(
			`Add a new .changelog/<id>.json describing this change or its internal-only reason: run \`npm run changelog:add\`, answer its prompts, and commit the file it writes (\`npm run changelog:add -- --help\` lists flags for scripted use). Changed files: ${relevant.join(', ')}`,
		);
	const ids = new Set();
	for (const file of newNotes) {
		const note = validateNote(JSON.parse(git(['show', `${head}:${file}`])));
		if (ids.has(note.id)) throw new Error(`Duplicate note id ${note.id}.`);
		ids.add(note.id);
		if (file !== `.changelog/${note.id}.json`)
			throw new Error(`${file}: filename must match note id.`);
	}
	const oldIds = new Set(
		previous.map((file) => JSON.parse(git(['show', `${base}:${file}`])).id),
	);
	for (const id of ids)
		if (oldIds.has(id))
			throw new Error(`Note id ${id} already exists in the base history.`);
	return { required: relevant.length > 0, notes: newNotes.length };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	try {
		const staged = process.argv[2] === '--staged';
		const base = staged ? process.argv[3] || 'HEAD' : process.argv[2];
		if (!base)
			throw new Error(
				'Usage: check-changelog-note <base-sha> [head-sha] | --staged [base-sha]',
			);
		const result = checkRange(
			base,
			staged ? git(['write-tree']) : process.argv[3] || 'HEAD',
		);
		console.log(
			result.required
				? `${result.notes} valid new change note(s).`
				: 'Documentation/test-only change; no product note required.',
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
