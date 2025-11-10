const rootData = document.documentElement.dataset;
rootData.theme = localStorage.getItem('fp-theme') ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
	updateThemeIcon();
	document.querySelector('.fp-sidebar-toggle').addEventListener('click', toggleSidebar);
	document.querySelector('.fp-languages-toggle').addEventListener('click', toggleLanguageSelect);
	document.querySelector('.fp-theme-button').addEventListener('click', toggleTheme);
});

function toggleSidebar() {
	rootData.mobileSidebar = rootData.mobileSidebar != 'true' ? 'true' : 'false';
	const sidebarToggle = document.querySelector('.fp-sidebar-toggle');
	sidebarToggle.dataset.toggled = rootData.mobileSidebar;
}

function toggleLanguageSelect() {
	const languagesContainer = document.querySelector('.fp-languages-container');
	languagesContainer.hidden = !languagesContainer.hidden;
	const languagesToggle = document.querySelector('.fp-languages-toggle');
	languagesToggle.dataset.toggled = languagesContainer.hidden ? 'false' : 'true';
}

function toggleTheme() {
	if (!rootData.theme) initTheme();
	rootData.theme = rootData.theme == 'light' ? 'dark' : 'light';
	localStorage.setItem('fp-theme', rootData.theme);
	updateThemeIcon();
}

function updateThemeIcon() {
	if (!rootData.theme) initTheme();
	const themeButton = document.querySelector('.fp-theme-button');
	themeButton.style.backgroundImage = `var(--fp-sidebar-${rootData.theme == 'light' ? 'dark' : 'light'}-theme-toggle-icon)`;
}