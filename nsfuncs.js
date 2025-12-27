import { GameSearchSortable, GameSearchDirection, newSubfilter } from 'npm:@fparchive/flashpoint-archive';

import * as utils from './utils.js';

export const namespaceFunctions = {
	'shell': (url) => {
		const langButtons = [];
		for (const lang in locales) {
			const langUrl = new URL(url);
			langUrl.searchParams.set('lang', lang);
			langButtons.push(`<a class="fp-sidebar-button fp-button fp-alternating" href="${langUrl.search}">${locales[lang].name}</a>`);
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

		const sortFields = [];
		for (const field in searchInfo.sort) {
			const selected = params.get('sort') == field ? ' selected' : '';
			sortFields.push(`<option value="${field}"${selected}>${searchInfo.sort[field]}</option>`);
		}
		newDefs.sortFields = sortFields.join('\n');

		let searchInterface, searchFilter, invalid = false;
		if (params.get('advanced') == 'true') {
			const fields = params.getAll('field');
			const filters = params.getAll('filter');
			const values = params.getAll('value');
			if (fields.length > 0 && fields.length == filters.length && filters.length == values.length) {
				searchFilter = newSubfilter();
				for (let i = 0; i < fields.length; i++) {
					const field = fields[i];
					const filter = filters[i];
					const value = values[i];
					if (field == '' || filter == '' || value == '') {
						invalid = true;
						break;
					}

					let success = false;
					for (const type in searchInfo.filter) {
						if (Object.hasOwn(searchInfo.filter[type], filter)) {
							if (!Object.hasOwn(searchInfo.field[type], field) || (type == 'string'
							 && Object.hasOwn(searchInfo.value, field) && !Object.hasOwn(searchInfo.value[field], value)))
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
					}

					if (!success) {
						invalid = true;
						break;
					}
				}

				if (params.get('any') == 'true')
					searchFilter.matchAny = true;
			}
			else if (fields.length > 0 || filters.length > 0 || values.length > 0)
				invalid = true;

			searchInterface = utils.buildHtml(templates['search'].advanced, newDefs);
		}
		else {
			const searchQuery = params.get('query');
			if (searchQuery !== null)
				searchFilter = fp.parseUserSearchInput(searchQuery).search.filter;

			newDefs.searchQuery = utils.sanitizeInject(searchQuery ?? '');
			searchInterface = utils.buildHtml(templates['search'].simple, newDefs);
		}

		let searchContent = '';
		if (invalid) {
			searchContent = utils.buildHtml(templates['search'].navigation, Object.assign(newDefs, {
				totalResults: '0',
				resultsPerPageHidden: ' hidden',
				searchResults: '',
				topPageButtons: '',
				bottomPageButtons: '',
			}));
		}
		else if (searchFilter !== undefined) {
			const search = fp.parseUserSearchInput('').search;

			if (params.get('nsfw') != 'true') {
				const tagsSubfilter = newSubfilter();
				tagsSubfilter.exactBlacklist.tags = filteredTags.extreme;
				tagsSubfilter.matchAny = true;

				search.filter.subfilters.push(tagsSubfilter);
			}

			const sortField = params.get('sort');
			if (Object.hasOwn(searchInfo.sort, sortField)) {
				search.order.column = GameSearchSortable[sortField.toUpperCase()];
				search.order.direction = GameSearchDirection[params.get('dir') == 'desc' ? 'DESC' : 'ASC'];
			}

			search.filter.subfilters.push(searchFilter);
			search.limit = config.pageSize;

			const [totalResults, searchIndex] = await Promise.all([fp.searchGamesTotal(search), fp.searchGamesIndex(search)]);
			const totalPages = searchIndex.length > 0 ? searchIndex.length + 1 : 1;
			const currentPage = Math.max(1, Math.min(totalPages, parseInt(params.get('page'), 10) || 1));
			const currentPageIndex = currentPage - 2;
			let pageButtons = '';
			if (totalPages > 1) {
				if (currentPage > 1) {
					const offset = searchIndex[currentPageIndex];
					search.offset = {
						value: offset.orderVal,
						title: offset.title,
						gameId: offset.id,
					};
				}

				const nthPageUrl = new URL(url);
				nthPageUrl.searchParams.set('page', 1);
				const firstPageUrl = nthPageUrl.search;
				nthPageUrl.searchParams.set('page', Math.max(currentPage - 1, 1));
				const prevPageUrl = nthPageUrl.search;
				nthPageUrl.searchParams.set('page', Math.min(currentPage + 1, totalPages));
				const nextPageUrl = nthPageUrl.search;
				nthPageUrl.searchParams.set('page', totalPages);
				const lastPageUrl = nthPageUrl.search;

				pageButtons = utils.buildHtml(templates['search'].pagebuttons, Object.assign(newDefs, {
					currentPage: currentPage.toLocaleString(lang),
					totalPages: totalPages.toLocaleString(lang),
					firstPageUrl: firstPageUrl,
					prevPageUrl: prevPageUrl,
					nextPageUrl: nextPageUrl,
					lastPageUrl: lastPageUrl,
				}));
			}

			const searchResults = await fp.searchGames(search);
			const searchResultsArr = [];
			for (const searchResult of searchResults) {
				let resultCreator = searchResult.developer || searchResult.publisher;
				if (resultCreator != '')
					resultCreator = `by ${resultCreator}`;

				searchResultsArr.push(utils.buildHtml(templates['search'].result, {
					resultId: searchResult.id,
					resultLogo: `${config.imageUrl}/Logos/${searchResult.id.substring(0, 2)}/${searchResult.id.substring(2, 4)}/${searchResult.id}.png?type=jpg`,
					resultTitle: utils.sanitizeInject(searchResult.title),
					resultCreator: utils.sanitizeInject(resultCreator),
					resultPlatform: searchResult.platforms.join('/'),
					resultLibrary: searchResult.library == 'arcade' ? 'game' : 'animation',
					resultTags: searchResult.tags.join(' - '),
				}));
			}

			searchContent = utils.buildHtml(templates['search'].navigation, Object.assign(newDefs, {
				totalResults: totalResults.toLocaleString(lang),
				resultsPerPageHidden: totalPages == 1 ? ' hidden' : '',
				searchResults: searchResultsArr.join('\n'),
				topPageButtons: pageButtons,
				bottomPageButtons: searchResults.length > 20 ? pageButtons : '',
			}));
		}
		else {
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
					field: tag,
					value: total.toLocaleString(lang),
				})).join('\n'),
				totalTags: tagStatsLimit.toLocaleString(lang),
			}));
		}

		const lastUpdate = new Intl.DateTimeFormat(lang, {
			dateStyle: "long",
			timeStyle: "long",
			timeZone: "UTC",
			hour12: false,
		}).format(new Date(searchStats.lastUpdated));

		return {
			lastUpdate: lastUpdate,
			searchInterface: searchInterface,
			searchContent: searchContent,
		};
	},
	'search-info': (_, lang) => {
		const translation = Object.assign({},
			locales[config.defaultLang].translations['search'],
			locales[lang]?.translations['search'],
		);

		const realSearchInfo = structuredClone(searchInfo);
		for (const type in realSearchInfo.filter) {
			for (const filter in realSearchInfo.filter[type]) {
				const def = realSearchInfo.filter[type][filter];
				realSearchInfo.filter[type][filter] = translation[def];
			}
		}

		return JSON.stringify(realSearchInfo);
	},
};