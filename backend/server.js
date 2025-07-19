require('dotenv').config({ path: '../.env' });
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const cors = require('cors');
const he = require('he');

const app = express();
const port = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());

// state for proactive rate limiting
let lastApiCallTimestamp = 0;
const API_COOLDOWN = 5000; // 5 seconds to match opentdb's rate limit

async function retry(fn, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Fetching from OpenTDB, attempt ${i + 1}...`);
            return await fn();
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${i + 1} failed: ${error.message}`);

            let retryDelay = delay;
            // if it's a 429 error (rate limiting), wait 5 seconds as per opentdb docs
            if (error.response && error.response.status === 429) {
                console.log('Rate limit error (429). Waiting 5 seconds before retry.');
                lastApiCallTimestamp = Date.now();
                retryDelay = 5000;
            }

            if (i < retries - 1) {
                await new Promise(res => setTimeout(res, retryDelay));
            }
        }
    }
    console.error('All retry attempts failed.');
    throw lastError;
}

app.get('/api/questions', async (req, res) => {
    const { amount = 10, category, difficulty, type, search, page = 1 } = req.query;
    
    // ensure consistent cache keys by handling empty strings as undefined
    const queryParams = {
        category: category || undefined,
        difficulty: difficulty || undefined,
        type: type || undefined,
        search: search || undefined
    };

    const cacheKey = `questions:${JSON.stringify(queryParams)}`;
    const pageNumber = parseInt(page, 10);
    const amountNumber = parseInt(amount, 10);

    try {
        let allQuestions = cache.get(cacheKey);

        if (!allQuestions) {
            console.log(`Cache miss for ${cacheKey}. Fetching from OpenTDB...`);
            const now = Date.now();
            const timeSinceLastCall = now - lastApiCallTimestamp;

            if (timeSinceLastCall < API_COOLDOWN) {
                const timeToWait = API_COOLDOWN - timeSinceLastCall;
                console.log(`Proactively waiting ${timeToWait}ms to respect API rate limit.`);
                await new Promise(resolve => setTimeout(resolve, timeToWait));
            }

            // fetch a larger batch to simulate pagination as opentdb doesn't support it
            let url = `https://opentdb.com/api.php?amount=50`; 
            if (queryParams.category) url += `&category=${queryParams.category}`;
            if (queryParams.difficulty) url += `&difficulty=${queryParams.difficulty}`;
            if (queryParams.type) url += `&type=${queryParams.type}`;

            lastApiCallTimestamp = Date.now();
            const response = await retry(() => axios.get(url, { timeout: 5000 }));
            
            if (response.data.response_code === 0 && response.data.results) {
                let questions = response.data.results;

                if (queryParams.search) {
                    questions = questions.filter(q => q.question.toLowerCase().includes(queryParams.search.toLowerCase()));
                }

                const transformedQuestions = questions.map(q => {
                    const answers = [...q.incorrect_answers, q.correct_answer];
                    const shuffledAnswers = answers.sort(() => Math.random() - 0.5);
                    return {
                        ...q,
                        question: he.decode(q.question),
                        correct_answer: he.decode(q.correct_answer),
                        incorrect_answers: q.incorrect_answers.map(a => he.decode(a)),
                        answers: shuffledAnswers.map(a => he.decode(a)),
                    };
                });
                
                allQuestions = transformedQuestions;
                if (allQuestions.length > 0) {
                    console.log(`Successfully fetched and transformed ${allQuestions.length} questions. Caching result.`);
                    cache.set(cacheKey, allQuestions, 3600); // cache for 1 hour
                } else {
                    console.log(`Query resulted in no questions after filtering. Not caching.`);
                }
            } else {
                console.log(`OpenTDB API returned no results or an error code: ${response.data.response_code}. Caching empty result to avoid repeated failed requests.`)
                allQuestions = []
                // negative-cache the empty array so subsequent identical requests don’t keep hitting the API
                cache.set(cacheKey, allQuestions, 3600)
            }
        } else {
            console.log(`Cache hit for ${cacheKey}.`);
        }

        const startIndex = (pageNumber - 1) * amountNumber;
        const endIndex = pageNumber * amountNumber;
        const paginatedQuestions = allQuestions.slice(startIndex, endIndex);

        res.json(paginatedQuestions);
    } catch (error) {
        res.status(502).json({ error: true, message: "The Trivia Service is currently unavailable. Please try again later." });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
}); 