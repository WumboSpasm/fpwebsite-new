document.addEventListener('DOMContentLoaded', () => {
	// Automatically squish button text if it's too long
	for (const textElem of document.querySelectorAll('.fp-home-button-text')) {
		const textRect = textElem.getBBox();
		const textLength = textRect.width;
		const maxTextLength = 120 - textRect.x;
		if (textLength > maxTextLength) {
			textElem.setAttribute('textLength', maxTextLength);
			textElem.setAttribute('lengthAdjust', 'spacingAndGlyphs');
		}
	}
});