// This file runs on Vercel's server, NOT in the browser.
// Your Gemini API key lives here (as an environment variable you set in
// Vercel's dashboard) and is never sent to, or visible from, anyone's browser.
//
// Uses Google's Gemini API, which has a genuinely free tier: no credit card,
// no expiration, generous daily limits — good news after the OpenAI billing
// error. Get a key at https://aistudio.google.com/apikey

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

  try {
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: system || 'You are a helpful assistant.' }]
          },
          contents: [
            { role: 'user', parts: [{ text: prompt }] }
          ],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 1000,
          }
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      res.status(geminiRes.status).json({
        error: data?.error?.message || ('Gemini request failed with status ' + geminiRes.status),
      });
      return;
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!text) {
      const finishReason = data?.candidates?.[0]?.finishReason;
      res.status(200).json({
        text: '',
        error: finishReason ? ('Gemini returned no text (reason: ' + finishReason + '). Try rephrasing your input.') : undefined
      });
      return;
    }
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: 'Server error calling Gemini: ' + err.message });
  }
}
