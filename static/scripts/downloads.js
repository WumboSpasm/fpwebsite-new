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
	for (const elem of document.querySelectorAll('.fp-downloads-tab-button-hash'))
		elem.addEventListener('click', copyHash);
});

function selectPlatform(platform) {
	for (const tabSelector of document.querySelector('.fp-downloads-tab-selectors').children)
		tabSelector.dataset.selected = (tabSelector.dataset.platform == platform).toString();
	for (const tab of document.querySelector('.fp-downloads-tabs').children)
		tab.dataset.selected = (tab.dataset.platform == platform).toString();
	localStorage.setItem('fp-platform', platform);
}

function copyHash(e) {
	const elem = e.target;
	if (elem.textContent == elem.dataset.copied)
		return;
	const hash = elem.dataset.hash;
	navigator.clipboard.writeText(hash).then(() => {
		if (copyHash.textContent === undefined)
			copyHash.textContent = elem.textContent;
		elem.textContent = elem.dataset.copied;
		copyHash.copiedTimeout = setTimeout(() => { elem.textContent = copyHash.textContent; }, 1500);
	});
}