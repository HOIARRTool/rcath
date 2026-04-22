const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash',
  process.env.GEMINI_MODEL_FALLBACK_1 || 'gemini-3-flash-preview',
  process.env.GEMINI_MODEL_FALLBACK_2 || 'gemini-3.1-flash-lite-preview',
].filter((v, i, arr) => v && arr.indexOf(v) === i);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGeminiText(data) {
  if (typeof data?.text === 'string' && data.text.trim()) {
    return data.text.trim();
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('\n')
      .trim();

    if (text) return text;
  }

  return '';
}

function isRetryable(status, message = '') {
  const msg = String(message || '').toLowerCase();

  return (
    [408, 429, 500, 502, 503, 504].includes(status) ||
    msg.includes('quota') ||
    msg.includes('resource exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('temporarily') ||
    msg.includes('rate limit')
  );
}

async function callGeminiApi({ model, prompt, timeoutMs = 90000 }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 8192,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(data?.error?.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.payload = data;
      throw err;
    }

    const text = extractGeminiText(data);

    if (!text) {
      const err = new Error('Model returned empty text');
      err.status = 502;
      err.payload = data;
      throw err;
    }

    return { text, raw: data };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Upstream AI timeout');
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

app.post('/api/generate', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();

    if (!prompt) {
      return res.status(400).json({
        error: { message: 'Missing prompt' },
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: { message: 'Missing GEMINI_API_KEY in environment variables' },
      });
    }

    const triedModels = [];
    let lastError = null;

    for (const model of MODEL_CANDIDATES) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await callGeminiApi({ model, prompt });

          return res.json({
            ok: true,
            text: result.text,
            modelUsed: model,
            triedModels,
          });
        } catch (err) {
          lastError = err;

          triedModels.push({
            model,
            attempt,
            status: err?.status || 500,
            message: err?.message || 'Unknown error',
          });

          if (isRetryable(err?.status, err?.message) && attempt < 2) {
            await sleep(1200 * attempt);
            continue;
          }

          break;
        }
      }
    }

    return res.status(503).json({
      error: {
        message: 'All Gemini models failed',
        detail: lastError?.message || 'Unknown failure',
        triedModels,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        message: err?.message || 'Unexpected server error',
      },
    });
  }
});

// เสิร์ฟหน้าเว็บ
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Model candidates:', MODEL_CANDIDATES.join(' -> '));
});
