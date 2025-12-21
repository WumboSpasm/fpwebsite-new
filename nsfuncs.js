import { GameSearchSortable, GameSearchDirection, newSubfilter } from 'npm:@fparchive/flashpoint-archive';

import * as utils from './utils.js';

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
			if (Object.hasOwn(searchInfo.sort, sortField)) {
				search.order.column = GameSearchSortable[sortField.toUpperCase()];
				search.order.direction = GameSearchDirection[params.get('dir') == 'desc' ? 'DESC' : 'ASC'];
			}

			search.filter.subfilters.push(searchFilter);
			search.limit = config.pageSize;

			const [searchTotal, searchIndex] = await Promise.all([fp.searchGamesTotal(search), fp.searchGamesIndex(search)]);
			const totalPages = searchIndex.length > 0 ? searchIndex.length + 1 : 1;
			const currentPage = Math.max(1, Math.min(totalPages, parseInt(params.get('page'), 10) || 1));
			const currentPageIndex = currentPage - 2;
			let searchTotalStr = `Got $1{${searchTotal.toLocaleString()}} result${(searchTotal == 1 ? '' : 's')}`;
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

				searchTotalStr += ` $2{(${config.pageSize} per page)}`;
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
	'search-info': () => searchInfoStr,
};