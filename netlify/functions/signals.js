exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
    }

    // Check if this is a Trump Watch / news search request
    const isTrumpWatch = body.trump_watch === true;
    const isNewsSearch = body.news_search === true;

    let requestBody = { ...body };
    delete requestBody.trump_watch;
    delete requestBody.news_search;

    // Add web search tool for Trump Watch and news requests
    if (isTrumpWatch || isNewsSearch) {
      requestBody.tools = [
        {
          type: "web_search_20250305",
          name: "web_search"
        }
      ];
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await res.json();

    // Extract text content from response (handles tool use blocks too)
    const textContent = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('');

    // Return full data but also include extracted text for convenience
    return {
      statusCode: res.status,
      headers,
      body: JSON.stringify({ ...data, extractedText: textContent })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
