import { FlashpointArchive } from 'npm:@fparchive/flashpoint-archive';
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

	// If request needs to be blocked, return a Bad Request error
	if (blockRequest) throw new utils.BadRequestError();

	// Make sure request is for a valid URL
	const requestUrl = URL.parse(request.url);
	if (requestUrl === null) throw new utils.BadRequestError();

	// If access host is configured, do not allow connections through any other hostname
	if (config.accessHosts.length > 0 && !config.accessHosts.some(host => host == requestUrl.hostname))
		throw new utils.BadRequestError();

	// Initialize headers with caching that varies with the chosen language
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

	// Get path of URL with slashes cleaned up
	const requestPath = '/' + utils.trimSlashes(requestUrl.pathname);

	// Check if the request points to an endpoint
	for (const path in endpoints) {
		const endpoint = endpoints[path];
		if (requestPath == path || (endpoints[path].lenient && requestPath.startsWith(path))) {
			responseHeaders.set('Content-Type', endpoint.type);
			return await namespaceFunctions[endpoint.namespace](requestUrl, responseHeaders, lang);
		}
	}

	// Otherwise, check if the request points to a page
	let page;
	for (const path in pages) {
		if (requestPath == path || (pages[path].lenient && requestPath.startsWith(path)))
			page = pages[path];
	}

	// If the request does not point to an endpoint or page, serve files from static directory
	if (page === undefined) {
		const filePath = 'static' + requestPath;
		if (!utils.getPathInfo(filePath)?.isFile) throw new utils.NotFoundError(requestUrl, lang);

		responseHeaders.set('Content-Type', contentType(filePath.substring(filePath.lastIndexOf('.'))) ?? 'application/octet-stream');
		return new Response(Deno.openSync(filePath).readable, { headers: responseHeaders });
	}

	responseHeaders.set('Content-Type', 'text/html; charset=UTF-8');
	responseHeaders.set('Content-Language', lang);

	// Build content
	const contentDefs = await utils.buildDefs(page.namespace, lang, requestUrl);
	const contentHtml = utils.buildHtml(templates[page.namespace].main, contentDefs, requestUrl);

	// Build shell
	const title = utils.sanitizeInject(contentDefs['Title'] ?? '');
	const author = utils.sanitizeInject(contentDefs['Author'] ?? '');
	const shellDefs = Object.assign(
		{
			'LANGUAGE_CODE': lang,
			'TITLE': title ? title + ' - Flashpoint Archive' : 'Flashpoint Archive',
			'STYLESHEETS': page.styles.map(style => `<link rel="stylesheet" href="/styles/${style}">`).join('\n'),
			'SCRIPTS': page.scripts.map(script => `<script src="/scripts/${script}" type="text/javascript"></script>`).join('\n'),
			'AUTHOR': author || 'BlueMaxima',
			'OG_TITLE': title || 'Flashpoint Archive',
			'OG_URL': request.url,
			'CURRENT_LANGUAGE': locales[lang].name,
			'CONTENT': contentHtml,
		},
		await utils.buildDefs('shell', lang, requestUrl),
	);
	const shellHtml = utils.buildHtml(templates.shell.main, shellDefs);

	// Serve it
	return new Response(shellHtml, { headers: responseHeaders });
};

// Display error page
async function serverError(error) {
	const status = error.status ?? 500;
	const statusText = status + ' ' + (error.statusText ?? 'Internal Server Error');
	const statusDesc = error.statusDesc ?? 'The server encountered an error while handling the request.';

	const responseHeaders = new Headers({ 'Content-Type': 'text/html' });
	let errorHtml = utils.buildHtml(templates.error[error.fancy ? 'fancy' : 'main'], {
		error: statusText,
		description: statusDesc,
	});

	// Render "fancy" errors inside the navigation shell rather than as basic HTML
	if (error.fancy) {
		const lang = error.lang ?? config.defaultLang;
		responseHeaders.set('Content-Type', 'text/html; charset=UTF-8');
		responseHeaders.set('Content-Language', lang);

		errorHtml = utils.buildHtml(templates.shell.main, Object.assign(
			{
				'LANGUAGE_CODE': lang,
				'TITLE': statusText + ' - Flashpoint Archive',
				'STYLESHEETS': '',
				'SCRIPTS': '',
				'AUTHOR': 'BlueMaxima',
				'OG_TITLE': statusText,
				'OG_URL': error.url?.href ?? '',
				'CURRENT_LANGUAGE': locales[lang].name,
				'CONTENT': errorHtml,
			},
			await utils.buildDefs('shell', lang, error.url),
		));
	}

	// Ensure internal errors are logged
	if (status == 500)
		utils.logMessage(error.stack);

	return new Response(errorHtml, { status: status, headers: responseHeaders });
};

// Log when server is started
function serverListen(addr) { utils.logMessage(`server listening at ${addr.hostname} (port ${addr.port})`); }

// (Re)define global variables
function initGlobals() {
	// Try to load config file
	globalThis.config = JSON.parse(Deno.readTextFileSync('data/config_template.json'));
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
	globalThis.newsInfo = JSON.parse(Deno.readTextFileSync('data/news.json'));
	globalThis.searchInfo = JSON.parse(Deno.readTextFileSync(utils.getPathInfo('data/search.json')?.isFile ? 'data/search.json' : 'data/search_template.json'));
	globalThis.searchStats = JSON.parse(Deno.readTextFileSync(utils.getPathInfo('data/stats.json')?.isFile ? 'data/stats.json' : 'data/stats_template.json'));
	globalThis.viewInfo = JSON.parse(Deno.readTextFileSync('data/view.json'));
	globalThis.filteredTags = JSON.parse(Deno.readTextFileSync('data/filter.json'));

	// Other helpful stuff
	globalThis.updateInProgress = false;
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

	// Update the database on a set interval
	if (config.updateFrequency > 0)
		globalThis.updateInterval = setInterval(utils.updateDatabase, config.updateFrequency * 60 * 1000);
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
			onListen: serverListen,
			onError: serverError,
		}, serverHandler);

	// Start server on HTTPS
	if (config.httpsPort && config.httpsCert && config.httpsKey)
		globalThis.httpsServer = Deno.serve({
			port: config.httpsPort,
			cert: Deno.readTextFileSync(config.httpsCert),
			key: Deno.readTextFileSync(config.httpsKey),
			hostName: config.hostName,
			onListen: serverListen,
			onError: serverError,
		}, serverHandler);
}

// Return all available locales and their text definitions
function getLocales() {
	const namespaces = Object.values(pages).map(page => page.namespace);
	const locales = JSON.parse(Deno.readTextFileSync('data/locales.json'));
	for (const lang in locales) {
		const translations = {};
		for (const namespace of namespaces.concat(['shell', 'error'])) {
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

	templates.shell = { main: Deno.readTextFileSync(`templates/shell.html`) };
	templates.error = {
		main: Deno.readTextFileSync('templates/error.html'),
		fancy: Deno.readTextFileSync('templates/error_fancy.html'),
	};

	return templates;
}