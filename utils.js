import { FlashpointArchive } from 'npm:@fparchive/flashpoint-archive';

import { namespaceFunctions } from './nsfuncs.js';

// Build a list of text definitions to supply to the HTML template
export async function buildDefs(namespace, lang, url = null) {
	const defs = lang == config.defaultLang
		? locales[config.defaultLang].translations[namespace]
		: Object.assign({}, locales[config.defaultLang].translations[namespace], locales[lang].translations[namespace]);
	if (Object.hasOwn(namespaceFunctions, namespace))
		Object.assign(defs, await namespaceFunctions[namespace](url, lang, defs));

	return defs;
}

// Safely fill HTML template with text definitions
export function buildHtml(template, defs) {
	const varSlices = [];
	const varExp = /(?:(^|\n)(\t*))?\{(.*?)\}/gs;
	for (let match; (match = varExp.exec(template)) !== null;) {
		const value = buildStringFromParams(match[3], defs);
		const newLine = match[1] ?? '';
		const tabs = match[2] ?? '';
		const formattedValue = value ? newLine + value.replaceAll(/^/gm, tabs) : '';
		varSlices.push({
			start: match.index,
			end: match.index + match[0].length,
			value: formattedValue,
		});
	}

	return replaceSlices(template, varSlices);
}

