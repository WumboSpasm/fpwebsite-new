export const namespaceFunctions = {
	'search': async (_, fp) => ({ countGames: await fp.countGames() }),
};