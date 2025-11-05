const scriptEl = document.querySelector('script[data-tool-search]');
const toolsJsonUrl = scriptEl ? new URL('tools.json', scriptEl.src).href : new URL('tools.json', window.location.href).href;

const ready = (callback) => {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        callback();
    }
};

const formatDate = (value) => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
};

ready(() => {
    const heading = Array.from(document.querySelectorAll('h1')).find((element) =>
        element.textContent?.trim().toLowerCase().includes('tools.mathspp.com'),
    );

    if (!heading) {
        return;
    }

    const container = document.createElement('section');
    container.className = 'surface tool-search content-flow';
    container.setAttribute('role', 'search');

    const label = document.createElement('label');
    label.className = 'sr-only';
    label.setAttribute('for', 'tool-search-input');
    label.textContent = 'Search tools';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'tool-search-input-wrapper';

    const icon = document.createElement('span');
    icon.className = 'tool-search-input-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `
    <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none" />
      <line x1="13.35" y1="13.35" x2="17" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  `;

    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'tool-search-input';
    input.placeholder = 'Loading tools…';
    input.autocomplete = 'off';
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'tool-search-results');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('role', 'combobox');
    input.disabled = true;

    inputWrapper.appendChild(icon);
    inputWrapper.appendChild(input);

    const hint = document.createElement('p');
    hint.className = 'tool-search-hint';
    hint.textContent = 'Start typing to search all tools. Press “/” to focus the search.';

    const results = document.createElement('ul');
    results.id = 'tool-search-results';
    results.className = 'tool-search-results';
    results.setAttribute('role', 'listbox');
    results.setAttribute('aria-label', 'Tool suggestions');
    results.hidden = true;

    const status = document.createElement('div');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    container.appendChild(label);
    container.appendChild(inputWrapper);
    container.appendChild(hint);
    container.appendChild(results);
    container.appendChild(status);

    heading.insertAdjacentElement('afterend', container);

    let tools = [];
    let currentMatches = [];
    let activeIndex = -1;

    const updateStatus = (message) => {
        status.textContent = message || '';
    };

    const clearResults = () => {
        results.innerHTML = '';
        results.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        currentMatches = [];
        activeIndex = -1;
    };

    const highlightOption = (index) => {
        const options = results.querySelectorAll('.tool-search-option');
        options.forEach((option) => {
            option.classList.remove('active');
            option.setAttribute('aria-selected', 'false');
        });

        if (index < 0 || index >= options.length) {
            input.removeAttribute('aria-activedescendant');
            activeIndex = -1;
            return;
        }

        const option = options[index];
        option.classList.add('active');
        option.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
        activeIndex = index;
    };

    const navigateToTool = (tool, { newTab = false } = {}) => {
        if (!tool) {
            return;
        }
        const destination = tool.url || `${tool.slug}.html`;
        if (newTab) {
            window.open(destination, '_blank', 'noopener');
        } else {
            window.location.assign(destination);
        }
    };

    const renderMatches = (matches, query) => {
        results.innerHTML = '';
        currentMatches = matches.map((entry) => entry.tool);
        activeIndex = -1;

        if (!currentMatches.length) {
            const empty = document.createElement('li');
            empty.className = 'tool-search-empty';
            empty.textContent = `No tools match “${query}”.`;
            empty.setAttribute('role', 'option');
            empty.setAttribute('aria-selected', 'false');
            results.appendChild(empty);
            results.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            updateStatus(`No tools match ${query}.`);
            return;
        }

        currentMatches.forEach((tool, index) => {
            const option = document.createElement('li');
            option.className = 'tool-search-option';
            option.id = `tool-search-option-${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');

            const link = document.createElement('a');
            link.className = 'tool-search-option-link';
            link.href = tool.url || `${tool.slug}.html`;
            link.tabIndex = -1;

            const title = document.createElement('span');
            title.className = 'tool-search-option-title';
            title.textContent = tool.title || tool.slug;

            link.appendChild(title);

            if (tool.description) {
                const description = document.createElement('span');
                description.className = 'tool-search-option-description';
                description.textContent = tool.description;
                link.appendChild(description);
            }

            const metaBits = [];
            if (tool.updated) {
                metaBits.push(`Updated ${formatDate(tool.updated)}`);
            } else if (tool.created) {
                metaBits.push(`Created ${formatDate(tool.created)}`);
            }

            if (metaBits.length) {
                const meta = document.createElement('span');
                meta.className = 'tool-search-option-meta';
                meta.textContent = metaBits.join(' • ');
                link.appendChild(meta);
            }

            link.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });

            link.addEventListener('click', (event) => {
                event.preventDefault();
                navigateToTool(tool, { newTab: event.metaKey || event.ctrlKey });
            });

            option.appendChild(link);
            results.appendChild(option);
        });

        results.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        updateStatus(`${currentMatches.length} result${currentMatches.length === 1 ? '' : 's'} available.`);
    };

    const performSearch = () => {
        const query = input.value.trim();
        if (!query) {
            clearResults();
            updateStatus('Search cleared.');
            return;
        }

        const lowered = query.toLowerCase();
        const terms = lowered.split(/\s+/).filter(Boolean);

        const ranked = tools
            .map((tool) => {
                const fields = [tool.title, tool.description, tool.slug]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();

                if (!terms.every((term) => fields.includes(term))) {
                    return null;
                }

                const title = (tool.title || '').toLowerCase();
                const slug = (tool.slug || '').toLowerCase();

                let score = 100;
                if (title.startsWith(lowered)) {
                    score = 0;
                } else if (slug.startsWith(lowered)) {
                    score = 10;
                } else if (title.includes(lowered)) {
                    score = 20;
                } else if (slug.includes(lowered)) {
                    score = 30;
                }

                const updated = tool.updated ? Date.parse(tool.updated) || 0 : 0;

                return { tool, score, updated };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (a.score !== b.score) {
                    return a.score - b.score;
                }
                return b.updated - a.updated;
            })
            .slice(0, 12);

        renderMatches(ranked, query);
    };

    input.addEventListener('input', () => {
        if (!tools.length) {
            return;
        }
        performSearch();
    });

    input.addEventListener('keydown', (event) => {
        if (!currentMatches.length && !['Escape', 'Tab'].includes(event.key)) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!results.hidden) {
                const nextIndex = (activeIndex + 1) % currentMatches.length;
                highlightOption(nextIndex);
            } else {
                performSearch();
            }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const nextIndex = activeIndex <= 0 ? currentMatches.length - 1 : activeIndex - 1;
            highlightOption(nextIndex);
        } else if (event.key === 'Enter') {
            if (!currentMatches.length) {
                return;
            }
            event.preventDefault();
            const chosen = activeIndex >= 0 ? currentMatches[activeIndex] : currentMatches[0];
            navigateToTool(chosen, { newTab: event.metaKey || event.ctrlKey });
        } else if (event.key === 'Escape') {
            clearResults();
            input.blur();
        }
    });

    input.addEventListener('focus', () => {
        if (input.value && currentMatches.length) {
            results.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }
    });

    input.addEventListener('blur', () => {
        window.setTimeout(() => {
            clearResults();
        }, 120);
    });

    document.addEventListener('click', (event) => {
        if (!container.contains(event.target)) {
            clearResults();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }

        const target = event.target;
        const tagName = target?.tagName?.toLowerCase();
        const isEditable = target?.isContentEditable;
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || isEditable) {
            return;
        }

        event.preventDefault();
        input.focus();
        input.select();
    });

    fetch(toolsJsonUrl)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Failed to load tools.json: ${response.status}`);
            }
            return response.json();
        })
        .then((data) => {
            if (!Array.isArray(data)) {
                throw new Error('tools.json did not return an array');
            }
            tools = data;
            input.placeholder = 'Search tools…';
            input.disabled = false;
            updateStatus(`${tools.length} tools available to search.`);
            if (input === document.activeElement && input.value) {
                performSearch();
            }
        })
        .catch((error) => {
            console.error(error);
            input.placeholder = 'Search unavailable';
            input.disabled = true;
            updateStatus('Search unavailable.');
        });
});