// Interpret a sequence of parameters and construct a string
export function buildStringFromParams(paramsStr, defs = {}) {
	const paramBounds = {
		string:     ['"', '"'],
		element:    ['<', '>'],
		definition: ['', ''],
	};
	const delim = ',';
	const fallbackStr = 'null';
	const invalidParam = { type: 'invalid', value: '' };

	// Don't waste any time if the first parameter is obviously invalid
	if (paramsStr.length == 0 || /^\s*,/.test(paramsStr) || Object.keys(defs).length == 0)
		return fallbackStr;

	const params = [];

	// Split the parameters and check validity
	let activeParamType = '';
	let activeParamValue = '';
	let activeParamMode = 1; // 0 = Building param, 1 = seeking start of param, 2 = seeking delimiter
	for (let i = 0; i < paramsStr.length; i++) {
		const char = paramsStr[i];
		const activeParamBounds = paramBounds[activeParamType];
		let doBreak = false;

		if (activeParamMode == 0) {
			// Ignore presence of delimiter if the active parameter is a string
			if (activeParamType != 'string' && char == delim)
				doBreak = true;
			else {
				activeParamValue += char;
				if (activeParamType == 'string' && char == activeParamBounds[1])
					activeParamMode = 2;
			}
		}
		else {
			if (/\s/.test(char)) continue; // Ignore whitespace when seeking
			if (activeParamMode == 1) {
				if (char == delim)
					params.push(invalidParam); // We're trying to find a parameter, not a delimiter
				else {
					// The start of a new parameter has been found; identify its type
					for (const type in paramBounds) {
						const typeStart = paramBounds[type][0];
						if (char.includes(typeStart)) {
							activeParamType = type;
							activeParamValue = char;
							activeParamMode = 0;
							break;
						}
					}
				}
				continue;
			}
			else if (activeParamMode == 2) {
				if (char != delim)
					params.push(invalidParam); // We're trying to find a delimiter, not a parameter
				else
					doBreak = true;
			}
		}

		if (doBreak || i == paramsStr.length - 1) {
			// If this is the first parameter, is it a definition?
			const condition1 = params.length > 0 || activeParamType == 'definition';
			// Is the param value not empty?
			const condition2 = condition1 && activeParamValue.length > 0;
			// Does the param value start with the correct left bound?
			const condition3 = condition2 && activeParamValue.startsWith(activeParamBounds[0]);
			// Does the param value end with the correct right bound?
			const condition4 = condition3 && activeParamValue.endsWith(activeParamBounds[1]);
			// Is the param value valid?
			const condition5 = condition4 && (activeParamType == 'string'
				|| (activeParamType == 'element' && !/<[\s\/]/.test(activeParamValue))
				|| (activeParamType == 'definition' && Object.hasOwn(defs, activeParamValue)));

			if (condition5) {
				// Remove boundary characters from param types that have them
				if (activeParamType != 'definition')
					activeParamValue = activeParamValue.substring(1, activeParamValue.length - 1);
				params.push({ type: activeParamType, value: activeParamValue });
			}
			else {
				if (params.length == 0)
					return fallbackStr; // There's no reason to keep going if the first parameter is invalid
				else
					params.push(invalidParam);
			}

			activeParamType = '';
			activeParamValue = '';
			activeParamMode = 1;
		}
	}

	// Initialize the output string using the first parameter
	let targetStr = defs[params[0].value];
	// Dynamic definitions might be numbers, so make sure this isn't one
	if (typeof targetStr == 'number') targetStr = targetStr.toString();

	// Apply any other parameters to the string
	if (params.length > 1) {
		const tagPartsExp = /^([^\s]+)(.*)$/;
		const targetStrReplacer = (_, i, input) => {
			i = parseInt(i, 10);
			if (i < params.length) {
				const param = params[i];
				if (param.type == 'definition') return defs[param.value];
				if (param.type == 'string') return param.value;
				if (param.type == 'element') {
					if (input !== undefined) {
						let newStr = input;
						for (const tag of param.value.split('><').reverse()) {
							const tagParts = tag.match(tagPartsExp);
							if (tagParts) {
								const [_, name, attrs] = tagParts;
								newStr = `<${name}${attrs}>${newStr}</${name}>`;
							}
						}
						if (newStr != input) return newStr;
					}
					else {
						const tagParts = param.value.match(tagPartsExp);
						if (tagParts) {
							const [_, name, attrs] = tagParts;
							return `<${name}${attrs}>`;
						}
					}
				}
			}
			return fallbackStr;
		};

		// Handle regular variables before function variables, in case any of the former exist inside the latter
		targetStr = targetStr.replace(/\$(\d+)(?!\{)/g, targetStrReplacer);

		// Now handle the function variables
		targetStr = targetStr.replace(/\$(\d+)\{(.*?)\}/g, targetStrReplacer);
	}

	return targetStr;
}

// Create or update a database file
// Adapted from https://github.com/FlashpointProject/FPA-Rust/blob/master/crates/flashpoint-database-builder/src/main.rs
export async function updateDatabase() {
	const lastUpdated = new Date().toISOString();
	const lastUpdatedPath = 'data/lastUpdated.txt';
	const createNew = !getPathInfo(config.databaseFile)?.isFile;
	let afterDate = '1970-01-01';
	if (createNew)
		logMessage('building new database...');
	else {
		logMessage('updating database...');
		if (getPathInfo(lastUpdatedPath)?.isFile)
			afterDate = Deno.readTextFileSync(lastUpdatedPath);
	}

	// Initialize new database
	const fp = new FlashpointArchive();
	fp.loadDatabase(config.databaseFile);

	// Fetch and apply platforms
	const platsRes = await fetchFromFpfss(`platforms?after=${afterDate}`);
	logMessage(`applying ${platsRes.length} platforms...`);
	await fp.updateApplyPlatforms(platsRes.map(plat => propsToCamel(plat)));

	// Fetch and apply tags and tag categories
	const tagsRes = await fetchFromFpfss(`tags?after=${afterDate}`);
	logMessage(`applying ${tagsRes.categories.length} categories...`);
	await fp.updateApplyCategories(tagsRes.categories);
	logMessage(`applying ${tagsRes.tags.length} tags...`);
	await fp.updateApplyTags(tagsRes.tags.map(tag => propsToCamel(tag)));

	// Fetch and apply pages of games until there are none left
	let totalAppliedGames = 0;
	let pageNum = 1;
	let afterId;
	while (true) {
		const gamesRes = await fetchFromFpfss(`games?broad=true&after=${afterDate}` + (afterId ? `&afterId=${afterId}` : ''));
		logMessage(`applying page ${pageNum} of games... (total: ${totalAppliedGames + gamesRes.games.length})`);
		pageNum++;
		if (gamesRes.games.length > 0) {
			totalAppliedGames += gamesRes.games.length;
			afterId = gamesRes.games[gamesRes.games.length - 1].id;
			await fp.updateApplyGames({
				games: gamesRes.games.map(game => propsToCamel(game)),
				addApps: gamesRes.add_apps.map(addApp => propsToCamel(addApp)),
				gameData: gamesRes.game_data.map(gameData => propsToCamel(gameData)),
				tagRelations: gamesRes.tag_relations,
				platformRelations: gamesRes.platform_relations
			}, 'flashpoint-archive');
		}
		else
			break;
	}

	if (!createNew) {
		// Fetch and apply deleted games
		const deletionsRes = await fetchFromFpfss(`games/deleted?after=${afterDate}`);
		deletionsRes.games = deletionsRes.games.map(deletion => propsToCamel(deletion));
		logMessage(`applying ${deletionsRes.games.length} game deletions...`);
		await fp.updateDeleteGames(deletionsRes);

		// Fetch and apply game redirects
		const redirectsRes = await fetchFromFpfss(`game-redirects`);
		logMessage(`applying ${redirectsRes.length} game redirects...`);
		await fp.updateApplyRedirects(redirectsRes.map(redirect => ({
			sourceId: redirect.source_id,
			destId: redirect.id,
		})));
	}

	// Optimize the database
	logMessage('optimizing database...');
	await fp.optimizeDatabase();

	// Write update time to file
	Deno.writeTextFileSync(lastUpdatedPath, lastUpdated);

	logMessage(`database ${createNew ? 'created' : 'updated'} successfully!`);
}

// Fetch data from an FPFSS endpoint
export async function fetchFromFpfss(endpoint) {
	return (await fetch(`${config.fpfssUrl}/api/${endpoint}`)).json();
}

// Change FPFSS properties to camel case to work with FPA library
export function propsToCamel(obj) {
	const newObj = {};
	for (const prop of Object.keys(obj)) {
		const propParts = prop.split('_');
		propParts[0] = propParts[0].toLowerCase();
		for (let i = 1; i < propParts.length; i++)
			propParts[i] = propParts[i][0].toUpperCase() + propParts[i].substring(1).toLowerCase();
		const newProp = propParts.join('');
		newObj[newProp] = newProp == 'aliases'
			? obj[prop].split(';').map(alias => alias.trim())
			: obj[prop];
	}
	return newObj;
}

// Replace slices of a string with different values
export function replaceSlices(str, slices) {
	let offset = 0;
	let newStr = '';
	for (const slice of slices.toSorted((a, b) => a.start - b.start)) {
		newStr += str.substring(0, slice.start - offset) + slice.value;
		str = str.substring(slice.end - offset);
		offset = slice.end;
	}
	return newStr + str;
}

// Sanitize string to ensure it can't inject tags or escape attributes
export function sanitizeInject(str) {
	if (str.length == 0) return str;
	const charMap = {
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
	};
	const charMapExp = new RegExp(`[${Object.keys(charMap).join('')}]`, 'g');
	return str.replace(charMapExp, m => charMap[m]);
}

// Run Deno.lstat without throwing error if path doesn't exist
export function getPathInfo(path) {
	try { return Deno.lstatSync(path); } catch {}
	return null;
}

// Log to the appropriate locations
export function logMessage(message) {
	message = `[${new Date().toLocaleString()}] ${message}`;
	if (config.logToConsole) console.log(message);
	if (config.logFile) try { Deno.writeTextFile(config.logFile, message + '\n', { append: true }); } catch {}
}