const rootData = document.documentElement.dataset;
rootData.theme = localStorage.getItem('fp-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
	updateThemeIcon();
	document.querySelector('.fp-shell-sidebar-toggle').addEventListener('click', toggleSidebar);
	document.querySelector('.fp-shell-languages-toggle').addEventListener('click', toggleLanguageSelect);
	document.querySelector('.fp-shell-theme-button').addEventListener('click', toggleTheme);

	for (const hiddenContentContainer of document.querySelectorAll('.fp-hidden-content-container')) {
		const hashesMatch = hiddenContentContainer.id == location.hash.substring(1);
		if (hashesMatch)
			toggleHiddenContent(hiddenContentContainer, false);

		const hiddenContentHeader = hiddenContentContainer.querySelector('.fp-hidden-content-header');
		hiddenContentHeader.addEventListener('click', event => {
			if (event.target.nodeName != 'A' || hashesMatch)
				toggleHiddenContent(hiddenContentContainer, event.target.nodeName == 'A' && hashesMatch ? false : undefined);
		});
	}

	window.addEventListener('hashchange', () => {
		const hiddenContentContainer = document.querySelector(location.hash);
		if (hiddenContentContainer && hiddenContentContainer.className == 'fp-hidden-content-container')
			toggleHiddenContent(hiddenContentContainer, false);
	});

	const modalContainer = document.querySelector('.fp-modal-container');
	if (modalContainer) {
		const modalCloseButton = modalContainer.querySelector('.fp-modal-close-button');
		const modal = modalContainer.querySelector('.fp-modal');
		let activeModalContent;

		for (const modalButton of document.querySelectorAll('[data-modal]'))
			modalButton.addEventListener('click', () => {
				activeModalContent = modal.querySelector('.fp-modal-content#' + modalButton.dataset.modal);
				if (activeModalContent) {
					activeModalContent.classList.remove('fp-hidden');
					rootData.activeModal = modalButton.dataset.modal;
				}
			});

		modalContainer.addEventListener('click', event => {
			if (event.target != modalContainer && event.target != modalCloseButton)
				return;

			delete rootData.activeModal;
			activeModalContent.classList.add('fp-hidden');
		});
	}
});

function toggleSidebar() {
	rootData.mobileSidebar = rootData.mobileSidebar != 'true' ? 'true' : 'false';
	const sidebarToggle = document.querySelector('.fp-shell-sidebar-toggle');
	sidebarToggle.dataset.toggled = rootData.mobileSidebar;
}

function toggleLanguageSelect() {
	const languagesContainer = document.querySelector('.fp-shell-languages-container');
	const languagesToggle = document.querySelector('.fp-shell-languages-toggle');
	languagesToggle.dataset.toggled = languagesContainer.classList.toggle('fp-hidden') ? 'false' : 'true';
}

function toggleTheme() {
	if (!rootData.theme) initTheme();
	rootData.theme = rootData.theme == 'light' ? 'dark' : 'light';
	localStorage.setItem('fp-theme', rootData.theme);
	updateThemeIcon();
}

function updateThemeIcon() {
	if (!rootData.theme) initTheme();
	const themeButton = document.querySelector('.fp-shell-theme-button');
	themeButton.style.backgroundImage = `var(--fp-shell-${rootData.theme == 'light' ? 'dark' : 'light'}-theme-toggle-icon)`;
}

function toggleHiddenContent(hiddenContentContainer, force) {
	const hiddenContent = hiddenContentContainer.querySelector('.fp-hidden-content');
	hiddenContentContainer.style.setProperty('--fp-hidden-content-arrow-icon', `var(--fp-${hiddenContent.classList.toggle('fp-hidden', force) ? 'down' : 'up'}-arrow-icon)`);
}