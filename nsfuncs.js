import { format } from 'jsr:@std/fmt@1.0.8/bytes';
import { GameSearchSortable, GameSearchDirection, newSubfilter } from 'npm:@fparchive/flashpoint-archive';

import * as utils from './utils.js';

const idExp = /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/;

export const namespaceFunctions = {
	'shell': (url) => {
		// Prepare language select
		const langButtons = [];
		for (const lang in locales) {
			const langUrl = new URL(url);
			langUrl.searchParams.set('lang', lang);
			langButtons.push(`<a class="fp-shell-sidebar-button fp-shell-button fp-shell-alternating" href="${langUrl.search}">${locales[lang].name}</a>`);
		}

		return { 'LANGUAGE_SELECT': langButtons.join('\n'), };
	},
	'search': async (url, lang, defs) => {
		const params = url.searchParams;
		const newDefs = Object.assign({}, defs, {
			ascSelected: params.get('dir') == 'asc' ? ' selected' : '',
			descSelected: params.get('dir') == 'desc' ? ' selected' : '',
			nsfwChecked: params.get('nsfw') == 'true' ? ' checked' : '',
			anyChecked: params.get('any') == 'true' ? ' checked' : '',
			resultsPerPage: config.pageSize.toLocaleString(lang),
		});

		// Populate "sort by" dropdown
		const sortFields = [];
		for (const field in searchInfo.sort) {
			const selected = params.get('sort') == field ? ' selected' : '';
			sortFields.push(`<option value="${field}"${selected}>${searchInfo.sort[field]}</option>`);
		}
		newDefs.sortFields = sortFields.join('\n');

		let searchInterface, searchFilter, invalid = false;
		if (params.get('advanced') == 'true') {
			// Parse Advanced Mode query string
			const fields = params.getAll('field');
			const filters = params.getAll('filter');
			const values = params.getAll('value');
			if (fields.length > 0 && fields.length == filters.length && filters.length == values.length) {
				// Initialize database search filter object
				searchFilter = newSubfilter();
				for (let i = 0; i < fields.length; i++) {
					const field = fields[i];
					const filter = filters[i];
					const value = values[i];
					// Invalidate query if any field or filter definition is blank
					// Blank value definitions can be useful however, and are considered valid
					if (field == '' || filter == '') {
						invalid = true;
						break;
					}

					// Populate search filter by comparing query parameters to search.json definitions
					let success = false;
					for (const type in searchInfo.field) {
						if (!Object.hasOwn(searchInfo.field[type], field)
						 || !Object.hasOwn(searchInfo.filter[type], filter)
						 || (type == 'string' && Object.hasOwn(searchInfo.value, field) && !Object.hasOwn(searchInfo.value[field], value)))
							continue;

						if (type == 'string')
							searchFilter[filter][field] = (searchFilter[filter][field] ?? []).concat(value);
						else if (type == 'date')
							searchFilter[filter][field] = value;
						else if (type == 'number') {
							const parsedValue = parseInt(value, 10);
							if (!isNaN(parsedValue) && parsedValue >= 0)
								searchFilter[filter][field] = parsedValue;
							else {
								invalid = true;
								break;
							}
						}

						success = true;
						break;
					}

					// Invalidate query if any parameter is invalid
					if (!success) {
						invalid = true;
						break;
					}
				}

				// Enable Match Any if desired
				if (params.get('any') == 'true')
					searchFilter.matchAny = true;
			}
			else if (fields.length > 0 || filters.length > 0 || values.length > 0)
				invalid = true;

			// Build Advanced Mode search interface HTML
			searchInterface = utils.buildHtml(templates['search'].advanced, newDefs);
		}
		else {
			// Parse Simple Mode query string
			const searchQuery = params.get('query');
			if (searchQuery !== null)
				searchFilter = fp.parseUserSearchInput(searchQuery).search.filter;

			// Build Simple Mode search interface HTML
			newDefs.searchQuery = utils.sanitizeInject(searchQuery ?? '');
			searchInterface = utils.buildHtml(templates['search'].simple, newDefs);
		}

		let searchContent = '';
		if (invalid)
			// If search query is invalid, don't attempt to search
			searchContent = utils.buildHtml(templates['search'].navigation, Object.assign(newDefs, {
				totalResults: '0',
				resultsPerPageHidden: ' hidden',
				searchResults: '',
				topPageButtons: '',
				bottomPageButtons: '',
			}));
		else if (searchFilter !== undefined) {
			// Initialize database search query object
			const search = fp.parseUserSearchInput('').search;
			search.limit = config.pageSize;

			// If NSFW filter needs to be active, add a subfilter containing extreme tags
			if (params.get('nsfw') != 'true') {
				const tagsSubfilter = newSubfilter();
				tagsSubfilter.exactBlacklist.tags = filteredTags.extreme;
				tagsSubfilter.matchAny = true;

				search.filter.subfilters.push(tagsSubfilter);
			}

			// Apply sort column and direction
			const sortField = params.get('sort');
			if (Object.hasOwn(searchInfo.sort, sortField)) {
				search.order.column = GameSearchSortable[sortField.toUpperCase()];
				search.order.direction = GameSearchDirection[params.get('dir') == 'desc' ? 'DESC' : 'ASC'];
			}

			// Add search filter to query as a subfilter
			search.filter.subfilters.push(searchFilter);

			// Get search result total and page offsets
			// We perform the actual search once the offset is applied to the query
			const [totalResults, searchIndex] = await Promise.all([fp.searchGamesTotal(search), fp.searchGamesIndex(search)]);
			const totalPages = searchIndex.length > 0 ? searchIndex.length + 1 : 1;
			const currentPage = Math.max(1, Math.min(totalPages, parseInt(params.get('page'), 10) || 1));
			const currentPageIndex = currentPage - 2;
			let pageButtons = '';
			if (totalPages > 1) {
				// Apply offset based on current page
				if (currentPage > 1) {
					const offset = searchIndex[currentPageIndex];
					search.offset = {
						value: offset.orderVal,
						title: offset.title,
						gameId: offset.id,
					};
				}

				// Get URLs for page navigation buttons
				const nthPageUrl = new URL(url);
				nthPageUrl.searchParams.set('page', 1);
				const firstPageUrl = nthPageUrl.search;
				nthPageUrl.searchParams.set('page', Math.max(currentPage - 1, 1));
				const prevPageUrl = nthPageUrl.search;
				nthPageUrl.searchParams.set('page', Math.min(currentPage + 1, totalPages));
				const nextPageUrl = nthPageUrl.search;
				nthPageUrl.searchParams.set('page', totalPages);
				const lastPageUrl = nthPageUrl.search;

				// Build HTML for page navigation buttons
				pageButtons = utils.buildHtml(templates['search'].pagebuttons, Object.assign(newDefs, {
					currentPage: currentPage.toLocaleString(lang),
					totalPages: totalPages.toLocaleString(lang),
					firstPageUrl: firstPageUrl,
					prevPageUrl: prevPageUrl,
					nextPageUrl: nextPageUrl,
					lastPageUrl: lastPageUrl,
				}));
			}

			// Get search results and turn into HTML
			const searchResults = await fp.searchGames(search);
			const searchResultsArr = [];
			for (const searchResult of searchResults) {
				// Display developer/publisher as creator if either exist
				let resultCreator = searchResult.developer || searchResult.publisher;
				if (resultCreator != '')
					resultCreator = `by ${resultCreator}`;

				// Build search result HTML
				searchResultsArr.push(utils.buildHtml(templates['search'].result, {
					resultId: searchResult.id,
					resultLogo: `${config.imageServer}/${searchResult.logoPath}?type=jpg`,
					resultTitle: utils.sanitizeInject(searchResult.title),
					resultCreator: utils.sanitizeInject(resultCreator),
					resultPlatform: searchResult.platforms.join('/'),
					resultLibrary: searchResult.library == 'arcade' ? 'game' : 'animation',
					resultTags: utils.sanitizeInject(searchResult.tags.join(' - ')),
				}));
			}

			// Build search content HTML
			searchContent = utils.buildHtml(templates['search'].navigation, Object.assign(newDefs, {
				totalResults: totalResults.toLocaleString(lang),
				resultsPerPageHidden: totalPages == 1 ? ' hidden' : '',
				searchResults: searchResultsArr.join('\n'),
				topPageButtons: pageButtons,
				bottomPageButtons: searchResults.length > 20 ? pageButtons : '',
			}));
		}
		else
			// If there is no active search, display statistics in place of search results
			searchContent = utils.buildHtml(templates['search'].stats, Object.assign(newDefs,  {
				totalGames: searchStats.games.toLocaleString(lang),
				totalAnimations: searchStats.animations.toLocaleString(lang),
				totalGameZip: searchStats.gameZip.toLocaleString(lang),
				totalLegacy: searchStats.legacy.toLocaleString(lang),
				platformTotals: searchStats.platforms.map(([platform, total]) => utils.buildHtml(templates['view'].row, {
					field: platform,
					value: total.toLocaleString(lang),
				})).join('\n'),
				tagTotals: searchStats.tags.map(([tag, total]) => utils.buildHtml(templates['view'].row, {
					field: utils.sanitizeInject(tag),
					value: total.toLocaleString(lang),
				})).join('\n'),
				totalTags: tagStatsLimit.toLocaleString(lang),
			}));

		// Display time of last update in header
		const lastUpdate = new Intl.DateTimeFormat(lang, {
			dateStyle: 'long',
			timeStyle: 'long',
			timeZone: 'UTC',
			hour12: false,
		}).format(new Date(searchStats.lastUpdated));

		return {
			lastUpdate: lastUpdate,
			searchInterface: searchInterface,
			searchContent: searchContent,
		};
	},
	'view': async (url, _, defs) => {
		// Check if an ID has been supplied and if it is properly formatted
		const id = url.searchParams.get('id');
		if (id === null || !idExp.test(id))
			throw new utils.BadRequestError();

		// Fetch the entry, or display an error if it doesn't exist
		const entry = await fp.findGame(id);
		if (entry === null)
			throw new utils.NotFoundError();

		// Function to build table HTML given a set of data and field definitions
		const buildTable = (source, fields) => {
			const tableRowsArr = [];
			for (const field in fields) {
				const rawValue = source[field];
				// If value doesn't exist or is empty or blank, skip it
				if (rawValue === undefined || rawValue.length === 0)
					continue;

				const fieldInfo = fields[field];
				let value;
				switch (fieldInfo.type) {
					case 'string': {
						// Sanitize value or use real name if defined
						if (Object.hasOwn(fieldInfo, 'values') && Object.hasOwn(fieldInfo.values, rawValue))
							value = fieldInfo.values[rawValue].name;
						else
							value = utils.sanitizeInject(rawValue);
						break;
					}
					case 'list': {
						// Parse and sanitize list in respect to whether it is an array or a semicolon-delimited string
						let valueList = rawValue instanceof Array
							? rawValue.map(listValue => utils.sanitizeInject(listValue))
							: rawValue.split(';').map(listValue => utils.sanitizeInject(listValue.trim()));
						if (field == 'platforms')
							// Remove primary platform from Other Technologies list
							valueList = valueList.filter(listValue => listValue != entry.primaryPlatform);
						else if (field == 'language') {
							// Display real names of languages instead of their language codes
							const displayNames = new Intl.DisplayNames([config.defaultLang], { type: 'language' });
							valueList = valueList.map(listValue => {
								try { return displayNames.of(listValue); }
								catch { return listValue; }
							});
						}

						if (valueList.length > 0)
							// Render as a bulleted list if there are multiple values
							// Otherwise, render as a normal string
							value = valueList.length == 1
								? valueList[0]
								: `<ul>${valueList.map(listValue => `<li>${listValue}</li>`).join('')}</ul>`;
						break;
					}
					case 'date': {
						// Parse date into formatted string
						const parsedValue = new Date(rawValue);
						if (!isNaN(parsedValue)) {
							if (rawValue.length == 4)
								value = `${parsedValue.getUTCFullYear()}`;
							else if (rawValue.length == 7)
								value = `${parsedValue.getUTCMonth() + 1}/${parsedValue.getUTCFullYear()}`;
							else if (rawValue.length == 10)
								value = parsedValue.toLocaleDateString(config.defaultLang, { timeZone: 'UTC' });
							else
								value = parsedValue.toLocaleString(config.defaultLang, { timeZone: 'UTC' });
						}
						break;
					}
					case 'size': {
						// Format bytes into human-readable string
						if (typeof(rawValue) == 'number')
							value = format(rawValue, { locale: config.defaultLang });
						break;
					}
					case 'number': {
						// Parse number into comma-separated string
						const parsedValue = parseInt(rawValue, 10);
						if (!isNaN(parsedValue))
							value = parsedValue.toLocaleString(config.defaultLang);
						break;
					}
				}

				// If value was able to be parsed, build HTML for its respective table row
				if (value !== undefined)
					tableRowsArr.push(utils.buildHtml(templates['view'].row, {
						field: fieldInfo.name + ':',
						value: value.replaceAll('\n', '<br>'),
					}));
			}

			// Build and return table HTML
			return utils.buildHtml(templates['view'].table, { tableRows: tableRowsArr.join('\n') });
		};

		// Build entry viewer HTML
		const title = utils.sanitizeInject(entry.title);
		const newDefs = Object.assign({}, defs);
		const sortedGameData = entry.gameData.toSorted((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
		return {
			Title: title,
			Header: title,
			logoUrl: `${config.imageServer}/${entry.logoPath}`,
			screenshotUrl: `${config.imageServer}/${entry.screenshotPath}`,
			entryTable: buildTable(entry, viewInfo.game),
			addAppInfo: entry.addApps.length == 0 ? '' : utils.buildHtml(templates['view'].addapp, Object.assign(newDefs, {
				addAppTables: entry.addApps.map(addApp => buildTable(addApp, viewInfo.addApp)).join('\n'),
			})),
			gameDataInfo: sortedGameData.length == 0 ? '' : utils.buildHtml(templates['view'].gamedata, Object.assign(newDefs, {
				gameDataTable: buildTable(sortedGameData[0], viewInfo.gameData),
			})),
			oldGameDataInfo: sortedGameData.length < 2 ? '' : utils.buildHtml(templates['view'].oldgamedata, Object.assign(newDefs, {
				oldGameDataTables: sortedGameData.slice(1).map(gameData => buildTable(gameData, viewInfo.gameData)).join('\n'),
			})),
		};
	},
	'search-info': (_, lang) => {
		// Get search page translation
		const translation = Object.assign({},
			locales[config.defaultLang].translations['search'],
			locales[lang]?.translations['search'],
		);

		// Copy search info and insert translated filter strings into the copy
		const langSearchInfo = structuredClone(searchInfo);
		for (const type in langSearchInfo.filter) {
			for (const filter in langSearchInfo.filter[type]) {
				const def = langSearchInfo.filter[type][filter];
				langSearchInfo.filter[type][filter] = translation[def];
			}
		}

		// Serve the translated search info
		return JSON.stringify(langSearchInfo);
	},
};