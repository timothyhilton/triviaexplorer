const state = {
    questions: [],
    currentFilters: {
        category: '',
        difficulty: '',
        type: '',
        search: '',
    },
    page: 1,
    hasMore: true,
    savedQuestions: JSON.parse(localStorage.getItem('saved_trivia_questions')) || {},
    isLoading: false,
};

const getApiUrl = () => {
    const hostname = window.location.hostname
    if (hostname === 'triviaexplorer-frontend.onrender.com') {
        return 'https://triviaexplorer.onrender.com/api'
    }
    return 'http://localhost:3000/api'
}

const API_URL = getApiUrl()

let controller = new AbortController();

const elements = {
    filterForm: document.getElementById('filter-form'),
    categorySelect: document.getElementById('category'),
    difficultyButtons: document.querySelector('.difficulty-buttons'),
    searchInput: document.getElementById('search'),
    typeSelect: document.getElementById('type'),
    questionFeed: document.getElementById('question-feed'),
    loader: document.querySelector('.loader'),
    favoritesBtn: null,
    loadMoreBtn: document.getElementById('load-more-btn'),
};

async function fetchQuestions(loadMore = false) {
    if (state.isLoading) return;

    if (!loadMore) {
        controller.abort(); // Abort the previous request
        controller = new AbortController();
    }
    const { signal } = controller;

    state.isLoading = true;
    updateLoadingState();

    try {
        if (state.currentFilters.favoritesOnly) {
            state.questions = Object.values(state.savedQuestions);
        } else {
            const { category, difficulty, search, type } = state.currentFilters;
            const params = new URLSearchParams({
                amount: 10,
                page: state.page,
                ...(category && { category }),
                ...(difficulty && { difficulty }),
                ...(type && { type }),
                ...(search && { search }),
            });
            const response = await fetch(`${API_URL}/questions?${params}`, { signal });
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            
            if (loadMore) {
                state.questions = [...state.questions, ...data];
            } else {
                state.questions = data;
            }

            state.hasMore = data.length === 10;
            if (data.length > 0) {
                state.page += 1;
            }
        }
        renderCards();
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Fetch was aborted');
            return;
        }
        console.error('Fetch error:', error);
        elements.questionFeed.innerHTML = `<p class="error">Could not fetch questions. The trivia service might be down.</p>`;
    } finally {
        if (!signal.aborted) {
            state.isLoading = false;
            updateLoadingState();
        }
    }
}

function renderCards() {
    const questionFeed = elements.questionFeed;
    const paginationControls = document.getElementById('pagination-controls');

    if (state.page === 1) {
        // clear everything except the pagination controls
        while (questionFeed.firstChild && questionFeed.firstChild !== paginationControls) {
            questionFeed.removeChild(questionFeed.firstChild);
        }
    }
    
    if (state.questions.length === 0 && state.page === 1) {
        const message = document.createElement('p');
        message.textContent = state.currentFilters.favoritesOnly
            ? 'You have no favorite questions yet. Save some!'
            : 'No questions found for the selected filters.';
        questionFeed.insertBefore(message, paginationControls);
        return;
    }
    
    // determine which questions are new
    const existingCardCount = questionFeed.querySelectorAll('.card').length;
    const newQuestions = state.questions.slice(existingCardCount);

    const cardsFragment = document.createDocumentFragment();
    newQuestions.forEach(question => {
        const card = document.createElement('div');
        card.className = 'card';
        const questionId = btoa(unescape(encodeURIComponent(question.question)));
        const isSaved = !!state.savedQuestions[questionId];

        card.innerHTML = `
            <div class="card-header">
                <span class="card-category">${question.category}</span>
                <div>
                    <button class="save-btn ${isSaved ? 'saved' : ''}" data-question-id="${questionId}">★</button>
                    <span class="card-difficulty difficulty-${question.difficulty}">${question.difficulty}</span>
                    <button class="dropdown-btn">▾</button>
                </div>
            </div>
            <p class="card-question">${question.question}</p>
            <div class="card-body" style="display: none;">
                <ul class="card-answers">
                    ${question.answers.map(answer => `<li>${answer}</li>`).join('')}
                </ul>
                <button class="reveal-btn">Reveal Answer</button>
            </div>
        `;

        const dropdownBtn = card.querySelector('.dropdown-btn');
        const cardBody = card.querySelector('.card-body');

        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = cardBody.style.display === 'block';
            cardBody.style.display = isVisible ? 'none' : 'block';
            dropdownBtn.textContent = isVisible ? '▾' : '▴';
        });

        const revealBtn = card.querySelector('.reveal-btn');
        revealBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const correctAnswer = question.correct_answer;
            const answerElements = card.querySelectorAll('.card-answers li');
            answerElements.forEach(li => {
                if (li.textContent === correctAnswer) {
                    li.classList.add('correct');
                }
            });
            revealBtn.style.display = 'none';
        });
        
        const answersList = card.querySelector('.card-answers');
        answersList.addEventListener('click', (e) => {
            if (e.target.tagName !== 'LI') return;
            
            const correctAnswer = question.correct_answer;
            const isCorrect = e.target.textContent === correctAnswer;
            
            e.target.classList.add(isCorrect ? 'correct' : 'incorrect');

            // also show correct answer
            if (!isCorrect) {
                const correctAnswerEl = Array.from(answersList.children).find(li => li.textContent === correctAnswer);
                if (correctAnswerEl) {
                    correctAnswerEl.classList.add('correct');
                }
            }

            // disable further clicks
            answersList.style.pointerEvents = 'none';
        });

        cardsFragment.appendChild(card);
    });

    // insert new cards before the pagination controls
    questionFeed.insertBefore(cardsFragment, paginationControls);

    elements.loadMoreBtn.style.display = state.hasMore && !state.currentFilters.favoritesOnly ? 'inline-block' : 'none';
}

