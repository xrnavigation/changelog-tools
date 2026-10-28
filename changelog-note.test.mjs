import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createNote } from './changelog-note.mjs';

const helper = fileURLToPath(new URL('./changelog-note.mjs', import.meta.url));
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('note creation validates reader, internal, and breaking notes without replacing existing fragments', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'changelog-note-'));
	const note = {
		id: 'fix-controls',
		category: 'Fixed',
		summary: 'Keep map controls accessible using a keyboard.',
	};
	const file = createNote(root, note);
	assert.deepEqual(read(file), note);
	assert.throws(() => createNote(root, note), /exists|EEXIST/i);
	assert.throws(
		() => createNote(root, { ...note, id: '../escape' }),
		/stable lowercase/i,
	);
	assert.throws(
		() => createNote(root, { ...note, id: 'breaking', breaking: true }),
		/migration/i,
	);
	assert.equal(
		read(
			createNote(root, {
				id: 'internal-note',
				kind: 'internal',
				reason: 'Improve test diagnostics without a reader-facing change.',
			}),
		).kind,
		'internal',
	);
	assert.equal(
		read(
			createNote(root, {
				...note,
				id: 'migration-note',
				breaking: true,
				migration: 'Use the replacement control integration.',
			}),
		).breaking,
		true,
	);
});

test('the note command writes notes into the repository it runs in', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'changelog-note-cli-'));
	const run = (...args) =>
		execFileSync(process.execPath, [helper, ...args], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	assert.match(run('--help'), /summary|breaking/);
	run(
		'--id',
		'backend-map-security',
		'--category',
		'Security',
		'--summary',
		'Protect private map records from unauthorized readers.',
	);
	assert.equal(
		read(path.join(root, '.changelog/backend-map-security.json')).category,
		'Security',
	);
	run(
		'--id',
		'backend-internal',
		'--kind',
		'internal',
		'--reason',
		'Improve backend diagnostics without changing reader behavior.',
	);
	assert.equal(
		read(path.join(root, '.changelog/backend-internal.json')).kind,
		'internal',
	);
	assert.throws(
		() =>
			run(
				'--id',
				'breaking-map',
				'--category',
				'Changed',
				'--summary',
				'Replace the map API configuration contract.',
				'--breaking',
			),
		/migration/i,
	);
	assert.throws(
		() =>
			run(
				'--id',
				'backend-map-security',
				'--category',
				'Security',
				'--summary',
				'Protect private map records from unauthorized readers.',
			),
		/exists|EEXIST/i,
	);
});
