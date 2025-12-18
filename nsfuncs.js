import { GameSearchSortable, GameSearchDirection, newSubfilter } from 'npm:@fparchive/flashpoint-archive';

import * as utils from './utils.js';

const filterMap = {
	string: ['whitelist', 'blacklist', 'exactWhitelist', 'exactBlacklist'],
	date: ['higherThan', 'lowerThan', 'equalTo'],
	number: ['higherThan', 'lowerThan', 'equalTo'],
};

export const namespaceFunctions = {
	'search': async (url, defs) => {
		const params = url.searchParams;
		const newDefs = Object.assign({}, defs, {
			nsfwChecked: params.get('nsfw') == 'true' ? ' checked' : '',
			anyChecked: params.get('any') == 'true' ? ' checked' : '',
		});

		let searchInterface, searchFilter, invalid = false;
		if (params.get('advanced') == 'true') {
			const fieldList = params.getAll('field');
			const filterList = params.getAll('filter');
			const valueList = params.getAll('value');
			if (fieldList.length > 0 && fieldList.length == filterList.length && filterList.length == valueList.length) {
				searchFilter = newSubfilter();
				for (let i = 0; i < fieldList.length; i++) {
					const field = fieldList[i];
					const filter = filterList[i];
					const value = valueList[i];
					if (field == '' || filter == '' || value == '') {
						invalid = true;
						break;
					}

					let success = false;
					for (const type in filterMap) {
						if (filterMap[type].some(compareFilter => filter == compareFilter)) {
							if (!Object.hasOwn(searchFields[type], field)
							 || (Object.hasOwn(searchFields[type][field], 'values')
							 && !Object.hasOwn(searchFields[type][field].values, value)))
								continue;

							if (type == 'string')
								searchFilter[filter][field] = (searchFilter[filter][field] ?? []).concat(value);
							else if (type == 'date')
								searchFilter[filter][field] = value;
							else if (type == 'number') {
								const parsedValue = parseInt(value);
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
			}
			else if (fieldList.length > 0 || filterList.length > 0 || valueList.length > 0)
				invalid = true;

			if (params.get('any') == 'true') {
				if (searchFilter !== undefined)
					searchFilter.matchAny = true;
				newDefs.anyChecked = ' checked';
			}
			else
				newDefs.anyChecked = '';

			searchInterface = utils.buildHtml(templates['search'].advanced, newDefs);
		}
		else {
			const searchQuery = params.get('query');
			if (searchQuery !== null)
				searchFilter = fp.parseUserSearchInput(searchQuery).search.filter;

			newDefs.searchQuery = utils.sanitizeInject(searchQuery ?? '');
			searchInterface = utils.buildHtml(templates['search'].simple, newDefs);
		}

		let searchNavigation = '';
		if (invalid)
			searchNavigation = utils.buildHtml(templates['search'].navigation, {
				searchTotal: 0,
				searchResults: '',
			});
		else if (searchFilter !== undefined) {
			const search = fp.parseUserSearchInput('').search;

			if (params.get('nsfw') != 'true') {
				const tagsSubfilter = newSubfilter();
				tagsSubfilter.exactBlacklist.tags = filteredTags;
				tagsSubfilter.matchAny = true;

				search.filter.subfilters.push(tagsSubfilter);
			}

			if (params.has('sort')) {
				const searchSort = GameSearchSortable[params.get('sort').toUpperCase()];
				if (searchSort !== undefined) {
					search.order.column = searchSort;
					search.order.direction = GameSearchDirection[params.get('dir') == 'desc' ? 'DESC' : 'ASC'];
				}
			}

			search.limit = 100;
			search.filter.subfilters.push(searchFilter);

			const [searchResultsObj, searchTotal] = await Promise.all([fp.searchGames(search), fp.searchGamesTotal(search)]);
			const searchResultsArr = [];
			if (searchResultsObj.length > 0) {
				for (const searchResult of searchResultsObj) {
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
			}

			let searchTotalStr = `Got $1{${searchTotal.toLocaleString()}} result${(searchTotal == 1 ? '' : 's')}`;
			if (searchResultsArr.length != searchTotal)
				searchTotalStr += ` $2{(displaying ${searchResultsArr.length})}`;

			searchNavigation = utils.buildHtml(templates['search'].navigation, {
				searchTotal: searchTotalStr,
				searchResults: searchResultsArr.join('\n'),
			});
		}

		return {
			searchInterface: searchInterface,
			searchNavigation: searchNavigation,
		};
	},
	'fields': () => searchFieldsStr,
};