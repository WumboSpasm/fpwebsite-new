let entryData, gameZipData;
let zipServerOrigin, legacyServerOrigin;

// Copy of unmodified fetch method
const _fetch = window.fetch;

// Player attributes and initialization methods
const players = [
	{
		source: 'https://unpkg.com/@ruffle-rs/ruffle',
		platforms: [ 'Flash' ],
		extensions: [ '.swf' ],

		// Override with extension if it was compiled within the past 24 hours
		get override() {
			const player = window.RufflePlayer;
			if (player && player.sources.extension) {
				const buildDate = player.sources.extension.version.split('+')[1];
				return Date.now() - new Date(buildDate).getTime() < 86400000;
			}

			return false;
		},

		async initialize() {
			// Intercept fetches and return redirected response
			window.fetch = async (resource, options) => {
				// Get request as URL object
				let resourceUrl = new URL(resource instanceof Request ? resource.url : resource);

				// Fix for some obscure edge case I can't remember the exact details of
				if (resourceUrl.protocol == 'blob:')
					resourceUrl = new URL(resourceUrl.pathname);

				// Don't redirect if the requested URL belongs to the active player or doesn't use HTTP
				if (this.source.startsWith(resourceUrl.origin) || !resourceUrl.protocol.startsWith('http'))
					return await _fetch(resource, options);

				// Get redirected URL and fetch
				const redirectInfo = await redirect(resourceUrl);
				const response = await _fetch(redirectInfo.new, options);

				// Spoof URL to bypass sitelocks
				response.url = redirectInfo.old.href;

				return response;
			};

			// Create player instance
			const player = window.RufflePlayer.newest().createPlayer();
			// Set base URL to directory of launch command
			player.config.base = entryData.launchCommand.substring(0, entryData.launchCommand.lastIndexOf('/') + 1);
			// Allow entries that use ExternalInterface to work
			player.config.allowScriptAccess = true;

			// Add player to page and load
			document.querySelector('.fp-play-player').appendChild(player);
			player.load(entryData.launchCommand);

			// Once loaded, resize player to dimensions of SWF
			player.addEventListener('loadedmetadata', () => {
				if (player.metadata.width > 1 && player.metadata.height > 1) {
					player.style.width  = player.metadata.width  + 'px';
					player.style.height = player.metadata.height + 'px';
				}
			});
		}
	},
	{
		source: 'https://create3000.github.io/code/x_ite/latest/x_ite.min.js',
		platforms: [ 'VRML', 'X3D' ],
		extensions: [ '.wrl', '.wrl.gz', '.x3d' ],

		// There is no actively-developed X_ITE browser extension as of January 2026
		get override() { return false; },

		async initialize() {
			// Create copy of unmodified createElement method
			const _createElement = document.createElement;
			// Intercept calls to createElement and return <img> elements with redirected src attribute
			document.createElement = function(...args) {
				const observer = new MutationObserver(async records => {
					// Only redirect requests that haven't already been redirected yet
					const record = records.find(record => !['blob:', zipServerOrigin, legacyServerOrigin].some(prefix => record.target.src.startsWith(prefix)));
					if (record) record.target.src = (await redirect(new URL(record.target.src))).new;
				});

				// Create the element
				const element = _createElement.apply(this, args);
				// If created element is an <img> element, observe changes to src attribute
				if (element.tagName == 'IMG')
					observer.observe(element, { attributes: true, attributeFilter: ['src'] });

				return element;
			};

			// Create player instance
			const player = X3D.createBrowser();
			// There's no way to identify the intended dimensions of a VRML/X3D file, so always resize to 900x600
			player.style.width = '900px';
			player.style.height = '600px';
			// Set base URL to directory of launch command
			player.browser.baseURL = entryData.launchCommand.substring(0, entryData.launchCommand.lastIndexOf('/') + 1);

			// Add player to DOM and load
			document.querySelector('.fp-play-player').appendChild(player);
			player.browser.loadURL(new X3D.MFString((await redirect(new URL(entryData.launchCommand))).new));
		}
	}
];

// Take a request and return a redirected URL (and the old one too)
async function redirect(request) {
	// The requested URL, adjusted to use the launch command as the base if necessary
	const oldUrl = (() => {
		const isRelative = [location.origin, zipServerOrigin, legacyServerOrigin].some(origin => origin == request.origin);
		return isRelative ? new URL(request.pathname.substring(1), entryData.launchCommand) : request;
	})();

	// The actual URL from which the requested file will be retrieved
	const newUrl = await (async () => {
		// If the entry is zipped and the requested file exists inside of the zip, return a blob URL of the file
		if (gameZipData) {
			const requestPathLower = decodeURIComponent('content/' + oldUrl.hostname + oldUrl.pathname).toLowerCase();
			for (const path in gameZipData.files) {
				if (path.toLowerCase() != requestPathLower)
					continue;

				const file = gameZipData.files[path];
				if (file && !file.dir)
					return URL.createObjectURL(await file.async('blob'));
			}
		}

		// If entry is not zipped and/or the requested file does not exist inside of the zip, return URL on the legacy file server
		return entryData.legacyServer + '/' + oldUrl.hostname + oldUrl.pathname;
	})();

	return { old: oldUrl, new: newUrl };
};

// Fetch a script and return a promise that resolves when it is loaded
async function loadScript(url) {
	const script = document.createElement('script');
	const scriptLoad = new Promise(resolve => script.addEventListener('load', resolve));
	script.src = url;
	document.head.appendChild(script);

	return scriptLoad;
}

// Start the player
async function initPlayer() {
	// Retrieve entry information from the player element
	entryData = document.querySelector('.fp-play-player').dataset;
	legacyServerOrigin = new URL(entryData.legacyServer).origin;

	if (entryData.gameZip != '') {
		zipServerOrigin = new URL(entryData.gameZip).origin;

		// Fetch zip and load JSZip script to interpret it
		const [gameZip] = await Promise.all([
			fetch(entryData.gameZip),
			loadScript('/scripts/libs/jszip.min.js')
		]);

		// Open zip through JSZip
		gameZipData = await new JSZip().loadAsync(await gameZip.blob());
	}
	else
		zipServerOrigin = '';

	// Identify appropriate player based on launch command
	const launchPathLower = new URL(entryData.launchCommand).pathname.toLowerCase();
	const player = players.find(player => player.extensions.some(ext => launchPathLower.endsWith(ext)));

	if (player) {
		// Load player script if needed
		if (!player.override)
			await loadScript(player.source);

		// Add player to page and activate redirector
		player.initialize();
	}
}

document.addEventListener('DOMContentLoaded', initPlayer);