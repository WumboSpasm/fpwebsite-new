const params = new URL(location).searchParams;

document.addEventListener('DOMContentLoaded', () => {
	if (params.get('advanced') == 'true')
		fetch('/data/search.json').then(async searchInfo => initAdvancedMode(await searchInfo.json()));
	if (document.querySelector('.fp-search-result'))
		initResultLogos();
});

function initResultLogos() {
	const logoContainers = document.querySelectorAll('.fp-search-result-logo-container');
	const loadLogo = (logoContainer) => {
		const logo = document.createElement('img');
		logo.className = 'fp-search-result-logo';
		logo.src = logoContainer.dataset.logo;
		logoContainer.appendChild(logo);
	};

	// Check if the browser supports IntersectionObserver
	if ('IntersectionObserver' in window) {
		// IntersectionObserver is supported, so load logos only when visible
		const logoObserver = new IntersectionObserver(entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					logoObserver.unobserve(entry.target);
					loadLogo(entry.target);
				}
			}
		});

		for (const logoContainer of logoContainers)
			logoObserver.observe(logoContainer);
	}
	else {
		// IntersectionObserver is not supported, so load all logos immediately
		for (const logoContainer of logoContainers)
			loadLogo(logoContainer);
	}
}

function initAdvancedMode(searchInfo) {
	const fields = params.getAll('field');
	const filters = params.getAll('filter');
	const values = params.getAll('value');
	if (fields.length > 0 && fields.length == filters.length && filters.length == values.length) {
		const fragment = document.createDocumentFragment();
		let invalid = false;
		for (let i = 0; i < fields.length; i++) {
			const parameter = createParameter(searchInfo, fields[i], filters[i], values[i]);
			if (!parameter) {
				invalid = true;
				break;
			}

			fragment.appendChild(parameter);
		}

		if (invalid)
			addDefaultParameter(searchInfo);
		else {
			const container = document.querySelector('.fp-search-advanced-container');
			container.appendChild(fragment);
		}
	}
	else
		addDefaultParameter(searchInfo);

	addFieldButton.addEventListener('click', () => addDefaultParameter(searchInfo));
}

function addDefaultParameter(searchInfo) {
	const type = Object.keys(searchInfo.field)[0];
	const field = Object.keys(searchInfo.field[type])[0];
	const filterList = searchInfo.filter[type];
	const filter = Object.keys(filterList)[0];
	const valueList = type == 'string' ? searchInfo.value[field] : undefined;
	const value = valueList ? Object.keys(valueList)[0] : undefined;

	const parameter = createParameter(searchInfo, field, filter, value);
	const container = document.querySelector('.fp-search-advanced-container');
	container.appendChild(parameter);
}

function createParameter(searchInfo, field, filter, value) {
	const type = getParamType(searchInfo, field, filter);
	if (!type) return null;

	const deleteButton = createDeleteButton(searchInfo);
	const fieldSelect = createFieldSelect(searchInfo, field, type);
	const filterSelect = createFilterSelect(searchInfo, type, filter);
	const valueInput = createValueInput(searchInfo, type, field, value);

	if (!filterSelect || !valueInput)
		return null;

	const parameter = document.createElement('div');
	parameter.className = 'fp-search-advanced-parameter';
	parameter.appendChild(deleteButton);
	parameter.appendChild(fieldSelect);
	parameter.appendChild(filterSelect);
	parameter.appendChild(valueInput);

	return parameter;
}

function createFieldSelect(searchInfo, initialField, initialFieldType) {
	const fieldSelect = document.createElement('select');
	fieldSelect.classList.add('fp-dropdown', 'fp-search-thin');
	fieldSelect.name = 'field';
	for (const type in searchInfo.field) {
		for (const field in searchInfo.field[type]) {
			const fieldOption = document.createElement('option');
			fieldOption.value = field;
			fieldOption.dataset.type = type;
			fieldOption.textContent = searchInfo.field[type][field];
			if (field == initialField && type == initialFieldType)
				fieldOption.selected = true;

			fieldSelect.appendChild(fieldOption);
		}
	}

	fieldSelect.addEventListener('change', () => {
		const fieldOption = fieldSelect.options[fieldSelect.selectedIndex];
		const field = fieldOption.value;
		const type = fieldOption.dataset.type;

		const container = fieldSelect.parentElement;
		const filterSelect = container.querySelector('[name="filter"]');
		const valueInput = container.querySelector('[name="value"]');

		filterSelect.replaceWith(createFilterSelect(searchInfo, type));
		valueInput.replaceWith(createValueInput(searchInfo, type, field));
	});

	return fieldSelect;
}

function createFilterSelect(searchInfo, type, initialFilter) {
	const filterList = searchInfo.filter[type];
	if (!filterList) return null;

	const filterSelect = document.createElement('select');
	filterSelect.classList.add('fp-dropdown', 'fp-search-thin');
	filterSelect.name = 'filter';
	for (const filter in filterList) {
		const filterOption = document.createElement('option');
		filterOption.value = filter;
		filterOption.textContent = filterList[filter];
		if (filter == initialFilter)
			filterOption.selected = true;

		filterSelect.appendChild(filterOption);
	}

	return filterSelect;
}

function createValueInput(searchInfo, type, field, initialValue) {
	return type == 'string' && searchInfo.value[field]
		? createValueSelect(searchInfo, field, initialValue)
		: createValueTextBox(initialValue);
}

function createValueSelect(searchInfo, field, initialValue) {
	const valueList = searchInfo.value[field];
	if (!valueList) return null;

	const valueSelect = document.createElement('select');
	valueSelect.classList.add('fp-dropdown', 'fp-search-thin');
	valueSelect.name = 'value';
	for (const value in valueList) {
		const valueOption = document.createElement('option');
		valueOption.value = value;
		valueOption.textContent = valueList[value];
		if (value == initialValue)
			valueOption.selected = true;

		valueSelect.appendChild(valueOption);
	}

	return valueSelect;
}

function createValueTextBox(initialValue) {
	const valueTextBox = document.createElement('input');
	valueTextBox.classList.add('fp-text-box', 'fp-search-thin', 'fp-search-expand');
	valueTextBox.type = 'text';
	valueTextBox.name = 'value';
	if (initialValue)
		valueTextBox.value = initialValue;

	return valueTextBox;
}

function createDeleteButton(searchInfo) {
	const deleteButton = document.createElement('div');
	deleteButton.className = 'fp-search-delete-button';
	deleteButton.addEventListener('click', e => {
		const parameter = e.target.parentElement;
		const container = parameter.parentElement;
		parameter.remove();
		// If last parameter is deleted, re-add the default parameter
		if (container.children.length == 0)
			// The timeout is to force some visual feedback, because otherwise it might look like nothing is happening
			setTimeout(() => addDefaultParameter(searchInfo), 50);
	});

	return deleteButton;
}

function getParamType(searchInfo, field, filter) {
	for (const type in searchInfo.field) {
		if (searchInfo.field[type][field] && searchInfo.filter[type][filter])
			return type;
	}

	return null;
}