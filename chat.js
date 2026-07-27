// This file runs on Vercel's server, NOT in the browser.
// Your Gemini API key lives here (as an environment variable you set in
// Vercel's dashboard) and is never sent to, or visible from, anyone's browser.
//
// Uses Google's Gemini API (genuinely free tier: no credit card, no
// expiration). Get a key at https://aistudio.google.com/apikey
//
// Two resilience features baked in:
// 1) Google renames/retires Gemini model IDs often — instead of one hardcoded
//    name, this tries a short list of candidates until one responds. Override
//    with GEMINI_MODEL in Vercel if every candidate ever goes stale at once.
// 2) Newer Gemini models "think" before answering, and by default those
//    reasoning tokens are deducted from the same budget as the visible
//    answer — which is why replies were getting cut off mid-sentence. We
//    turn thinking off where the model allows it, and give a generous
//    token ceiling either way as a safety net.

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL, // manual override, if you set one in Vercel
  'gemini-flash-latest',    // Google's auto-updating alias — usually the safest bet
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
].filter(Boolean);

async function callGemini(modelName, apiKey, system, prompt, includeThinkingConfig) {
  const generationConfig = { temperature: 0.6, maxOutputTokens: 4096 };
  if (includeThinkingConfig) {
    // Disables "thinking" tokens on models that support this field, so the
    // full token budget goes to the actual visible answer.
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system || 'You are a helpful assistant.' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      }),
    }
  );
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function tryModel(modelName, apiKey, system, prompt) {
  // First attempt: with thinking disabled (fast, cheap, full budget for the answer).
  let result = await callGemini(modelName, apiKey, system, prompt, true);

  // Some models reject the thinkingConfig field entirely — retry without it.
  if (!result.ok && result.status === 400 &&
      /thinking/i.test(result.data?.error?.message || '')) {
    result = await callGemini(modelName, apiKey, system, prompt, false);
  }
  return result;
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
        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text?.trim() || '';
        const finishReason = candidate?.finishReason;

        if (text && finishReason !== 'MAX_TOKENS') {
          res.status(200).json({ text, modelUsed: modelName });
          return;
        }
        if (text && finishReason === 'MAX_TOKENS') {
          // Got real text but it was still cut off even at our higher ceiling —
          // return it anyway (better than nothing) with a note, rather than fail.
          res.status(200).json({
            text: text + '\n\n[Note: response may be cut short — token limit reached even with thinking disabled.]',
            modelUsed: modelName
          });
          return;
        }
        // No text at all — try the next model candidate.
        lastError = 'Model "' + modelName + '" returned no text (finish reason: ' + (finishReason || 'unknown') + ').';
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
