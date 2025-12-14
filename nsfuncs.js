import { GameSearchSortable, GameSearchDirection } from 'npm:@fparchive/flashpoint-archive';

import * as utils from './utils.js';

const filteredTags = JSON.parse(Deno.readTextFileSync('data/filter.json'));
//const tagCategories = await fp.findAllTagCategories();

export const namespaceFunctions = {
	'search': async (url, defs) => {
		const params = url.searchParams;
		const searchDefs = Object.assign({}, defs, {
			nsfwChecked: params.get('nsfw') == 'true' ? ' checked' : '',
			anyChecked: params.get('any') == 'true' ? ' checked' : '',
		});

		let searchInterface, search;
		if (params.get('advanced') == 'true') {
			const searchFields = params.getAll('field');
			const searchCompares = params.getAll('compare');
			const searchStrings = params.getAll('string');
			if (searchFields.length > 0 && searchFields.length == searchCompares.length && searchCompares.length == searchStrings.length) {
				search = fp.parseUserSearchInput('').search;
				for (let i = 0; i < searchFields.length; i++) {
					if (searchFields[i] == 'format') {
						if (searchCompares[i] == 'exactly') {
							if (searchStrings[i] == 'GameZIP')
								search.filter.higherThan.gameData = 0;
							else if (searchStrings[i] == 'Legacy')
								search.filter.equalTo.gameData = 0;
						}
					}
					else if (['dateAdded', 'dateModified', 'releaseDate'].some(field => searchFields[i] == field)) {
						switch (searchCompares[i]) {
							case 'lower': {
								search.filter.lowerThan[searchFields[i]] = searchStrings[i];
								break;
							}
							case 'higher': {
								search.filter.higherThan[searchFields[i]] = searchStrings[i];
								break;
							}
							case 'equals': {
								search.filter.equalTo[searchFields[i]] = searchStrings[i];
								break;
							}
						}
					}
					else {
						switch (searchCompares[i]) {
							case 'contains': {
								search.filter.whitelist[searchFields[i]] = (search.filter.whitelist[searchFields[i]] ?? []).concat(searchStrings[i]);
								break;
							}
							case 'notContains': {
								search.filter.blacklist[searchFields[i]] = (search.filter.blacklist[searchFields[i]] ?? []).concat(searchStrings[i]);
								break;
							}
							case 'exactly': {
								search.filter.exactWhitelist[searchFields[i]] = (search.filter.exactWhitelist[searchFields[i]] ?? []).concat(searchStrings[i]);
								break;
							}
							case 'notExactly': {
								search.filter.exactBlacklist[searchFields[i]] = (search.filter.exactBlacklist[searchFields[i]] ?? []).concat(searchStrings[i]);
								break;
							}
						}
					}
				}
			}

			searchDefs.anyChecked = params.get('any') == 'true' ? ' checked' : '';
			searchInterface = utils.buildHtml(templates['search'].advanced, searchDefs);
		}
		else {
			const searchQuery = params.get('query');
			if (searchQuery !== null)
				search = fp.parseUserSearchInput(searchQuery).search;

			searchDefs.searchQuery = utils.sanitizeInject(searchQuery ?? '');
			searchInterface = utils.buildHtml(templates['search'].simple, searchDefs);
		}

		let searchNavigation = '';
		if (search !== undefined) {
			if (params.get('nsfw') != 'true')
				search.filter.exactBlacklist.tags = filteredTags;
			if (params.get('advanced') == 'true' && params.get('any') == 'true')
				search.filter.matchAny = true;

			if (params.has('sort')) {
				const searchSort = GameSearchSortable[params.get('sort').toUpperCase()];
				if (searchSort !== undefined) {
					search.order.column = searchSort;
					search.order.direction = GameSearchDirection[params.get('dir') == 'desc' ? 'DESC' : 'ASC'];
				}
			}

			const searchResultsObject = await fp.searchGames(search);
			const searchTotal = searchResultsObject.length;
			if (searchTotal > 0) {
				const searchResultsArray = [];
				for (const searchResult of searchResultsObject) {
					let resultCreator = searchResult.developer || searchResult.publisher;
					if (resultCreator != '')
						resultCreator = `by ${resultCreator}`;

					searchResultsArray.push(utils.buildHtml(templates['search'].result, {
						resultId: searchResult.id,
						resultLogo: `${config.imageUrl}/Logos/${searchResult.id.substring(0, 2)}/${searchResult.id.substring(2, 4)}/${searchResult.id}.png?type=jpg`,
						resultTitle: searchResult.title,
						resultCreator: resultCreator,
						resultPlatform: searchResult.platforms.join('/'),
						resultLibrary: searchResult.library == 'arcade' ? 'game' : 'animation',
						resultTags: searchResult.tags.join(' - '),
					}));
				}

				searchNavigation = utils.buildHtml(templates['search'].navigation, {
					searchTotal: searchTotal,
					searchResults: searchResultsArray.join('\n'),
				});
			}
		}

		return {
			searchInterface: searchInterface,
			searchNavigation: searchNavigation,
		};
	},
};