// This file runs on Vercel's server, NOT in the browser.
// Your OpenAI key lives here (as an environment variable you set in Vercel's
// dashboard) and is never sent to, or visible from, anyone's browser.

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing OPENAI_API_KEY. In Vercel: Project Settings → Environment Variables → add OPENAI_API_KEY, then redeploy.'
    });
    return;
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system || 'You are a helpful assistant.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.6,
      }),
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      res.status(openaiRes.status).json({
        error: data?.error?.message || ('OpenAI request failed with status ' + openaiRes.status),
      });
      return;
    }

    const text = data.choices?.[0]?.message?.content?.trim() || '';
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: 'Server error calling OpenAI: ' + err.message });
  }
}
