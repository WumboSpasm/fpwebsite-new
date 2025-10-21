let rootData;
document.addEventListener('DOMContentLoaded', () => {
	rootData = document.documentElement.dataset;
	initTheme();
});

function toggleSidebar() {
	rootData.mobileSidebar = rootData.mobileSidebar != 'true' ? 'true' : 'false';
	const sidebarToggle = document.querySelector('.fp-sidebar-toggle');
	sidebarToggle.dataset.toggled = rootData.mobileSidebar;
}

function toggleTheme() {
	if (!rootData.theme) initTheme();
	rootData.theme = rootData.theme == 'light' ? 'dark' : 'light';
	localStorage.setItem('fp-theme', rootData.theme);
	updateThemeIcon();
}

function updateThemeIcon() {
	if (!rootData.theme) initTheme();
	const themeIcon = document.querySelector('.fp-theme-button-icon');
	themeIcon.src = `images/icons/${rootData.theme == 'light' ? 'dark' : 'light'}.svg`;
}

function initTheme() {
	rootData.theme = localStorage.getItem('fp-theme') ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	updateThemeIcon();
}