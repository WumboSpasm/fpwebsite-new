document.addEventListener('DOMContentLoaded', () => {
	let initialPlatform = localStorage.getItem('fp-platform');
	if (!initialPlatform) {
		const uaPlatform = navigator.platform.toLowerCase();
		if (uaPlatform.startsWith('mac'))
			initialPlatform = 'MacOS';
		else if (uaPlatform.startsWith('linux'))
			initialPlatform = 'Linux';
		else
			initialPlatform = 'Windows';
	}
	selectPlatform(initialPlatform);

	for (const platform of ['Windows', 'MacOS', 'Linux']) {
		const elem = document.querySelector(`.fp-downloads-tab-selector[data-platform='${platform}']`);
		elem.addEventListener('click', () => { selectPlatform(platform); });
	}
});

function selectPlatform(platform) {
	for (const tabSelector of document.querySelector('.fp-downloads-tab-selectors').children)
		tabSelector.dataset.selected = (tabSelector.dataset.platform == platform).toString();
	for (const tab of document.querySelector('.fp-downloads-tabs').children)
		tab.dataset.selected = (tab.dataset.platform == platform).toString();
	localStorage.setItem('fp-platform', platform);
}