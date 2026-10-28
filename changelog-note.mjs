#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { validateNote } from './check-changelog-note.mjs';

const noteKeys = new Set([
	'id',
	'category',
	'summary',
	'details',
	'breaking',
	'migration',
	'kind',
	'reason',
	'integration',
]);
const fail = (message) => {
	throw new Error(message);
};
const help = `Add an authored Audiom change note without editing JSON.

  npm run changelog:add
  npm run changelog:add -- --id map-controls --category Fixed --summary "Keep map controls keyboard accessible."
  npm run changelog:add -- --id build-notes --kind internal --reason "Improve build diagnostics without changing reader behavior."

Options: --id, --category, --summary, --details, --breaking, --migration,
         --kind internal --reason, --integration FULL_SHA, --root DIRECTORY
Run without complete note options in a terminal for guided prompts.
Breaking changes need migration instructions. Existing note IDs are never replaced.
The note is written to .changelog in the current repository unless --root is supplied.
Review and commit it with your source change; this helper never changes Git state.
`;

export function createNote(root, note) {
	validateNote(note);
	const directory = path.join(root, '.changelog');
	mkdirSync(directory, { recursive: true });
	const file = path.join(directory, `${note.id}.json`);
	writeFileSync(file, JSON.stringify(note, null, '\t') + '\n', { flag: 'wx' });
	return file;
}

export async function noteFromFlags(flags) {
	const note = Object.fromEntries(
		Object.entries(flags).filter(([key]) => noteKeys.has(key)),
	);
	if (
		note.id &&
		(note.kind === 'internal' ? note.reason : note.category && note.summary) &&
		(!note.breaking || note.migration)
	)
		return note;
	if (!process.stdin.isTTY)
		fail(
			'Supply --id and --category/--summary (or --kind internal/--reason); breaking notes also need --migration. Run this helper in a terminal for guided prompts.',
		);
	const terminal = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		note.id ||= (
			await terminal.question('Stable note ID (for example map-controls): ')
		).trim();
		if (!note.kind && !note.category) {
			const kind = (
				await terminal.question(
					'Reader-facing change or internal work? [reader/internal]: ',
				)
			).trim();
			if (kind === 'internal') note.kind = 'internal';
			else if (kind && kind !== 'reader') fail('Choose reader or internal.');
		}
		if (note.kind === 'internal')
			note.reason ||= (
				await terminal.question('Why does this change have no product impact? ')
			).trim();
		else {
			note.category ||= (
				await terminal.question(
					'Category [Added/Changed/Deprecated/Removed/Fixed/Security]: ',
				)
			).trim();
			note.summary ||= (
				await terminal.question('What changed for a reader or integrator? ')
			).trim();
			if (!note.details) {
				const details = (
					await terminal.question('Technical details (optional): ')
				).trim();
				if (details) note.details = details;
			}
			if (!note.breaking) {
				const answer = (
					await terminal.question('Is this a breaking change? [yes/no]: ')
				)
					.trim()
					.toLowerCase();
				if (answer === 'yes' || answer === 'y') note.breaking = true;
				else if (answer && answer !== 'no' && answer !== 'n')
					fail('Choose yes or no for a breaking change.');
			}
			if (note.breaking && !note.migration)
				note.migration = (
					await terminal.question('What must an integrator change? ')
				).trim();
		}
		return note;
	} finally {
		terminal.close();
	}
}

function argumentsFor(args) {
	const flags = {};
	for (let index = 0; index < args.length; index++) {
		const value = args[index];
		const key = value.startsWith('--') ? value.slice(2) : '';
		if (!noteKeys.has(key) && !['root', 'help'].includes(key))
			fail(`Unknown option ${value}. Use --help.`);
		if (key in flags) fail(`Duplicate option ${value}.`);
		if (key === 'breaking' || key === 'help') flags[key] = true;
		else {
			const next = args[++index];
			if (next === undefined || next.startsWith('--'))
				fail(`${value} needs a value.`);
			flags[key] = next;
		}
	}
	return flags;
}

async function main(args) {
	const flags = argumentsFor(args);
	if (flags.help) {
		console.log(help);
		return;
	}
	const file = createNote(
		path.resolve(flags.root || process.cwd()),
		await noteFromFlags(flags),
	);
	console.log(
		`Created ${file}. Review and commit the fragment with the source change.`,
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(`Changelog note failed: ${error.message}`);
		process.exitCode = 1;
	}
}
