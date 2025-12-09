import { sanitizeInject } from './utils.js';

export const namespaceFunctions = {
	'search': async url => {
		const searchString = url.searchParams.get('search');
		let searchResults, searchTotal;

		if (searchString !== null) {
			const search = fp.parseUserSearchInput(searchString).search;
			const searchResultsObj = await fp.searchGames(search);
			searchResults = JSON.stringify(searchResultsObj, null, '\t');
			searchTotal = searchResultsObj.length;
		}
		else {
			searchResults = '';
			searchTotal = await fp.countGames();
		}

		return {
			searchString: sanitizeInject(searchString ?? ''),
			searchResults: searchResults,
			searchTotal: searchTotal,
		};
	},
};