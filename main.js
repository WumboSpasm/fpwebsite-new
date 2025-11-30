import { FlashpointArchive } from 'npm:@fparchive/flashpoint-archive';
import { parseArgs } from 'jsr:@std/cli@1.0.23/parse-args';
import { contentType } from 'jsr:@std/media-types@1.1.0';
import { setCookie, getCookies } from 'jsr:@std/http@1.0.21/cookie';

import { templateFunctions } from './tempfuncs.js';

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

// Build a fresh database if --build flag is passed
// Adapted from https://github.com/FlashpointProject/FPA-Rust/blob/master/crates/flashpoint-database-builder/src/main.rs
if (flags['build']) {
	const fetchFromFpfss = async endpoint => (await fetch(`${config.fpfssUrl}/api/${endpoint}`)).json();
	const updateProps = obj => {
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

	try { Deno.removeSync(config.databaseFile); } catch {}

	const fp = new FlashpointArchive();
	fp.loadDatabase(config.databaseFile);

	const platsRes = await fetchFromFpfss('platforms');
	logMessage(`applying ${platsRes.length} platforms...`);
	await fp.updateApplyPlatforms(platsRes.map(plat => updateProps(plat)));

	const tagsRes = await fetchFromFpfss('tags');
	logMessage(`applying ${tagsRes.categories.length} categories...`);
	await fp.updateApplyCategories(tagsRes.categories);
	logMessage(`applying ${tagsRes.tags.length} tags...`);
	await fp.updateApplyTags(tagsRes.tags.map(tag => updateProps(tag)));

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
	Deno.exit(0);
}

const pages = getPages();
const namespaces = getNamespaces(pages);
const locales = getLocales(namespaces);
const templates = getTemplates(namespaces);

// Handle requests
const serverHandler = (request, info) => {
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
	const defaultLocale = locales[config.defaultLang];
	const translation = Object.assign({}, defaultLocale.translations[namespace], locale.translations[namespace]);

	// Build the page content and shell, injecting the former inside the latter
	const html = buildHtml(
		templates.shell,
		Object.assign(
			{
				'TITLE': translation['Title'] ? `${translation['Title']} - Flashpoint Archive` : 'Flashpoint Archive',
				'STYLES': page.styles.map(style => `<link rel="stylesheet" href="/styles/${style}">`).join('\n'),
				'SCRIPTS': page.scripts.map(script => `<script src="/scripts/${script}" type="text/javascript"></script>`).join('\n'),
				'LANGUAGE_SELECT': Object.entries(locales).map(([lang, locale]) => `<a class="fp-sidebar-button fp-button fp-alternating" href="?lang=${lang}">${locale.name}</a>`).join('\n'),
				'CURRENT_LANGUAGE': locale.name,
				'CONTENT': buildHtml(templates[namespace], translation),
			},
			Object.assign({}, defaultLocale.translations.shell, locale.translations.shell),
		),
	);

	// Serve it
	return new Response(html, { headers: responseHeaders });
};

// Display error page
const serverError = (error) => {
	const [badRequest, notFound] = [error instanceof BadRequestError, error instanceof NotFoundError];

	// We don't need to translate this
	let errorPage = templates.error;
	if (badRequest || notFound)
		errorPage = buildHtml(errorPage, {
			'error': `${error.status} ${error.statusText}`,
			'description': badRequest ? 'The requested URL is invalid.' : 'The requested URL does not exist.',
		});
	else {
		logMessage(error.stack);
		errorPage = buildHtml(errorPage, {
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
				// Let's just get this over with
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

// Safely fill HTML template with text definitions
function buildHtml(template, defs) {
	const varData = [];
	const varExp = /(?:(^|\n)(\t*))?\{(.*?)\}/gs;
	for (let match; (match = varExp.exec(template)) !== null;) {
		const value = buildStringFromParams(match[3], defs);
		const newLine = match[1] ?? '';
		const tabs = match[2] ?? '';
		const formattedValue = value ? newLine + value.replaceAll(/^/gm, tabs) : '';
		varData.push({
			value: formattedValue,
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	let offset = 0;
	let html = '';
	for (const entry of varData.toSorted((a, b) => a.start - b.start)) {
		html += template.substring(0, entry.start - offset) + entry.value;
		template = template.substring(entry.end - offset);
		offset = entry.end;
	}
	return html + template;
}

// Interpret a sequence of parameters and construct a string
function buildStringFromParams(paramsStr, defs = {}) {
	const paramBounds = {
		string:   ['"', '"'],
		function: ['(', ')'],
		element:  ['<', '>'],
	};
	const delim = ',';
	const fallbackStr = 'null';

	// Don't waste any time if the first parameter is obviously invalid
	if (paramsStr == '' || paramsStr.startsWith(delim))
		return fallbackStr;

	// First, do a simple split
	const rawParams = paramsStr.split(delim);

	// Then put back together any parameters containing the delimiter character inline
	const paramsToCombine = [];
	for (let i = 0; i < rawParams.length - 1; i++) {
		const rawParam = rawParams[i];
		const nextRawParam = rawParams[i + 1];
		for (const type in paramBounds) {
			const typeStart = paramBounds[type][0];
			const typeEnd = paramBounds[type][1];
			if (rawParam.startsWith(typeStart) && !rawParam.endsWith(typeEnd)
			 && !nextRawParam.startsWith(typeStart) && nextRawParam.endsWith(typeEnd))
				paramsToCombine.push(i);
		}
	}
	for (let j = 0; j < paramsToCombine.length; j++) {
		const i = paramsToCombine[j];
		rawParams.splice(i, 2, rawParams[i] + delim + rawParams[i + 1]);
	}

	// Now that the parameters are properly split, identify their types and check if they're valid
	// Also identify the string that the parameters will be applied to (if necessary)
	const params = [];
	let targetStr = '';
	for (let i = 0; i < rawParams.length; i++) {
		const rawParam = rawParams[i];
		let param = { type: 'invalid', value: '' };

		for (const type in paramBounds) {
			const typeStart = paramBounds[type][0];
			const typeEnd = paramBounds[type][1];
			if (rawParam.startsWith(typeStart) && rawParam.endsWith(typeEnd) && (i > 0 || type == 'function')) {
				const value = rawParam.substring(typeStart.length, rawParam.length - typeEnd.length);
				if (type == 'function' && !Object.hasOwn(templateFunctions, value)) continue;
				if (type == 'element' && !/^[^\s]+/.test(value)) continue;
				param = {
					type: type,
					value: rawParam.substring(typeStart.length, rawParam.length - typeEnd.length),
				};
			}
		}

		if (i == 0 && param.type == 'invalid') {
			if (Object.hasOwn(defs, rawParam)) {
				param = { type: 'definition', value: rawParam };
				targetStr = defs[rawParam];
			}
			else
				return fallbackStr;
		}

		params.push(param);
	}

	// Now we are ready to apply the parameters to the string
	if (params[0].type == 'definition' && params.length > 1) {
		const tagPartsExp = /^([^\s]+)(.*)$/;

		// Handle regular variables before function variables, in case any of the former exist inside the latter
		targetStr = targetStr.replace(/\$(\d+)(?!\{)/g, (_, i) => {
			i = parseInt(i, 10);
			if (i < params.length) {
				const param = params[i];
				if (param.type == 'string') return param.value;
				if (param.type == 'function') return templateFunctions[param.value]();
				if (param.type == 'element') {
					const tagParts = param.value.match(tagPartsExp);
					if (tagParts) {
						const [_, name, attrs] = tagParts;
						return `<${name}${attrs}>`;
					}
				}
			}
			return fallbackStr;
		});

		// Now for the function variables
		targetStr = targetStr.replace(/\$(\d+)\{(.*?)\}/g, (_, i, input) => {
			i = parseInt(i, 10);
			if (i < params.length) {
				const param = params[i];
				if (param.type == 'string') return param.value;
				if (param.type == 'function') return templateFunctions[param.value](input);
				if (param.type == 'element') {
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
			}
			return fallbackStr;
		});
	}
	// If the first parameter is a function, execute that and be done
	else if (params[0].type == 'function')
		targetStr = templateFunctions[params[0].value]();

	return targetStr;
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