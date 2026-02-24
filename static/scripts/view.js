document.addEventListener('DOMContentLoaded', () => {
	const oldGameDataToggle = document.querySelector('.fp-view-old-game-data-toggle');
	if (oldGameDataToggle !== null)
		oldGameDataToggle.addEventListener('click', () => {
			oldGameDataToggle.dataset.toggled = (oldGameDataToggle.dataset.toggled != 'true').toString();
		});
});