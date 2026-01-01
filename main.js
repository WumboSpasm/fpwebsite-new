import { FlashpointArchive, newSubfilter } from 'npm:@fparchive/flashpoint-archive';
import { parseArgs } from 'jsr:@std/cli@1.0.23/parse-args';
import { contentType } from 'jsr:@std/media-types@1.1.0';
import { setCookie, getCookies } from 'jsr:@std/http@1.0.21/cookie';

import * as utils from './utils.js';
import { namespaceFunctions } from './nsfuncs.js';

// Command-line flags
const flags = parseArgs(Deno.args, {
	boolean: ['update'],
	string: ['config'],
	default: { 'update': false, 'config': 'config.json' },
});

// Default config
const defaultConfig = {
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
	imageUrl: 'https://infinity.unstable.life/images',
	pageSize: 100,
	updateFrequency: 1440, // 24 hours
	defaultLang: 'en-US',
};

// Initialize stuff
initGlobals();
await initDatabase();
initServer();

// Handle requests
async function serverHandler(request, info) {
	const ipAddress = info.remoteAddr.hostname;
	const userAgent = request.headers.get('User-Agent') ?? '';

	// Check if IP or user agent is in blocklist
	const blockRequest =
		config.blockedIPs.some(blockedIP => ipAddress.startsWith(blockedIP)) ||
		config.blockedUAs.some(blockedUA => userAgent.includes(blockedUA));

	// Log the request if desired
	if (!blockRequest || config.logBlockedRequests)
		utils.logMessage(`${blockRequest ? 'BLOCKED ' : ''}${ipAddress} (${userAgent}): ${request.url}`);

	// If request needs to be blocked, return a Not Found error
	if (blockRequest) throw new utils.NotFoundError();

	// Make sure request is for a valid URL
	const requestUrl = URL.parse(request.url);
	if (requestUrl === null) throw new utils.BadRequestError();

	// If access host is configured, do not allow connections through any other hostname
	if (config.accessHosts.length > 0 && !config.accessHosts.some(host => host == requestUrl.hostname))
		throw new utils.BadRequestError();

	const requestPath = requestUrl.pathname.replace(/^[/]+(.*?)[/]*$/, '$1');
	const responseHeaders = new Headers({
		'Cache-Control': 'max-age=14400',
		'Vary': 'Cookie',
	});

	// Get the desired language and set cookie if needed
	let lang = requestUrl.searchParams.get('lang');
	if (lang !== null && Object.hasOwn(locales, lang))
		setCookie(responseHeaders, { name: 'lang', value: lang });
	else {
		lang = getCookies(request.headers).lang;
		if (lang === undefined || !Object.hasOwn(locales, lang))
			lang = config.defaultLang;
	}

	// Check if the request points to an endpoint
	const endpoint = endpoints[`/${requestPath}`];
	if (endpoint !== undefined) {
		responseHeaders.set('Content-Type', endpoint.type);
		return new Response(await namespaceFunctions[endpoint.namespace](requestUrl, lang), { headers: responseHeaders });
	}

	// Otherwise, check if the request points to a page; if not, serve from static directory
	const page = pages[`/${requestPath}`];
	if (page === undefined) {
		const filePath = `static/${requestPath}`;
		if (!utils.getPathInfo(filePath)?.isFile) throw new utils.NotFoundError();
		responseHeaders.set('Content-Type', contentType(filePath.substring(filePath.lastIndexOf('.'))) ?? 'application/octet-stream');

		return new Response(Deno.openSync(filePath).readable, { headers: responseHeaders });
	}

	responseHeaders.set('Content-Type', 'text/html; charset=UTF-8');

	const namespace = page.namespace;
	const locale = locales[lang];

	// Build content
	const contentDefs = await utils.buildDefs(namespace, lang, requestUrl);
	const contentHtml = await utils.buildHtml(templates[namespace].main, contentDefs, requestUrl);

	// Build shell
	const shellDefs = Object.assign(
		{
			'TITLE': contentDefs['Title'] ? `${contentDefs['Title']} - Flashpoint Archive` : 'Flashpoint Archive',
			'STYLES': page.styles.map(style => `<link rel="stylesheet" href="/styles/${style}">`).join('\n'),
			'SCRIPTS': page.scripts.map(script => `<script src="/scripts/${script}" type="text/javascript"></script>`).join('\n'),
			'CURRENT_LANGUAGE': locale.name,
			'CONTENT': contentHtml,
		},
		await utils.buildDefs('shell', lang, requestUrl),
	);
	const shellHtml = await utils.buildHtml(templates.shell.main, shellDefs);

	// Serve it
	return new Response(shellHtml, { headers: responseHeaders });
};

