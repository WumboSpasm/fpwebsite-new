import { FlashpointArchive } from 'npm:@fparchive/flashpoint-archive';
import { parseArgs } from 'jsr:@std/cli@1.0.23/parse-args';
import { contentType } from 'jsr:@std/media-types@1.1.0';
import { setCookie, getCookies } from 'jsr:@std/http@1.0.21/cookie';

import { namespaceFunctions } from './namespaceFunctions.js';

// Command-line flags
const flags = parseArgs(Deno.args, {
	boolean: ['build'],
	string: ['config'],
	default: { 'build': false, 'config': 'config.json' },
});

// Default config
const config = {
	httpPort: 80,
	httpsPort: 443,
	httpsCert: null,
	httpsKey: null,
	accessHosts: [],
	blockedIPs: [],
	blockedUAs: [],
	logFile: 'server.log',
	logToConsole: true,
	logBlockedRequests: true,
	databaseFile: 'data/flashpoint.sqlite',
	fpfssUrl: 'https://fpfss.unstable.life',
	defaultLang: 'en-US',
};

// Attempt to load config from file
if (getPathInfo(flags['config'])?.isFile) {
	Object.assign(config, JSON.parse(Deno.readTextFileSync(flags['config'])));
	logMessage(`loaded config file: ${Deno.realPathSync(flags['config'])}`);
}
else
	logMessage('no config file found, using default config');

// If --build flag is passed, build a fresh database and exit
if (flags['build']) {
	await buildDatabase();
	Deno.exit(0);
}

// Otherwise, build a fresh database only if one doesn't exist yet
if (!getPathInfo(config.databaseFile)?.isFile) {
	logMessage('no database found, starting database build');
	buildDatabase();
}

const fp = new FlashpointArchive();
fp.loadDatabase(config.databaseFile);

const pages = getPages();
const namespaces = getNamespaces(pages);
const locales = getLocales(namespaces);
const templates = getTemplates(namespaces);

const defaultLocale = locales[config.defaultLang];

// Handle requests
const serverHandler = async (request, info) => {
	const ipAddress = info.remoteAddr.hostname;
	const userAgent = request.headers.get('User-Agent') ?? '';

	// Check if IP or user agent is in blocklist
	const blockRequest =
		config.blockedIPs.some(blockedIP => ipAddress.startsWith(blockedIP)) ||
		config.blockedUAs.some(blockedUA => userAgent.includes(blockedUA));

	// Log the request if desired
	if (!blockRequest || config.logBlockedRequests)
		logMessage(`${blockRequest ? 'BLOCKED ' : ''}${ipAddress} (${userAgent}): ${request.url}`);

	// If request needs to be blocked, return a Not Found error
	if (blockRequest) throw new NotFoundError();

	// Make sure request is for a valid URL
	const requestUrl = URL.parse(request.url);
	if (requestUrl === null) throw new BadRequestError();

	// If access host is configured, do not allow connections through any other hostname
	if (config.accessHosts.length > 0 && !config.accessHosts.some(host => host == requestUrl.hostname))
		throw new BadRequestError();

	const requestPath = requestUrl.pathname.replace(/^[/]+(.*?)[/]*$/, '$1');
	const page = pages[`/${requestPath}`];
	const responseHeaders = new Headers();

	// If request does not point to a page, serve from static directory
	if (page === undefined) {
		const filePath = `static/${requestPath}`;
		if (!getPathInfo(filePath)?.isFile) throw new NotFoundError();
		responseHeaders.set('Content-Type', contentType(filePath.substring(filePath.lastIndexOf('.'))) ?? 'application/octet-stream');
		responseHeaders.set('Cache-Control', 'max-age=14400');
		return new Response(Deno.openSync(filePath).readable, { headers: responseHeaders });
	}

	responseHeaders.set('Content-Type', 'text/html; charset=UTF-8');

	// Get the desired language and set cookie if needed
	let lang = requestUrl.searchParams.get('lang');
	if (lang !== null && Object.hasOwn(locales, lang))
		setCookie(responseHeaders, { name: 'lang', value: lang });
	else {
		lang = getCookies(request.headers).lang;
		if (lang === undefined || !Object.hasOwn(locales, lang))
			lang = config.defaultLang;
	}

	const namespace = page.namespace;
	const locale = locales[lang];

	// Build content
	const contentDefs = await buildDefs(namespace, lang, requestUrl);
	const contentHtml = await buildHtml(templates[namespace], contentDefs, requestUrl);

	// Build shell
	const shellDefs = Object.assign(
		{
			'TITLE': contentDefs['Title'] ? `${contentDefs['Title']} - Flashpoint Archive` : 'Flashpoint Archive',
			'STYLES': page.styles.map(style => `<link rel="stylesheet" href="/styles/${style}">`).join('\n'),
			'SCRIPTS': page.scripts.map(script => `<script src="/scripts/${script}" type="text/javascript"></script>`).join('\n'),
			'LANGUAGE_SELECT': Object.entries(locales).map(([lang, locale]) => `<a class="fp-sidebar-button fp-button fp-alternating" href="?lang=${lang}">${locale.name}</a>`).join('\n'),
			'CURRENT_LANGUAGE': locale.name,
			'CONTENT': contentHtml,
		},
		await buildDefs('shell', lang, requestUrl),
	);
	const shellHtml = await buildHtml(templates.shell, shellDefs);

	// Serve it
	return new Response(shellHtml, { headers: responseHeaders });
};