function updateLoadingState() {
    elements.loader.style.display = state.isLoading ? 'block' : 'none';
    if (!state.isLoading) {
        elements.questionFeed.style.display = 'block';
    } else if (!state.page > 1) { // dont hide feed if loading more
        elements.questionFeed.style.display = 'none';
    }
}

function handleFilterChange() {
    state.page = 1;
    state.hasMore = true;
    state.questions = [];
    const questionFeed = elements.questionFeed;
    const paginationControls = document.getElementById('pagination-controls');
    while (questionFeed.firstChild && questionFeed.firstChild !== paginationControls) {
        questionFeed.removeChild(questionFeed.firstChild);
    }
    fetchQuestions();
}

function handleSaveClick(e) {
    if (!e.target.classList.contains('save-btn')) return;

    const button = e.target;
    const questionId = button.dataset.questionId;
    
    const question = state.questions.find(q => btoa(unescape(encodeURIComponent(q.question))) === questionId);
    if (!question) return;

    const isSaved = !!state.savedQuestions[questionId];

    if (isSaved) {
        delete state.savedQuestions[questionId];
        button.classList.remove('saved');
    } else {
        state.savedQuestions[questionId] = question;
        button.classList.add('saved');
    }

    localStorage.setItem('saved_trivia_questions', JSON.stringify(state.savedQuestions));
}

function createFavoritesButton() {
    const btn = document.createElement('button');
    btn.textContent = 'Show Favorites';
    btn.className = 'favorites-btn';
    elements.filterForm.appendChild(btn);
    elements.favoritesBtn = btn;
}

function init() {
    createFavoritesButton();

    elements.favoritesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        state.currentFilters.favoritesOnly = !state.currentFilters.favoritesOnly;
        elements.favoritesBtn.classList.toggle('active', state.currentFilters.favoritesOnly);

        const filtersDisabled = state.currentFilters.favoritesOnly;
        elements.categorySelect.disabled = filtersDisabled;
        elements.searchInput.disabled = filtersDisabled;
        elements.typeSelect.disabled = filtersDisabled;
        elements.difficultyButtons.querySelectorAll('button').forEach(b => {
            b.disabled = filtersDisabled
        });

        // if we are showing favorites, remove the 'active' class from difficulty buttons
        if (filtersDisabled) {
            document.querySelectorAll('.difficulty-buttons button').forEach(btn => btn.classList.remove('active'));
        } else {
            // if we are back to all questions, reset the active button based on state
            const currentDifficulty = state.currentFilters.difficulty || "";
            document.querySelector(`.difficulty-buttons button[data-difficulty="${currentDifficulty}"]`).classList.add('active');
        }


        handleFilterChange();
    });

    elements.loadMoreBtn.addEventListener('click', () => {
        fetchQuestions(true);
    });

    elements.categorySelect.addEventListener('change', (e) => {
        state.currentFilters.category = e.target.value;
        handleFilterChange();
    });

    elements.typeSelect.addEventListener('change', (e) => {
        state.currentFilters.type = e.target.value;
        handleFilterChange();
    });

    elements.difficultyButtons.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const difficulty = e.target.dataset.difficulty;
            state.currentFilters.difficulty = difficulty;
            document.querySelectorAll('.difficulty-buttons button').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            handleFilterChange();
        }
    });

    let searchTimeout;
    elements.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.currentFilters.search = e.target.value;
            handleFilterChange();
        }, 300);
    });

    elements.questionFeed.addEventListener('click', handleSaveClick);

    // initial fetch
    fetchQuestions();
    // set active button for initial state
    document.querySelector('.difficulty-buttons button[data-difficulty=""]').classList.add('active');
}

init(); 