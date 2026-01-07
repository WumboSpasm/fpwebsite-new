document.addEventListener('DOMContentLoaded', () => {
	const oldGameDataToggle = document.querySelector('.fp-view-old-game-data-toggle');
	if (oldGameDataToggle !== null) {
		const oldGameData = document.querySelector('.fp-view-old-game-data');
		const viewContainer = document.querySelector('.fp-view-container');
		oldGameDataToggle.addEventListener('click', () => {
			viewContainer.style.setProperty('--fp-toggle-arrow-icon', `var(--fp-${oldGameData.classList.toggle('fp-hidden') ? 'gray-right' : 'down'}-arrow-icon)`);
		});
	}
});