// Display error page
const serverError = async (error) => {
	const [badRequest, notFound] = [error instanceof BadRequestError, error instanceof NotFoundError];

	// We don't need to translate this
	let errorPage = templates.error;
	if (badRequest || notFound)
		errorPage = await buildHtml(errorPage, {
			'error': `${error.status} ${error.statusText}`,
			'description': badRequest ? 'The requested URL is invalid.' : 'The requested URL does not exist.',
		});
	else {
		logMessage(error.stack);
		errorPage = await buildHtml(errorPage, {
			'error': '500 Internal Server Error',
			'description': 'The server encountered an error while handling the request.',
		});
	}

	return new Response(errorPage, { status: error.status ?? 500, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
};

// Start server on HTTP
if (config.httpPort)
	Deno.serve({
		port: config.httpPort,
		hostname: config.hostName,
		onError: serverError,
	}, serverHandler);

// Start server on HTTPS
if (config.httpsPort && config.httpsCert && config.httpsKey)
	Deno.serve({
		port: config.httpsPort,
		cert: Deno.readTextFileSync(config.httpsCert),
		key: Deno.readTextFileSync(config.httpsKey),
		hostName: config.hostName,
		onError: serverError,
	}, serverHandler);

// Build a list of text definitions to supply to the HTML template
async function buildDefs(namespace, lang, url = null) {
	const defs = lang == config.defaultLang
		? defaultLocale.translations[namespace]
		: Object.assign({}, defaultLocale.translations[namespace], locales[lang].translations[namespace]);
	if (Object.hasOwn(namespaceFunctions, namespace))
		Object.assign(defs, await namespaceFunctions[namespace](defs, fp, url));

	return defs;
}

// Safely fill HTML template with text definitions
function buildHtml(template, defs) {
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
function buildStringFromParams(paramsStr, defs = {}) {
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

// Create a fresh database file
// Adapted from https://github.com/FlashpointProject/FPA-Rust/blob/master/crates/flashpoint-database-builder/src/main.rs
async function buildDatabase() {
	// Remove old database file
	try { Deno.removeSync(config.databaseFile); } catch {}

	// Initialize new database
	const fp = new FlashpointArchive();
	fp.loadDatabase(config.databaseFile);

	// Fetch and apply platforms
	const platsRes = await fetchFromFpfss('platforms');
	logMessage(`applying ${platsRes.length} platforms...`);
	await fp.updateApplyPlatforms(platsRes.map(plat => updateProps(plat)));

	// Fetch and apply tags and tag categories
	const tagsRes = await fetchFromFpfss('tags');
	logMessage(`applying ${tagsRes.categories.length} categories...`);
	await fp.updateApplyCategories(tagsRes.categories);
	logMessage(`applying ${tagsRes.tags.length} tags...`);
	await fp.updateApplyTags(tagsRes.tags.map(tag => updateProps(tag)));

	// Fetch and apply pages of games until there are none left
	let totalAppliedGames = 0;
	let pageNum = 1;
	let afterId;
	while (true) {
		logMessage(`fetching page ${pageNum}...`);
		const gamesRes = await fetchFromFpfss('games?broad=true&after=1970-01-01' + (afterId ? `&afterId=${afterId}` : ''));
		pageNum++;
		if (gamesRes.games.length > 0) {
			totalAppliedGames += gamesRes.games.length;
			afterId = gamesRes.games[gamesRes.games.length - 1].id;
			await fp.updateApplyGames({
				games: gamesRes.games.map(game => updateProps(game)),
				addApps: gamesRes.add_apps.map(addApp => updateProps(addApp)),
				gameData: gamesRes.game_data.map(gameData => updateProps(gameData)),
				tagRelations: gamesRes.tag_relations,
				platformRelations: gamesRes.platform_relations
			}, 'flashpoint-archive');
		}
		else
			break;
	}

	logMessage(`applied ${totalAppliedGames} games`);
}

// Return parsed contents of pages.json
function getPages() {
	return JSON.parse(Deno.readTextFileSync('data/pages.json'));
}

// Return list of namespaces
function getNamespaces(pages) {
	return Object.values(pages).map(page => page.namespace);
}

// Return all available locales and their text definitions
function getLocales(namespaces) {
	const locales = JSON.parse(Deno.readTextFileSync('data/locales.json'));
	for (const lang in locales) {
		const translations = {};
		for (const namespace of namespaces.concat(['shell'])) {
			const translationPath = `locales/${lang}/${namespace}.json`;
			if (getPathInfo(translationPath)?.isFile) {
				translations[namespace] = JSON.parse(Deno.readTextFileSync(translationPath));
				for (const def in translations[namespace])
					translations[namespace][def] = sanitizeInject(translations[namespace][def]);
			}
			else if (config.defaultLang == lang) {
				logMessage(`error: missing translation file ${namespace}.json for default language "${config.defaultLang}"`);
				Deno.exit(1);
			}
		}

		locales[lang].translations = translations;
	}

	return locales;
}

// Return template data
function getTemplates(namespaces) {
	const templates = {};
	for (const namespace of namespaces.concat(['shell', 'error']))
		templates[namespace] = Deno.readTextFileSync(`templates/${namespace}.html`);

	return templates;
}

// Fetch data from an FPFSS endpoint
async function fetchFromFpfss(endpoint) {
	return (await fetch(`${config.fpfssUrl}/api/${endpoint}`)).json();
}

// Change FPFSS properties to camel case to work with FPA library
function updateProps(obj) {
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
function replaceSlices(str, slices) {
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
function sanitizeInject(str) {
	const charMap = {
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
	};
	const charMapExp = new RegExp(`[${Object.keys(charMap).join('')}]`, 'g');
	return str.replace(charMapExp, m => charMap[m]);
}

// Run Deno.lstat without throwing error if path doesn't exist
function getPathInfo(path) {
	try { return Deno.lstatSync(path); } catch {}
	return null;
}

// Log to the appropriate locations
function logMessage(message) {
	message = `[${new Date().toLocaleString()}] ${message}`;
	if (config.logToConsole) console.log(message);
	if (config.logFile) try { Deno.writeTextFile(config.logFile, message + '\n', { append: true }); } catch {}
}

// 400 Bad Request
class BadRequestError extends Error {
	constructor(message) {
		super(message);
		this.name = this.constructor.name;
		this.status = 400;
		this.statusText = 'Bad Request';
	}
}

// 404 Not Found
class NotFoundError extends Error {
	constructor(message) {
		super(message);
		this.name = this.constructor.name;
		this.status = 404;
		this.statusText = 'Not Found';
	}
}