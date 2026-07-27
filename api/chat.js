// This file runs on Vercel's server, NOT in the browser.
// Your Gemini API key lives here (as an environment variable you set in
// Vercel's dashboard) and is never sent to, or visible from, anyone's browser.
//
// Uses Google's Gemini API (genuinely free tier: no credit card, no
// expiration). Get a key at https://aistudio.google.com/apikey
//
// Google renames/retires Gemini model IDs fairly often. Instead of hardcoding
// one name that can break again, this tries a short list of candidates in
// order and uses whichever one actually responds. You can also force a
// specific model via the GEMINI_MODEL environment variable in Vercel,
// without ever touching this file again.

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL, // manual override, if you set one in Vercel
  'gemini-flash-latest',    // Google's auto-updating alias — usually the safest bet
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
].filter(Boolean);

async function tryModel(modelName, apiKey, system, prompt) {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system || 'You are a helpful assistant.' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 1000 },
      }),
    }
  );
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const { system, prompt } = req.body || {};
  if (!prompt) {
    res.status(400).json({ error: 'Missing "prompt" in request body.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. In Vercel: Project Settings → Environment Variables → add GEMINI_API_KEY, then redeploy.'
    });
    return;
  }

  let lastError = null;
  for (const modelName of MODEL_CANDIDATES) {
    try {
      const { ok, status, data } = await tryModel(modelName, apiKey, system, prompt);

      if (ok) {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (text) {
          res.status(200).json({ text, modelUsed: modelName });
          return;
        }
        // Empty response from a model that otherwise succeeded — treat as non-fatal, try next candidate.
        lastError = 'Model "' + modelName + '" returned no text (finish reason: ' + (data?.candidates?.[0]?.finishReason || 'unknown') + ').';
        continue;
      }

      // Model doesn't exist / retired / not accessible — try the next candidate.
      if (status === 404 || status === 400) {
        lastError = data?.error?.message || ('Model "' + modelName + '" unavailable (status ' + status + ').');
        continue;
      }

      // Any other error (bad key, quota, etc.) — this won't be fixed by trying another model, stop here.
      res.status(status).json({ error: data?.error?.message || ('Gemini request failed with status ' + status) });
      return;

    } catch (err) {
      lastError = 'Network error contacting Gemini with model "' + modelName + '": ' + err.message;
    }
  }

  // Every candidate failed.
  res.status(502).json({
    error: 'All Gemini model names failed. Last error: ' + lastError +
      ' — Google may have renamed models again. Set GEMINI_MODEL in Vercel to a current model name (check available models at https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY), then redeploy.'
  });
}
