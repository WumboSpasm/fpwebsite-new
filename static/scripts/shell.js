const rootData = document.documentElement.dataset;
rootData.theme = localStorage.getItem('fp-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
	updateThemeIcon();
	document.querySelector('.fp-shell-sidebar-toggle').addEventListener('click', toggleSidebar);
	document.querySelector('.fp-shell-languages-toggle').addEventListener('click', toggleLanguageSelect);
	document.querySelector('.fp-shell-theme-button').addEventListener('click', toggleTheme);

	for (const hiddenContentContainer of document.querySelectorAll('.fp-hidden-content-container')) {
		const hiddenContentHeader = hiddenContentContainer.querySelector('.fp-hidden-content-header');
		hiddenContentHeader.addEventListener('click', () => { toggleHiddenContent(hiddenContentContainer); });
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

function toggleHiddenContent(hiddenContentContainer) {
	const hiddenContent = hiddenContentContainer.querySelector('.fp-hidden-content');
	hiddenContentContainer.style.setProperty('--fp-hidden-content-arrow-icon', `var(--fp-${hiddenContent.classList.toggle('fp-hidden') ? 'down' : 'up'}-arrow-icon)`);
}