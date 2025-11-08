document.addEventListener('DOMContentLoaded', () => {
	let platform = localStorage.getItem('fp-platform');
	if (!platform) {
		const uaPlatform = navigator.platform.toLowerCase();
		if (uaPlatform.startsWith('mac'))
			platform = 'MacOS';
		else if (uaPlatform.startsWith('linux'))
			platform = 'Linux';
		else
			platform = 'Windows';
	}
	selectPlatform(platform);
});

function selectPlatform(platform) {
	for (const tabSelector of document.querySelector('.fp-downloads-tab-selectors').children)
		tabSelector.dataset.selected = (tabSelector.dataset.platform == platform).toString();
	for (const tab of document.querySelector('.fp-downloads-tabs').children)
		tab.dataset.selected = (tab.dataset.platform == platform).toString();
	localStorage.setItem('fp-platform', platform);
}

function copyHash(elem) {
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