// Display error page
async function serverError(error) {
	const [badRequest, notFound] = [error instanceof utils.BadRequestError, error instanceof utils.NotFoundError];

	// We don't need to translate this
	let errorPage = templates.error.main;
	if (badRequest || notFound)
		errorPage = await utils.buildHtml(errorPage, {
			'error': `${error.status} ${error.statusText}`,
			'description': badRequest ? 'The requested URL is invalid.' : 'The requested URL does not exist.',
		});
	else {
		utils.logMessage(error.stack);
		errorPage = await utils.buildHtml(errorPage, {
			'error': '500 Internal Server Error',
			'description': 'The server encountered an error while handling the request.',
		});
	}

	return new Response(errorPage, { status: error.status ?? 500, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
};

// (Re)define global variables
function initGlobals() {
	// Try to load config file
	globalThis.config = Object.assign({}, defaultConfig);
	const configPath = flags['config'];
	if (utils.getPathInfo(configPath)?.isFile) {
		Object.assign(config, JSON.parse(Deno.readTextFileSync(configPath)));
		utils.logMessage(`loaded config file: ${Deno.realPathSync(configPath)}`);
	}
	else
		utils.logMessage('no config file found, using default config');

	// Data structures
	globalThis.pages = JSON.parse(Deno.readTextFileSync('data/pages.json'));
	globalThis.endpoints = JSON.parse(Deno.readTextFileSync('data/endpoints.json'));
	globalThis.locales = getLocales();
	globalThis.templates = getTemplates();
	globalThis.filteredTags = JSON.parse(Deno.readTextFileSync('data/filter.json'));
	globalThis.searchInfo = JSON.parse(Deno.readTextFileSync('data/search.json'));
	globalThis.searchStats = JSON.parse(Deno.readTextFileSync('data/stats.json'));
	globalThis.viewInfo = JSON.parse(Deno.readTextFileSync('data/view.json'));

	// Other helpful stuff
	globalThis.lastUpdatedPath = 'data/lastUpdated.txt';
	globalThis.tagStatsLimit = 100;
}

// Load/update/build Flashpoint database
async function initDatabase() {
	if (globalThis.fp === undefined) {
		if (flags['update']) {
			// Update and exit if --update flag is passed
			await utils.updateDatabase();
			Deno.exit(0);
		}
		else if (!utils.getPathInfo(config.databaseFile)?.isFile) {
			// If database doesn't exist, initiate database build alongside server
			utils.logMessage('no database found, starting database build');
			utils.updateDatabase();
		}

		// Load the database
		globalThis.fp = new FlashpointArchive();
		fp.loadDatabase(config.databaseFile);
	}
	else if (globalThis.updateInterval !== undefined)
		clearInterval(updateInterval);

	await initSearchInfo();
	await initSearchStats();
	globalThis.updateInProgress = false;

	// Update the database on a set interval
	if (config.updateFrequency > 0)
		globalThis.updateInterval = setInterval(async () => {
			if (updateInProgress) return;
			updateInProgress = true;
			await utils.updateDatabase();
			await initSearchInfo();
			await initSearchStats();
			updateInProgress = false;
		}, config.updateFrequency * 60 * 1000);
}

// Insert dynamic data into search info
async function initSearchInfo() {
	/*
	searchInfo.value.tags = {};
	for (const tag of await fp.findAllTags())
		searchInfo.value.tags[tag.name] = tag.name;
	*/
	searchInfo.value.platforms = {};
	for (const platform of await fp.findAllPlatforms())
		searchInfo.value.platforms[platform.name] = platform.name;
}

// Gather database statistics for search homepage
async function initSearchStats() {
	const search = fp.parseUserSearchInput('').search;
	const searchFilter = newSubfilter();
	search.filter.subfilters.push(searchFilter);

	// Total games
	searchFilter.exactWhitelist.library = ['arcade'];
	searchStats.games = await fp.searchGamesTotal(search);

	// Total animations
	searchFilter.exactWhitelist.library = ['theatre'];
	searchStats.animations = await fp.searchGamesTotal(search);

	// Total GameZIP entries
	searchFilter.exactWhitelist.library = undefined;
	searchFilter.higherThan.gameData = 0;
	searchStats.gameZip = await fp.searchGamesTotal(search);

	// Total Legacy entries
	searchFilter.higherThan.gameData = undefined;
	searchFilter.equalTo.gameData = 0;
	searchStats.legacy = await fp.searchGamesTotal(search);

	// Totals for each platform
	searchFilter.equalTo.gameData = undefined;
	const platformTotals = [];
	for (const platform of await fp.findAllPlatforms()) {
		searchFilter.exactWhitelist.platforms = [platform.name];
		platformTotals.push([platform.name, await fp.searchGamesTotal(search)]);
	}
	searchStats.platforms = platformTotals.toSorted((a, b) => b[1] - a[1]);

	// Totals for each tag (capped at tagStatsLimit)
	searchFilter.exactWhitelist.platforms = undefined;
	const tagTotals = [];
	for (const tag of await fp.findAllTags()) {
		if (filteredTags.extreme.includes(tag.name) || filteredTags.stats.includes(tag.name)) continue;
		searchFilter.exactWhitelist.tags = [tag.name];
		tagTotals.push([tag.name, await fp.searchGamesTotal(search)]);
	}
	searchStats.tags = tagTotals.toSorted((a, b) => b[1] - a[1]).slice(0, tagStatsLimit);

	// Last updated
	if (utils.getPathInfo(lastUpdatedPath)?.isFile) {
		const lastUpdated = Deno.readTextFileSync(lastUpdatedPath);
		if (!isNaN(Date.parse(lastUpdated)))
			searchStats.lastUpdated = lastUpdated;
	}
}

// (Re)start the web server
async function initServer() {
	// Shut down servers if running
	if (globalThis.httpServer !== undefined)
		await httpServer.shutdown();
	if (globalThis.httpsServer !== undefined)
		await httpsServer.shutdown();

	// Start server on HTTP
	if (config.httpPort)
		globalThis.httpServer = Deno.serve({
			port: config.httpPort,
			hostname: config.hostName,
			onError: serverError,
		}, serverHandler);

	// Start server on HTTPS
	if (config.httpsPort && config.httpsCert && config.httpsKey)
		globalThis.httpsServer = Deno.serve({
			port: config.httpsPort,
			cert: Deno.readTextFileSync(config.httpsCert),
			key: Deno.readTextFileSync(config.httpsKey),
			hostName: config.hostName,
			onError: serverError,
		}, serverHandler);
}

// Return all available locales and their text definitions
function getLocales() {
	const namespaces = Object.values(pages).map(page => page.namespace);
	const locales = JSON.parse(Deno.readTextFileSync('data/locales.json'));
	for (const lang in locales) {
		const translations = {};
		for (const namespace of namespaces.concat(['shell'])) {
			const translationPath = `locales/${lang}/${namespace}.json`;
			if (utils.getPathInfo(translationPath)?.isFile) {
				translations[namespace] = JSON.parse(Deno.readTextFileSync(translationPath));
				for (const def in translations[namespace])
					translations[namespace][def] = utils.sanitizeInject(translations[namespace][def]);
			}
			else if (config.defaultLang == lang) {
				utils.logMessage(`error: missing translation file ${namespace}.json for default language "${config.defaultLang}"`);
				Deno.exit(1);
			}
		}

		locales[lang].translations = translations;
	}

	return locales;
}

// Return template data
function getTemplates() {
	const templates = {};
	for (const path in pages) {
		const namespace = pages[path].namespace;
		const template = { main: Deno.readTextFileSync(`templates/${namespace}.html`) };
		for (const fragment of pages[path].fragments)
			template[fragment] = Deno.readTextFileSync(`templates/${namespace}_${fragment}.html`);

		templates[namespace] = template;
	}
	for (const fakeNamespace of ['shell', 'error'])
		templates[fakeNamespace] = { main: Deno.readTextFileSync(`templates/${fakeNamespace}.html`) };

	return templates;
}