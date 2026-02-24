const rootData = document.documentElement.dataset;
rootData.theme = localStorage.getItem('fp-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
	document.querySelector('.fp-shell-sidebar-toggle').addEventListener('click', toggleSidebar);
	document.querySelector('.fp-shell-languages-toggle').addEventListener('click', toggleLanguageSelect);
	document.querySelector('.fp-shell-theme-button').addEventListener('click', toggleTheme);

	for (const hiddenContentContainer of document.querySelectorAll('.fp-hidden-content-container')) {
		const hashesMatch = hiddenContentContainer.id && hiddenContentContainer.id == location.hash.substring(1);
		if (hashesMatch)
			toggleHiddenContent(hiddenContentContainer, false);

		const hiddenContentHeader = hiddenContentContainer.querySelector('.fp-hidden-content-header');
		hiddenContentHeader.addEventListener('click', event => {
			if (event.target.nodeName != 'A' || hiddenContentContainer.dataset.toggled != 'true')
				toggleHiddenContent(hiddenContentContainer);
		});
	}

	window.addEventListener('hashchange', () => {
		const hiddenContentContainer = document.querySelector(location.hash);
		if (hiddenContentContainer
		 && hiddenContentContainer.className == 'fp-hidden-content-container'
		 && hiddenContentContainer.dataset.toggled != 'true')
			toggleHiddenContent(hiddenContentContainer);
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
	rootData.mobileSidebar = (rootData.mobileSidebar != 'true').toString();
	const sidebarToggle = document.querySelector('.fp-shell-sidebar-toggle');
	sidebarToggle.dataset.toggled = rootData.mobileSidebar;
}

function toggleLanguageSelect() {
	const languagesContainer = document.querySelector('.fp-shell-languages-container');
	const languagesToggle = document.querySelector('.fp-shell-languages-toggle');
	languagesToggle.dataset.toggled = (!languagesContainer.classList.toggle('fp-hidden')).toString();
}

function toggleTheme() {
	rootData.theme = rootData.theme == 'light' ? 'dark' : 'light';
	localStorage.setItem('fp-theme', rootData.theme);
}

function toggleHiddenContent(hiddenContentContainer) {
	hiddenContentContainer.dataset.toggled = (hiddenContentContainer.dataset.toggled != 'true').toString();
}