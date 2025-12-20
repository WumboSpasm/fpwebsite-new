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
			ascSelected: params.get('dir') == 'asc' ? ' selected' : '',
			descSelected: params.get('dir') == 'desc' ? ' selected' : '',
			nsfwChecked: params.get('nsfw') == 'true' ? ' checked' : '',
			anyChecked: params.get('any') == 'true' ? ' checked' : '',
		});

		const sortFields = [];
		for (const field in searchSort) {
			const selected = params.get('sort') == field ? ' selected' : '';
			sortFields.push(`<option value="${field}"${selected}>${searchSort[field].name}</option>`);
		}
		newDefs.sortFields = sortFields.join('\n');

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
			else if (fieldList.length > 0 || filterList.length > 0 || valueList.length > 0)
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

		let searchNavigation = '';
		if (invalid)
			searchNavigation = utils.buildHtml(templates['search'].navigation, {
				searchTotal: 'Got $1{0} results',
				searchResults: '',
				searchPageButtonsTop: '',
				searchPageButtonsBottom: '',
			});
		else if (searchFilter !== undefined) {
			const search = fp.parseUserSearchInput('').search;

			if (params.get('nsfw') != 'true') {
				const tagsSubfilter = newSubfilter();
				tagsSubfilter.exactBlacklist.tags = filteredTags;
				tagsSubfilter.matchAny = true;

				search.filter.subfilters.push(tagsSubfilter);
			}

			const sortField = params.get('sort');
			if (Object.hasOwn(searchSort, sortField)) {
				search.order.column = GameSearchSortable[sortField.toUpperCase()];
				search.order.direction = GameSearchDirection[params.get('dir') == 'desc' ? 'DESC' : 'ASC'];
			}

			search.filter.subfilters.push(searchFilter);
			search.limit = config.pageSize;

			const [searchTotal, searchIndex] = await Promise.all([fp.searchGamesTotal(search), fp.searchGamesIndex(search)]);
			const totalPages = searchIndex.length > 0 ? searchIndex.length + 1 : 1;
			const currentPage = Math.max(1, Math.min(totalPages, parseInt(params.get('page'), 10) || 1));
			const currentPageIndex = currentPage - 2;
			let searchPageButtons = '';
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
				const firstPageUrl = nthPageUrl.href;
				nthPageUrl.searchParams.set('page', Math.max(currentPage - 1, 1));
				const prevPageUrl = nthPageUrl.href;
				nthPageUrl.searchParams.set('page', Math.min(currentPage + 1, totalPages));
				const nextPageUrl = nthPageUrl.href;
				nthPageUrl.searchParams.set('page', totalPages);
				const lastPageUrl = nthPageUrl.href;
				searchPageButtons = utils.buildHtml(templates['search'].pagebuttons, {
					currentPage: currentPage,
					totalPages: totalPages,
					firstPageUrl: firstPageUrl,
					prevPageUrl: prevPageUrl,
					nextPageUrl: nextPageUrl,
					lastPageUrl: lastPageUrl,
				});
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

			let searchTotalStr = `Got $1{${searchTotal.toLocaleString()}} result${(searchTotal == 1 ? '' : 's')}`;
			if (searchResults.length != searchTotal)
				searchTotalStr += ` $2{(displaying ${searchResults.length})}`;

			searchNavigation = utils.buildHtml(templates['search'].navigation, {
				searchTotal: searchTotalStr,
				searchResults: searchResultsArr.join('\n'),
				searchPageButtonsTop: searchPageButtons,
				searchPageButtonsBottom: searchResults.length > 20 ? searchPageButtons : '',
			});
		}

		return {
			searchInterface: searchInterface,
			searchNavigation: searchNavigation,
		};
	},
	'fields': () => searchFieldsStr,
};